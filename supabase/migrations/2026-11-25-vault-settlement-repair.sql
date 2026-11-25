-- ============================================================================
-- SuperSwap — VAULT SETTLEMENT REPAIR + BACKFILL (move the timer to Vercel)
-- Date: 2026-11-25
-- Idempotent. Safe to run repeatedly. Credits ONLY cycles already past
-- maturity; nothing that has not yet earned its payout is touched.
--
-- PROBLEM
--   Open vaults were not credited at 22:05 EAT. The daily trigger was Supabase
--   pg_cron firing app_settle_matured(). Two things made that unreliable:
--     1. app_settle_matured() was fragile: a single 500-cycle cap, no per-row
--        guard, and — because app_credit has no idempotency check of its own
--        (it leans on the unique ledger.idem_key index) — ANY cycle that a prior
--        run credited but then crashed on before setting status='closed' made
--        the NEXT run raise a unique_violation and abort the WHOLE batch. One
--        bad cycle silently blocked every other member's maturity payout.
--     2. pg_cron must be enabled/registered on the project to fire at all, and
--        Vercel Cron (the intended external fallback) could never have worked:
--        /api/settle only answered POST, while Vercel Cron issues a GET.
--
-- THIS FILE
--   A. Redeploys the hardened app_settle_matured() (byte-identical to
--      supabase/rpc.sql): drains every matured cycle, wraps each credit in its
--      own sub-transaction so one failure cannot stall the rest, and closes an
--      already-credited-but-open cycle WITHOUT paying it twice.
--   B. Retires the pg_cron job so the timer is not double-driven (guarded: it
--      is a no-op whether or not pg_cron was ever installed).
--   C. RUNS the settlement once, right now — every currently-open vault whose
--      matures_at has passed is credited in this single migration run. This is
--      the backfill of the rewards the missed cron owed members.
--   D. Reports what it did and what is still legitimately open.
--
-- The daily timer then lives in vercel.json (cron 5 19 * * * == 22:05 EAT,
-- GET /api/settle with Vercel's auto-injected Bearer $CRON_SECRET).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Hardened settlement core (same body as supabase/rpc.sql).
-- ----------------------------------------------------------------------------
create or replace function app_settle_matured() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cycle vault_cycles;
  v_settled integer := 0;
  v_total numeric(16,2) := 0;
  v_closed integer := 0;
  v_failed integer := 0;
begin
  for v_cycle in
    select * from vault_cycles
      where status = 'open' and matures_at <= now()
      order by matures_at
      for update skip locked
  loop
    -- Credited by an earlier run that died before closing it: finish the job,
    -- do not pay again.
    if exists (select 1 from ledger
               where idem_key = 'vault_payout:' || v_cycle.id and kind = 'vault_payout') then
      update vault_cycles set status = 'closed', closed_at = coalesce(closed_at, now())
        where id = v_cycle.id;
      v_closed := v_closed + 1;
      continue;
    end if;

    begin
      perform app_credit(v_cycle.user_id, v_cycle.payout_total, 'vault_payout',
                         'vault_cycles', v_cycle.id,
                         'Maturity ' || (v_cycle.product_snapshot ->> 'name'),
                         'vault_payout:' || v_cycle.id);
      update vault_cycles set status = 'closed', closed_at = now() where id = v_cycle.id;
      v_settled := v_settled + 1;
      v_total := v_total + v_cycle.payout_total;
    exception when others then
      -- One unreachable member / bad row must not abort the settlement of all
      -- the others. Log it, leave the cycle open for the operator, keep going.
      raise notice 'app_settle_matured: cycle % skipped (%)', v_cycle.id, SQLERRM;
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('settled', v_settled, 'paid_total', v_total,
                            'closed', v_closed, 'failed', v_failed);
end $$;

-- The service role is the only caller that matters now (the /api/settle route);
-- keep authenticated so an operator can still run it from the RPC surface.
grant execute on function app_settle_matured() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B. Retire the Supabase pg_cron timer (guarded — no-op if pg_cron is absent,
--    which is exactly the state that let the schedule silently stop firing).
-- ----------------------------------------------------------------------------
do $cron$
begin
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where jobname = 'superswap_daily_settlement') then
    perform cron.unschedule('superswap_daily_settlement');
    raise notice 'pg_cron job superswap_daily_settlement unscheduled (timer moved to Vercel Cron)';
  else
    raise notice 'no superswap_daily_settlement pg_cron job present — nothing to retire';
  end if;
end $cron$;

-- ----------------------------------------------------------------------------
-- C. BACKFILL: credit every currently-matured open vault, right now. Idempotent
--    (safe to re-run), so this is also the manual "run settlement now" button.
-- ----------------------------------------------------------------------------
do $backfill$
declare
  v_res jsonb;
  v_due_before bigint;
begin
  select count(*) into v_due_before
    from vault_cycles where status = 'open' and matures_at <= now();
  raise notice 'vault backfill: % open cycle(s) already past maturity before this run', v_due_before;

  select app_settle_matured() into v_res;
  raise notice 'vault backfill result: %', v_res;

  -- Anything credited by this run that somehow stayed 'open' (the failed bucket)
  -- is reported so the operator can chase it; healthy cycles are now 'closed'.
  if (v_res->>'failed')::int > 0 then
    raise warning 'vault backfill: % cycle(s) could not be settled — check member accounts', v_res->>'failed';
  end if;
end $backfill$;

-- ----------------------------------------------------------------------------
-- D. Sanity + state report.
-- ----------------------------------------------------------------------------
do $sanity$
declare
  v_src text;
  v_stuck bigint;
  v_future bigint;
begin
  -- The deployed body must be the hardened one, not the old capped version.
  select prosrc into v_src from pg_proc where proname = 'app_settle_matured' limit 1;
  if v_src like '%limit 500%' or v_src not like '%vault_payout:% || v_cycle.id%' then
    raise exception 'vault-settlement-repair: app_settle_matured is not the hardened body';
  end if;

  -- No matured cycle should remain open after the backfill (except the failed
  -- bucket, which is an account problem, not a scheduler one).
  select count(*) into v_stuck
    from vault_cycles c
    where c.status = 'open' and c.matures_at <= now()
      and not exists (select 1 from ledger l
                      where l.idem_key = 'vault_payout:' || c.id and l.kind = 'vault_payout');
  select count(*) into v_future
    from vault_cycles where status = 'open' and matures_at > now();

  raise notice 'vault settlement OK — % matured cycle(s) left unpaid, % still maturing in the future',
    v_stuck, v_future;
end $sanity$;
