-- ============================================================================
-- SuperSwap — final touches: complete L2 league + EAT settlement schedule
-- Date: 2026-11-24
-- run AFTER 2026-11-24-remove-reserve-functions.sql (this file supersedes the
-- function bodies it deployed; bodies are byte-identical to the updated
-- supabase/rpc.sql and supabase/admin.sql)
--
-- What this fixes / adds:
--   1. ledger.kind CHECK was missing 'referral_reward_l2' — every deposit that
--      owed an L2 (grandparent) commission crashed settlement with a constraint
--      violation, so second-generation members were never logged.
--   2. platform_settings gains the referral_commission_l2_percent row (it only
--      ever existed as an RPC fallback, so the admin desk showed it blank).
--   3. app_team() now returns the LEVEL-2 ROSTER ('l2_team'), not just a count,
--      so every member can see both generations of their league.
--   4. Referral L1 fallback aligned 17 -> 18 everywhere (the seed has been 18
--      since money-rules-v2; the fallbacks drifted). Fee 17% and min-withdrawal
--      5 000 are already correct in all three places and are only asserted here.
--   5. Vault maturity moves onto the Africa/Kampala WALL CLOCK (10 pm EAT),
--      and Supabase pg_cron — NOT Vercel Cron, which is deprecated — releases
--      all matured payouts daily at 22:05 EAT (19:05 UTC; EAT has no DST).
--
-- Open cycles created before this file keep their UTC-based matures_at (one
-- hour into the next EAT day); the 22:05 run still sweeps them on the next
-- day, so no payout is ever lost — app_settle_matured() pays only cycles whose
-- matures_at has passed and at most once per cycle.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Ledger kinds: 'referral_reward_l2' must be storable.
--    Same convergence pattern as schema.sql section 4.
-- ----------------------------------------------------------------------------
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check check (kind in (
    'deposit_credit', 'withdrawal_debit', 'withdrawal_reversal',
    'vault_debit', 'vault_payout', 'vault_exit_credit',
    'referral_reward', 'referral_reward_l2', 'bonus_credit', 'checkin_bonus',
    'adjustment_credit', 'adjustment_debit'));

-- ----------------------------------------------------------------------------
-- 2. L2 commission becomes a real, operator-visible setting.
--    'do nothing' preserves any value an operator already steered elsewhere.
-- ----------------------------------------------------------------------------
insert into platform_settings (key, value) values
  ('referral_commission_l2_percent', '1')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Redeployed functions (identical to supabase/rpc.sql).
-- ----------------------------------------------------------------------------

-- 3a. Member dashboard — rules block carries the corrected L1 fallback.
create or replace function app_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me profiles;
  v_uid uuid := auth.uid();
begin
  select * into v_me from profiles where user_id = v_uid;
  if not found then raise exception 'PROFILE_MISSING: Account not initialised.'; end if;

  return jsonb_build_object(
    'profile', to_jsonb(v_me) - 'is_banned',
    'is_banned', v_me.is_banned,
    'rules', jsonb_build_object(
      'min_deposit', app_setting_num('min_deposit', 10000),
      'min_withdrawal', app_setting_num('min_withdrawal', 5000),
      'withdrawal_fee_percent', app_setting_num('withdrawal_fee_percent', 17),
      'referral_commission_percent', app_setting_num('referral_commission_percent', 18),
      'referral_commission_l2_percent', app_setting_num('referral_commission_l2_percent', 1),
      'signup_bonus', app_setting_num('signup_bonus', 1500),
      'withdraw_window_from', app_setting_text('withdraw_window_from', '09:00'),
      'withdraw_window_to', app_setting_text('withdraw_window_to', '21:00'),
      'timezone', app_setting_text('timezone', 'Africa/Kampala'),
      'withdrawals_open', app_withdrawals_open(),
      'settlement_hour', app_setting_text('settlement_hour', '22:00'),
      'lock_at', app_setting_text('lock_at', '19:45'),
      'platform_paused', app_setting_bool('platform_paused', false),
      'pause_message', app_setting_text('pause_message', ''),
      'support_contact', app_setting_text('support_contact', ''),
      'community_link', app_setting_text('community_link', 'https://t.me/+D8o6_tUFNbFjNjE0'),
      'support_link', app_setting_text('support_link', '')
    ),
    'checkin', jsonb_build_object(
      'bonus', app_setting_num('checkin_bonus', 100),
      'claimed_today', exists (select 1 from checkin_log
                               where user_id = v_uid and day = app_today()),
      'streak', app_checkin_streak(v_uid)
    ),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'name', p.name,
        'min_principal', p.min_principal, 'max_principal', p.max_principal,
        'duration_days', p.duration_days, 'total_rate_pct', p.total_rate_pct,
        'early_exit_percent', p.early_exit_percent, 'terms', p.terms)
        order by p.duration_days), '[]'::jsonb)
      from vault_products p where p.visible and p.active),
    'cycles', (select coalesce(jsonb_agg(to_jsonb(c) order by c.status = 'open' desc, c.matures_at desc), '[]'::jsonb)
      from (select id, product_id, principal, total_rate_pct, promised_yield, payout_total,
                   status, opened_at, matures_at, closed_at, product_snapshot -> 'name' as product_name
            from vault_cycles where user_id = v_uid order by created_at desc limit 50) c),
    'deposits', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
      from (select id, amount, channel, status, reference, created_at, settled_at
            from deposits where user_id = v_uid order by created_at desc limit 15) d),
    'withdrawals', (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at desc), '[]'::jsonb)
      from (select id, amount, fee_amount, payout_amount, channel, destination_account, status, created_at, processed_at
            from withdrawals where user_id = v_uid order by created_at desc limit 15) w),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
      from (select id, amount, kind, balance_after, note, created_at
            from ledger where user_id = v_uid order by created_at desc limit 60) l)
  );
end $$;
grant execute on function app_dashboard() to authenticated;

-- 3b. Public marketing read — same corrected fallbacks, no session needed.
create or replace function app_public_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rules', jsonb_build_object(
      'min_deposit', app_setting_num('min_deposit', 10000),
      'min_withdrawal', app_setting_num('min_withdrawal', 5000),
      'withdrawal_fee_percent', app_setting_num('withdrawal_fee_percent', 17),
      'referral_commission_percent', app_setting_num('referral_commission_percent', 18),
      'referral_commission_l2_percent', app_setting_num('referral_commission_l2_percent', 1),
      'signup_bonus', app_setting_num('signup_bonus', 1500),
      'withdraw_window_from', app_setting_text('withdraw_window_from', '09:00'),
      'withdraw_window_to', app_setting_text('withdraw_window_to', '21:00'),
      'timezone', app_setting_text('timezone', 'Africa/Kampala'),
      'withdrawals_open', app_withdrawals_open(),
      'settlement_hour', app_setting_text('settlement_hour', '22:00'),
      'lock_at', app_setting_text('lock_at', '19:45'),
      'platform_paused', app_setting_bool('platform_paused', false)),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'name', p.name, 'min_principal', p.min_principal,
        'max_principal', p.max_principal, 'duration_days', p.duration_days,
        'total_rate_pct', p.total_rate_pct, 'early_exit_percent', p.early_exit_percent,
        'terms', p.terms) order by p.duration_days), '[]'::jsonb)
      from vault_products p where p.visible and p.active)
  )
$$;
grant execute on function app_public_info() to anon, authenticated;

-- 3c. Team & commissions — BOTH league generations, with per-member earnings.
--     L1 rows read 'referral_reward'; L2 rows read 'referral_reward_l2'.
create or replace function app_team() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me profiles := app_profile();
begin
  return jsonb_build_object(
    'referral_code', v_me.referral_code,
    'commission_percent', app_setting_num('referral_commission_percent', 18),
    'commission_l2_percent', app_setting_num('referral_commission_l2_percent', 1),
    'signup_bonus', app_setting_num('signup_bonus', 1500),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                     'name', p.display_name, 'joined_at', p.created_at,
                     'first_deposit_at', (select min(settled_at) from deposits d
                                          where d.user_id = p.user_id and d.status = 'confirmed'),
                     'deposited_total', (select coalesce(sum(amount), 0) from deposits d
                                         where d.user_id = p.user_id and d.status = 'confirmed'),
                     'commission_earned', (select coalesce(sum(l.amount), 0) from ledger l
                                           where l.user_id = v_me.user_id and l.kind = 'referral_reward'
                                             and l.ref_table = 'deposits'
                                             and l.ref_id in (select d.id from deposits d
                                                              where d.user_id = p.user_id)))
                   order by p.created_at desc), '[]'::jsonb)
      from profiles p where p.referred_by = v_me.user_id),
    'l2_team', (select coalesce(jsonb_agg(jsonb_build_object(
                     'name', q.display_name, 'joined_at', q.created_at,
                     'invited_by', p.display_name,
                     'first_deposit_at', (select min(settled_at) from deposits d
                                          where d.user_id = q.user_id and d.status = 'confirmed'),
                     'deposited_total', (select coalesce(sum(amount), 0) from deposits d
                                         where d.user_id = q.user_id and d.status = 'confirmed'),
                     'commission_earned', (select coalesce(sum(l.amount), 0) from ledger l
                                           where l.user_id = v_me.user_id and l.kind = 'referral_reward_l2'
                                             and l.ref_table = 'deposits'
                                             and l.ref_id in (select d.id from deposits d
                                                              where d.user_id = q.user_id)))
                   order by q.created_at desc), '[]'::jsonb)
      from profiles q
      join profiles p on p.user_id = q.referred_by
      where p.referred_by = v_me.user_id),
    'l2_members', (select count(*) from profiles q
      where q.referred_by in (select p.user_id from profiles p where p.referred_by = v_me.user_id)),
    'referral_credits', (select coalesce(sum(amount), 0) from ledger
      where user_id = v_me.user_id and kind = 'referral_reward'),
    'referral_credits_l2', (select coalesce(sum(amount), 0) from ledger
      where user_id = v_me.user_id and kind = 'referral_reward_l2')
  );
end $$;
grant execute on function app_team() to authenticated;

-- 3d. Vault opening — maturity on the platform-timezone wall clock.
create or replace function app_open_vault(
  p_product_id integer, p_principal numeric, p_idem_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles := app_profile();
  v_product vault_products;
  v_yield numeric(16,2);
  v_payout numeric(16,2);
  v_cycle vault_cycles;
begin
  if p_idem_key is not null then
    select * into v_cycle from vault_cycles where idem_key = p_idem_key;
    if found then
      if v_cycle.user_id <> auth.uid() then raise exception 'FORBIDDEN: Idempotency key already used.'; end if;
      return to_jsonb(v_cycle);
    end if;
  end if;

  perform app_assert_running();

  select * into v_product from vault_products where id = p_product_id and visible and active;
  if not found then raise exception 'PRODUCT_NOT_FOUND: Vault is not available.'; end if;
  if p_principal < v_product.min_principal then
    raise exception 'BELOW_MINIMUM: Minimum for % is %.', v_product.name, v_product.min_principal;
  end if;
  if p_principal > v_product.max_principal then
    raise exception 'ABOVE_MAXIMUM: Maximum for % is %.', v_product.name, v_product.max_principal;
  end if;

  v_yield := round(p_principal * v_product.total_rate_pct / 100, 2);
  v_payout := p_principal + v_yield;

  -- Cycle first: its unique idem key is the atomic replay guard. Maturity is
  -- the settlement hour on the PLATFORM-TIMEZONE wall clock (10 pm Kampala
  -- with the shipped seeds), not on the UTC server clock — otherwise "daily at
  -- settlement_hour" would silently release earnings an hour into the next
  -- EAT day.
  insert into vault_cycles (user_id, product_id, product_snapshot, principal, total_rate_pct,
                            promised_yield, payout_total, matures_at, idem_key)
  values (v_me.user_id, v_product.id, to_jsonb(v_product), p_principal, v_product.total_rate_pct,
          v_yield, v_payout,
          ((date_trunc('day', now() at time zone app_setting_text('timezone', 'Africa/Kampala'))
            + app_setting_time('settlement_hour', '22:00')::interval
            + make_interval(days => v_product.duration_days))
           at time zone app_setting_text('timezone', 'Africa/Kampala')), p_idem_key)
  returning * into v_cycle;

  perform app_debit(v_me.user_id, p_principal, 'vault_debit', 'vault_cycles', v_cycle.id,
                    'Vault ' || v_product.slug);

  return to_jsonb(v_cycle);
end $$;
grant execute on function app_open_vault(integer, numeric, text) to authenticated;

-- 3e. Deposit settlement core (supabase/admin.sql) — corrected L1 fallback.
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
revoke all on function app_deposit_credited_core(bigint, text, text, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Daily settlement schedule — Supabase pg_cron.
--    Vercel Cron is deprecated for this project, so the timer lives next to
--    the data: pg_cron fires app_settle_matured() once a day. pg_cron parses
--    its schedule in the SERVER timezone (UTC on Supabase). EAT is a fixed
--    UTC+3 with no DST, so 22:05 EAT == 19:05 UTC, year round. Five minutes
--    after the 22:00 settlement hour so every cycle maturing "today at 10 pm
--    Kampala" has already crossed its matures_at boundary.
--
--    If `create extension` is blocked on your plan, flip pg_cron ON in
--    Supabase Dashboard → Database → Extensions once, then re-run this file.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

-- Named schedule = idempotent: re-running updates the job instead of piling up.
select cron.schedule(
  'superswap_daily_settlement',
  '5 19 * * *', -- 19:05 UTC = 22:05 EAT
  $job$select public.app_settle_matured();$job$
);

-- ----------------------------------------------------------------------------
-- 5. Sanity — everything above really landed before anyone celebrates.
-- ----------------------------------------------------------------------------
do $$
declare
  v_kinds text;
  v_l2set text;
  v_fee text;
  v_min text;
  v_src text;
  v_job text;
begin
  select pg_get_constraintdef(oid) into v_kinds from pg_constraint
   where conname = 'ledger_kind_check' and conrelid = 'ledger'::regclass;
  if v_kinds not like '%referral_reward_l2%' then
    raise exception 'referral-league: ledger_kind_check still missing referral_reward_l2';
  end if;

  select value into v_l2set from platform_settings where key = 'referral_commission_l2_percent';
  if v_l2set is null then raise exception 'referral-league: L2 commission setting missing'; end if;

  select value into v_fee  from platform_settings where key = 'withdrawal_fee_percent';
  select value into v_min  from platform_settings where key = 'min_withdrawal';
  if v_fee <> '17'   then raise notice 'NOTICE: withdrawal_fee_percent is %, expected 17 — set it at the admin desk', v_fee; end if;
  if v_min <> '5000' then raise notice 'NOTICE: min_withdrawal is %, expected 5000 — set it at the admin desk', v_min; end if;

  select prosrc into v_src from pg_proc where proname = 'app_team';
  if v_src not like '%l2_team%' then
    raise exception 'referral-league: app_team was not redeployed with the L2 roster';
  end if;

  select prosrc into v_src from pg_proc where proname = 'app_open_vault';
  if v_src not like '%at time zone app_setting_text%' then
    raise exception 'referral-league: app_open_vault still matures on the UTC clock';
  end if;

  select schedule into v_job from cron.job where jobname = 'superswap_daily_settlement';
  if v_job is null then
    raise exception 'eat-settlement: pg_cron job superswap_daily_settlement is not registered';
  end if;

  raise notice 'final touches OK — L2 commission %, settle cron at % (UTC)', v_l2set, v_job;
end $$;
