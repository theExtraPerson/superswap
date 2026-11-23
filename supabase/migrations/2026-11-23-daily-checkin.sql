-- ============================================================================
-- Migration: daily check-in rewards (Home tab) — 2026-11-23
--
-- Feature parity with the superswca.com shell: a daily check-in that credits a
-- small, admin-editable reward (platform_settings.checkin_bonus, default 100
-- UGX) once per platform-timezone day. Money rules are unchanged: the reward
-- flows through app_promo_credit, so it is overlay-funded and coverage-neutral
-- exactly like the welcome bonus, and it obeys the pause/daily-lock gate.
--
-- Apply on the LIVE project (Supabase SQL editor) or `supabase db push`.
-- Idempotent — every statement is create-or-replace / if-not-exists.
-- NOTE: run 2026-11-23-vault-cycles-created-at.sql first if the live DB still
-- lacks vault_cycles.created_at (the recreated app_dashboard below keeps the
-- repo's `order by created_at` on cycles).
-- ============================================================================

-- 1) Settings seed (admin-editable; 0 disables the feature).
insert into platform_settings (key, value) values ('checkin_bonus', '100')
on conflict (key) do nothing;

-- 2) Check-in log — the (user_id, day) primary key is the replay guard.
create table if not exists checkin_log (
  user_id uuid not null references profiles (user_id) on delete cascade,
  day date not null,
  amount numeric(16,2) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table checkin_log enable row level security;

-- 3) Ledger gains the 'checkin_bonus' kind (drop+add converges older rows).
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check check (kind in (
    'deposit_credit', 'withdrawal_debit', 'withdrawal_reversal',
    'vault_debit', 'vault_payout', 'vault_exit_credit',
    'referral_reward', 'bonus_credit', 'checkin_bonus',
    'adjustment_credit', 'adjustment_debit'));

-- 4) Helpers + the check-in entry point (identical to rpc.sql).
create or replace function app_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone app_setting_text('timezone', 'Africa/Kampala'))::date
$$;

create or replace function app_checkin_streak(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := app_today();
  v_streak int := 0;
begin
  if exists (select 1 from checkin_log where user_id = p_user and day = v_day) then
    v_streak := 1;
    v_day := v_day - 1;
  end if;
  while exists (select 1 from checkin_log where user_id = p_user and day = v_day) loop
    v_streak := v_streak + 1;
    v_day := v_day - 1;
    if v_streak >= 366 then exit; end if;
  end loop;
  return v_streak;
end $$;

create or replace function app_checkin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles := app_profile();
  v_bonus numeric := app_setting_num('checkin_bonus', 100);
  v_day date := app_today();
  v_wallet numeric;
begin
  if coalesce(v_bonus, 0) <= 0 then
    return jsonb_build_object('credited', 0, 'status', 'disabled', 'day', v_day,
                              'streak', 0, 'wallet_balance', v_me.wallet_balance);
  end if;
  perform app_assert_running();

  insert into checkin_log (user_id, day, amount) values (v_me.user_id, v_day, v_bonus)
    on conflict (user_id, day) do nothing;
  if not found then
    return jsonb_build_object('credited', 0, 'status', 'already_claimed', 'day', v_day,
                              'streak', app_checkin_streak(v_me.user_id),
                              'wallet_balance', v_me.wallet_balance);
  end if;

  v_wallet := app_promo_credit(v_me.user_id, v_bonus, 'checkin_bonus', 'checkin_log', null,
                               'Daily check-in', 'checkin:' || v_me.user_id || ':' || v_day);
  return jsonb_build_object('credited', v_bonus, 'status', 'credited', 'day', v_day,
                            'streak', app_checkin_streak(v_me.user_id),
                            'wallet_balance', coalesce(v_wallet, v_me.wallet_balance));
end $$;

-- 5) app_dashboard recreated with the 'checkin' block (rest unchanged and in
--    lock-step with rpc.sql, including the created_at ordering on cycles).
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
      'signup_bonus', app_setting_num('signup_bonus', 1500),
      'withdraw_window_from', app_setting_text('withdraw_window_from', '09:00'),
      'withdraw_window_to', app_setting_text('withdraw_window_to', '21:00'),
      'timezone', app_setting_text('timezone', 'Africa/Kampala'),
      'withdrawals_open', app_withdrawals_open(),
      'settlement_hour', app_setting_text('settlement_hour', '22:00'),
      'lock_at', app_setting_text('lock_at', '19:45'),
      'platform_paused', app_setting_bool('platform_paused', false),
      'pause_message', app_setting_text('pause_message', ''),
      'support_contact', app_setting_text('support_contact', '')
    ),
    'transparency', jsonb_build_object(
      'reserve_balance', (select balance from reserve where id = 1),
      'obligations', app_obligations(),
      'coverage_pct', app_coverage()
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

-- 6) Grants, in lock-step with rpc.sql.
grant execute on function app_today() to anon, authenticated;
grant execute on function app_checkin() to authenticated;
revoke all on function app_checkin_streak(uuid) from public, anon, authenticated;

-- 7) Sanity: the pieces must exist for the Home tab to work.
do $$
begin
  if to_regclass('public.checkin_log') is null then
    raise exception 'checkin_log is missing - migration did not apply';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'app_checkin') then
    raise exception 'app_checkin() is missing - migration did not apply';
  end if;
  raise notice 'daily check-in ready; bonus = %',
    (select value from platform_settings where key = 'checkin_bonus');
end $$;
