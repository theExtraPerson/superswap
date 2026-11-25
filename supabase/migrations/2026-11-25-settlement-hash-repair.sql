-- ============================================================================
-- SuperSwap — UNBLOCK SETTLEMENT (the 500 that hid referral commission)
-- Date: 2026-11-25
-- Idempotent. Safe to run repeatedly. Touches no member balance.
--
-- PRODUCTION EVIDENCE (read-only probes against xpsgxycsahjgteekuzxa):
--   * payment_events is EMPTY, deposits has ZERO 'confirmed' rows and admin_audit
--     has ZERO 'confirm_deposit' / 'pay_withdrawal' rows — while 'reject_deposit'
--     and 'fail_withdrawal' both worked fine.
--   * POST /rest/v1/rpc/app_hook_shashura (harmless PING payload) answered:
--       42883 · "function digest(text, unknown) does not exist"
--   * Ledger kinds present: bonus_credit, checkin_bonus, adjustment_credit,
--     vault_debit, withdrawal_debit, withdrawal_reversal — NO deposit_credit and
--     NO referral_reward / referral_reward_l2, because no deposit ever settled.
--
-- ROOT CAUSE
--   app_hash_sha256() was written as
--       language sql immutable           -- NO `set search_path`
--       as $$ select encode(digest(...,'sha256'), 'hex') $$
--   digest() is pgcrypto, which Supabase installs in the `extensions` schema.
--   Called directly over REST it worked (the role's search_path includes
--   extensions). Called from inside the settlement cores — every one of which is
--   `security definer set search_path = public` — extensions is off the path, so
--   the identifier 'sha256' resolved to type unknown and digest() was not found.
--
--   That single fault sits on the payment_events insert, which is the ONE
--   statement the money-settling paths share and the two working paths skip:
--     app_deposit_credited_core  (admin Confirm + webhook auto-credit) -> 500
--     app_withdrawal_paid_core   (Mark paid / Pay via Shashura / TS hook) -> 500
--     app_hook_shashura          (every signed callback)               -> 500
--     app_admin_reject_deposit / app_withdrawal_failed_core -> unaffected (no insert)
--   Consequence chain: the webhook could never settle, Confirm/Pay answered
--   "Something went wrong", so deposits were funded by hand with
--   app_admin_adjust_wallet — a path that never runs the credited core, so the
--   L1/L2 referral commission inside it has literally never executed. Fixing the
--   hash is what makes referral commission reflect.
--
-- ALSO IN THIS FILE (belt and braces, all idempotent)
--   * payment_events.sha256_hash gets a unique index if the constraint is absent
--     — ON CONFLICT (sha256_hash) needs it, or the same 500 returns as 42P10.
--   * ledger/deposits/withdrawals CHECKs converged to what the code writes.
--   * The settlement surface is re-deployed byte-identical to supabase/admin.sql,
--     so prod cannot be running a stale body.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The fix: sha256 without pgcrypto, with a pinned search_path.
--    sha256(bytea) is built into Postgres 11+, lives in pg_catalog (always on
--    the path) and produces the identical hex digest, so no historical hash
--    changes meaning.
-- ----------------------------------------------------------------------------
create or replace function app_hash_sha256(p_text text) returns text
language sql immutable set search_path = public
as $$ select encode(sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex') $$;

-- pgcrypto stays installed for anything else that may want it, but nothing in
-- the money path depends on it any more. Best-effort: some plans refuse the
-- inline schema clause, which must never abort this migration.
do $sha$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception when others then
    begin
      create extension if not exists pgcrypto;
    exception when others then
      raise notice 'pgcrypto unavailable (%); native sha256() is used instead', SQLERRM;
    end;
  end;
end $sha$;

-- ----------------------------------------------------------------------------
-- 2. ON CONFLICT (sha256_hash) needs a unique index. Add it only if the
--    constraint is genuinely missing (duplicate hashes cannot exist today:
--    the table has never accepted a row).
-- ----------------------------------------------------------------------------
do $idx$
declare v_found int;
begin
  select count(*) into v_found
    from pg_index i
    join pg_class c on c.oid = i.indrelid and c.relname = 'payment_events'
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
   where i.indisunique and a.attname = 'sha256_hash';
  if v_found = 0 then
    create unique index if not exists payment_events_sha256_hash_uidx on payment_events (sha256_hash);
    raise notice 'payment_events.sha256_hash: unique index created';
  else
    raise notice 'payment_events.sha256_hash: unique index already present';
  end if;
end $idx$;

-- ----------------------------------------------------------------------------
-- 3. Constraint convergence — the CHECKs must allow every value the code writes.
-- ----------------------------------------------------------------------------
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check check (kind in (
    'deposit_credit', 'withdrawal_debit', 'withdrawal_reversal',
    'vault_debit', 'vault_payout', 'vault_exit_credit',
    'referral_reward', 'referral_reward_l2', 'bonus_credit', 'checkin_bonus',
    'adjustment_credit', 'adjustment_debit'));

alter table deposits drop constraint if exists deposits_status_check;
alter table deposits add constraint deposits_status_check check (status in ('pending', 'confirmed', 'rejected'));

alter table withdrawals drop constraint if exists withdrawals_status_check;
alter table withdrawals add constraint withdrawals_status_check check (status in ('pending', 'paid', 'failed'));

-- Commission settings must exist as operator-visible rows. ON CONFLICT DO NOTHING
-- preserves whatever the operator steered on the desk (prod runs L1 17 / L2 1).
insert into platform_settings (key, value) values
  ('referral_commission_percent', '18'),
  ('referral_commission_l2_percent', '1')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Re-deploy the settlement surface (byte-identical to supabase/admin.sql).
-- ----------------------------------------------------------------------------

-- 4a. Deposit settlement core: wallet credit + L1 + L2 commission, idempotent.
create or replace function app_deposit_credited_core(p_deposit_id bigint, p_note text, p_source text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dep deposits;
  v_referrer uuid;
  v_l2_referrer uuid;
  v_comm_pct numeric := app_setting_num('referral_commission_percent', 18);
  v_comm_l2_pct numeric := app_setting_num('referral_commission_l2_percent', 1);
  v_commission numeric(16,2) := 0;
  v_commission_l2 numeric(16,2) := 0;
begin
  select * into v_dep from deposits where id = p_deposit_id for update;
  if not found then raise exception 'NOT_FOUND: Deposit not found.'; end if;
  if v_dep.status <> 'pending' then
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  -- The status transition (guarded by the row lock) is the replay guard.
  update deposits set status = 'confirmed', settled_at = now(), settled_by = p_actor,
         gateway_state = case when p_source = 'shashura' then 'verified' else gateway_state end,
         gateway_detail = case when p_source = 'shashura' then null else gateway_detail end,
         note = coalesce(p_note, note)
    where id = p_deposit_id and status = 'pending'
    returning * into v_dep;
  if not found then
    select * into v_dep from deposits where id = p_deposit_id;
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  insert into payment_events (sha256_hash, source, event_type, payload)
  values (app_hash_sha256(p_source || ':deposit:' || p_deposit_id), p_source, 'deposit.confirmed', to_jsonb(v_dep))
  on conflict (sha256_hash) do nothing;

  -- Wallet credit (member's money has arrived). The backing float is held in
  -- the external Shashura account, which the app never mirrors — so there is
  -- no reserve to declare into here.
  perform app_credit(v_dep.user_id, v_dep.amount, 'deposit_credit', 'deposits', v_dep.id,
                     'Deposit ' || v_dep.channel, 'dep_credit:' || v_dep.id);

  -- Referral commission, two generations, on THIS deposit:
  --   L1 (referral_commission_percent) -> the direct referrer,
  --   L2 (referral_commission_l2_percent) -> the referrer's own referrer.
  -- The idem keys make replay impossible, even if this deposit is settled twice.
  select referred_by into v_referrer from profiles where user_id = v_dep.user_id;
  if coalesce(v_comm_pct, 0) > 0 and v_referrer is not null then
    v_commission := round(v_dep.amount * v_comm_pct / 100, 2);
    perform app_promo_credit(v_referrer, v_commission, 'referral_reward', 'deposits', v_dep.id,
                             'Referral commission L1 ' || trim(to_char(v_comm_pct, 'FM999.99')) ||
                               '% · ' || (select username from profiles where user_id = v_dep.user_id),
                             'ref_comm:' || v_dep.id);
  end if;
  if coalesce(v_comm_l2_pct, 0) > 0 and v_referrer is not null then
    select referred_by into v_l2_referrer from profiles where user_id = v_referrer;
    if v_l2_referrer is not null then
      v_commission_l2 := round(v_dep.amount * v_comm_l2_pct / 100, 2);
      perform app_promo_credit(v_l2_referrer, v_commission_l2, 'referral_reward_l2', 'deposits', v_dep.id,
                               'Referral commission L2 ' || trim(to_char(v_comm_l2_pct, 'FM999.99')) ||
                                 '% · ' || (select username from profiles where user_id = v_dep.user_id),
                               'ref_comm_l2:' || v_dep.id);
    end if;
  end if;

  perform app_admin_log('confirm_deposit', v_dep.id::text,
                        v_dep.amount || ' UGX to ' || v_dep.user_id || ' via ' || p_source ||
                        case when v_commission > 0
                             then ' · L1 ' || v_commission || ' UGX to ' || v_referrer
                             else '' end ||
                        case when v_commission_l2 > 0
                             then ' · L2 ' || v_commission_l2 || ' UGX to ' || v_l2_referrer
                             else '' end);
  return jsonb_build_object('deposit', to_jsonb(v_dep), 'credited', v_dep.amount,
                            'commission_percent', v_comm_pct, 'commission', v_commission,
                            'commission_l2_percent', v_comm_l2_pct, 'commission_l2', v_commission_l2);
end $$;

-- 4b. Withdrawal paid core: the same audit insert, the same shared funnel.
create or replace function app_withdrawal_paid_core(p_withdrawal_id bigint, p_reference text, p_source text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wd withdrawals;
begin
  select * into v_wd from withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'NOT_FOUND: Withdrawal not found.'; end if;
  if v_wd.status <> 'pending' then
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;

  update withdrawals set status = 'paid', processed_at = now(), processed_by = p_actor,
         gateway_state = case when p_source = 'shashura' then 'paid' else gateway_state end,
         gateway_detail = case when p_source = 'shashura' then null else gateway_detail end,
         note = coalesce(nullif(trim(coalesce(p_reference, '')), ''), note)
    where id = p_withdrawal_id and status = 'pending'
    returning * into v_wd;
  if not found then
    select * into v_wd from withdrawals where id = p_withdrawal_id;
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;

  insert into payment_events (sha256_hash, source, event_type, payload)
  values (app_hash_sha256(p_source || ':withdrawal:' || p_withdrawal_id), p_source, 'withdrawal.paid', to_jsonb(v_wd))
  on conflict (sha256_hash) do nothing;

  -- The payout leaves the external Shashura float and the fee is platform
  -- revenue; both settle off-platform. The app records the queue transition,
  -- the payment event and the audit row — never an in-app reserve balance.

  perform app_admin_log('pay_withdrawal', v_wd.id::text,
                        v_wd.payout_amount || ' UGX to ' || v_wd.user_id || ' via ' || p_source);
  return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'paid', v_wd.payout_amount, 'source', p_source);
end $$;

-- 4c. Guarded admin wrappers (the desk's Approve / Mark paid buttons).
create or replace function app_admin_confirm_deposit(p_deposit_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  return app_deposit_credited_core(p_deposit_id, p_note, 'manual', v_uid);
end $$;

create or replace function app_admin_pay_withdrawal(p_withdrawal_id bigint, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  return app_withdrawal_paid_core(p_withdrawal_id, p_reference, 'manual', v_uid);
end $$;

-- 4d. Webhook funnel: collections auto-credit, payouts auto-settle, failures are
--     recorded so the desk can reconcile.
create or replace function app_hook_shashura(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event text := coalesce(p_payload->>'event', '');
  v_type text := upper(coalesce(p_payload->>'type', ''));
  v_status text := upper(coalesce(p_payload->>'status', ''));
  v_ref text := nullif(trim(coalesce(p_payload->>'external_ref', '')), '');
  v_tid text := nullif(trim(coalesce(p_payload->>'tid', '')), '');
  v_detail text;
  v_amt numeric;
  v_net numeric;
  v_dep deposits;
  v_hash text;
begin
  if p_payload is null or v_event <> 'transaction.finalized' then
    return jsonb_build_object('ignored', true, 'reason', 'unsupported event');
  end if;
  v_detail := nullif(trim(
    coalesce(p_payload->'failure'->>'code', '') || ' ' || coalesce(p_payload->'failure'->>'message', '')), '');

  v_hash := app_hash_sha256('shashura:finalized:' || coalesce(v_tid, v_ref, '') || ':' || v_type || ':' || v_status);
  insert into payment_events (sha256_hash, source, event_type, payload)
  values (v_hash, 'shashura', lower(v_type) || '.' || lower(v_status), p_payload)
  on conflict (sha256_hash) do nothing;
  if not found then
    return jsonb_build_object('replayed', true);
  end if;

  if v_type = 'COLLECTION' then
    select * into v_dep from deposits
      where (v_ref is not null and gateway_ref = v_ref)
         or (v_tid is not null and gateway_tid = v_tid)
      order by created_at desc limit 1
      for update;
    if not found then
      perform app_admin_log('shashura_orphan', coalesce(v_ref, v_tid), 'collection event without a matching deposit');
      return jsonb_build_object('ignored', true, 'reason', 'no matching deposit');
    end if;
    if v_dep.status <> 'pending' then
      return jsonb_build_object('ignored', true, 'reason', 'deposit already settled');
    end if;
    if v_status = 'SUCCESSFUL' then
      begin
        v_amt := nullif(trim(coalesce(p_payload->>'amount', '')), '')::numeric;
        v_net := nullif(trim(coalesce(p_payload->>'net_amount', '')), '')::numeric;
      exception when others then
        v_amt := null; v_net := null;
      end;
      if v_amt is not null and v_amt <> v_dep.amount then
        -- Evidence differs from the claim: never auto-credit, hold for a
        -- human. This is the ONLY state where a gateway deposit needs the
        -- admin desk before the money is trusted.
        update deposits set gateway_state = 'verified',
               gateway_detail = left('Gateway received ' || trim(to_char(v_amt, 'FM999999999999.99')) ||
                                     ' but ' || trim(to_char(v_dep.amount, 'FM999999999999.99')) ||
                                     ' was requested — review before confirming.', 300)
          where id = v_dep.id returning * into v_dep;
        perform app_admin_log('shashura_amount_mismatch', v_dep.id::text, v_dep.gateway_detail);
        return jsonb_build_object('deposit', to_jsonb(v_dep), 'needs_admin_review', true);
      end if;
      -- Deposits settle AUTOMATICALLY: the same credited core the admin Confirm
      -- uses. The gateway already moved the real cash into the external
      -- Shashura account; the app only credits the member's wallet.
      perform app_admin_log('shashura_collection_settled', v_dep.id::text,
                            v_dep.amount || ' UGX auto-credited (' || coalesce(v_dep.gateway_ref, v_ref) || ')');
      return app_deposit_credited_core(v_dep.id, null, 'shashura', null);
    end if;
    update deposits set gateway_state = 'failed', gateway_detail = left(coalesce(v_detail, 'declined'), 300)
      where id = v_dep.id returning * into v_dep;
    perform app_admin_log('shashura_collection_failed', v_dep.id::text, coalesce(v_detail, 'declined'));
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'retryable', true);
  elsif v_type = 'DISBURSEMENT' then
    if not exists (select 1 from withdrawals
                   where (v_ref is not null and gateway_ref = v_ref)
                      or (v_tid is not null and gateway_tid = v_tid)) then
      perform app_admin_log('shashura_orphan', coalesce(v_ref, v_tid), 'disbursement event without a matching withdrawal');
      return jsonb_build_object('ignored', true, 'reason', 'no matching withdrawal');
    end if;
    if v_status = 'SUCCESSFUL' then
      return app_withdrawal_paid_core(
        (select id from withdrawals where (v_ref is not null and gateway_ref = v_ref)
                                     or (v_tid is not null and gateway_tid = v_tid)
         order by created_at desc limit 1),
        coalesce(v_tid, v_ref), 'shashura', null);
    end if;
    return app_withdrawal_failed_core(
      (select id from withdrawals where (v_ref is not null and gateway_ref = v_ref)
                                   or (v_tid is not null and gateway_tid = v_tid)
        order by created_at desc limit 1),
      coalesce(v_detail, 'Payout declined by Shashura'), 'shashura', null);
  end if;
  return jsonb_build_object('ignored', true, 'reason', 'unknown type');
end $$;

-- 4e. Queue with the reconciliation age + alert flag the desk needs.
create or replace function app_admin_queue(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := app_admin_guard();
begin
  if p_kind = 'deposits' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'amount', d.amount, 'channel', d.channel, 'payer_account', d.payer_account,
        'reference', d.reference, 'status', d.status, 'created_at', d.created_at,
        'settled_at', d.settled_at, 'note', d.note,
        'gateway_ref', d.gateway_ref, 'gateway_tid', d.gateway_tid,
        'gateway_state', d.gateway_state, 'gateway_detail', d.gateway_detail,
        'waiting_minutes', (extract(epoch from (now() - d.created_at)) / 60)::bigint,
        'needs_action', (d.gateway_state in ('failed', 'verified')
                         or d.created_at < now() - interval '30 minutes'),
        'username', p.username, 'display_name', p.display_name, 'phone', p.phone)
        order by d.created_at), '[]'::jsonb)
      from (select * from deposits where status = 'pending' order by created_at limit 100) d
      left join profiles p on p.user_id = d.user_id);
  elsif p_kind = 'withdrawals' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'amount', w.amount, 'fee_amount', w.fee_amount, 'payout_amount', w.payout_amount,
        'channel', w.channel, 'destination_account', w.destination_account,
        'status', w.status, 'created_at', w.created_at, 'processed_at', w.processed_at, 'note', w.note,
        'gateway_ref', w.gateway_ref, 'gateway_tid', w.gateway_tid,
        'gateway_state', w.gateway_state, 'gateway_detail', w.gateway_detail,
        'username', p.username, 'display_name', p.display_name, 'phone', p.phone)
        order by w.created_at), '[]'::jsonb)
      from (select * from withdrawals where status = 'pending' order by created_at limit 100) w
      left join profiles p on p.user_id = w.user_id);
  end if;
  raise exception 'INVALID_REQUEST: kind must be deposits or withdrawals.';
end $$;

-- ----------------------------------------------------------------------------
-- 5. Grants — the posture admin.sql expects (idempotent).
-- ----------------------------------------------------------------------------
grant execute on function app_admin_confirm_deposit(bigint, text) to authenticated;
grant execute on function app_admin_pay_withdrawal(bigint, text) to authenticated;
grant execute on function app_admin_queue(text) to authenticated;
revoke all on function app_deposit_credited_core(bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function app_withdrawal_paid_core(bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function app_hook_shashura(jsonb) from public, anon, authenticated;
grant execute on function app_hook_shashura(jsonb) to service_role;
grant execute on function app_hash_sha256(text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Sanity — rehearsal of the exact statement that used to die, with no money
--    and no residue: the probe row is inserted and removed in the same run.
-- ----------------------------------------------------------------------------
do $sanity$
declare
  v_hex text;
  v_probe text := 'migration-rehearsal:' || clock_timestamp()::text;
  v_seen int;
  v_src text;
  v_kinds text;
begin
  -- (a) the helper itself, evaluated under the cores' pinned search_path
  set local search_path = public;
  select app_hash_sha256('probe') into v_hex;
  if v_hex is null or char_length(v_hex) <> 64 then
    raise exception 'settlement-hash-repair: app_hash_sha256 did not return a 64-char digest';
  end if;

  -- (b) the statement that broke settlement: same table, same ON CONFLICT
  insert into payment_events (sha256_hash, source, event_type, payload)
  values (v_hex, 'migration', 'rehearsal', jsonb_build_object('note', v_probe))
  on conflict (sha256_hash) do nothing;
  select count(*) into v_seen from payment_events where sha256_hash = v_hex;
  delete from payment_events where sha256_hash = v_hex and source = 'migration';
  if v_seen <> 1 then
    raise exception 'settlement-hash-repair: payment_events ON CONFLICT rehearsal failed';
  end if;

  -- (c) the deployed bodies must carry the commission block and the new hash
  select prosrc into v_src from pg_proc where proname = 'app_deposit_credited_core' limit 1;
  if v_src not like '%referral_reward_l2%' or v_src not like '%ref_comm:%' then
    raise exception 'settlement-hash-repair: credited core is not the two-generation commission body';
  end if;
  select prosrc into v_src from pg_proc where proname = 'app_hash_sha256' limit 1;
  if v_src like '%digest(%' then
    raise exception 'settlement-hash-repair: app_hash_sha256 still calls pgcrypto digest()';
  end if;

  -- (d) ledger must be able to store both commission kinds
  select pg_get_constraintdef(oid) into v_kinds from pg_constraint
   where conname = 'ledger_kind_check' and conrelid = 'ledger'::regclass;
  if v_kinds not like '%referral_reward_l2%' then
    raise exception 'settlement-hash-repair: ledger_kind_check still missing referral_reward_l2';
  end if;

  raise notice 'settlement unblocked — sha256 OK (%…), payment_events writable, L1/L2 commission deployed', left(v_hex, 12);
end $sanity$;
