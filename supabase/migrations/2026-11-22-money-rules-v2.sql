-- ============================================================================
-- Migration: money rules v2 — withdrawal window, L1 commission, welcome bonus
-- Date: 2026-11-22
--
-- What changes (platform_settings is the authority; the code only mirrors it):
--   withdrawal_fee_percent        1.5  -> 17
--   referral_commission_percent   NEW  18   (L1, on every referee deposit)
--   signup_bonus                  NEW  1500 (UGX, once, credited at first sign-in)
--   timezone                      NEW  Africa/Kampala (wall clock for the window)
--   withdraw_window_from / _to    NEW  09:00 / 21:00
--   referral_reward               RETIRED (flat one-time reward superseded above)
--   min_deposit / min_withdrawal / settlement_hour / lock_at / pause / support
--                                 UNTOUCHED — operator-edited values survive.
--
-- Apply order for a live project (Supabase SQL editor, one statement batch at
-- a time, or `supabase db push`):
--   1) this file            — data + the new reserve_entries kind list
--   2) supabase/rpc.sql     — clock/window gates, promo credits, rules payloads
--   3) supabase/admin.sql   — L1 commission at deposit confirm, settings whitelist
-- All three are idempotent (`create or replace`), so re-running is safe.
-- For a FRESH database this file is unnecessary: schema.sql seeds these values.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reserve entry kinds: 'promo_overlay' is the non-cash mirror that funds the
--    welcome bonus and L1 commission without distorting published coverage.
-- ----------------------------------------------------------------------------
alter table reserve_entries drop constraint if exists reserve_entries_kind_check;
alter table reserve_entries add constraint reserve_entries_kind_check
  check (kind in ('reserve_credit', 'reserve_debit', 'fee_income', 'promo_overlay'));

-- ----------------------------------------------------------------------------
-- 2. Retire the flat referral reward (traceability first, then drop the row).
-- ----------------------------------------------------------------------------
do $$
declare
  v_value text;
begin
  select value into v_value from platform_settings where key = 'referral_reward';
  if v_value is null then
    raise notice 'platform_settings.referral_reward not present — nothing to retire';
    return;
  end if;

  if to_regclass('public.admin_audit') is not null then
    execute 'insert into admin_audit (actor_user_id, actor_username, action, target, detail)
             values ($1, $2, $3, $4, $5)'
      using '00000000-0000-0000-0000-000000000000'::uuid, 'system', 'migration_rules_v2',
            'platform_settings.referral_reward',
            'retired for referral_commission_percent; previous value ' || v_value;
  end if;

  delete from platform_settings where key = 'referral_reward';
  raise notice 'retired platform_settings.referral_reward (was %)', v_value;
end $$;

-- ----------------------------------------------------------------------------
-- 3. The new rule values. Upserted, so a fresh DB and a live DB converge.
-- ----------------------------------------------------------------------------
insert into platform_settings (key, value) values
  ('withdrawal_fee_percent',        '17'),
  ('referral_commission_percent',   '18'),
  ('signup_bonus',                  '1500'),
  ('timezone',                      'Africa/Kampala'),
  ('withdraw_window_from',          '09:00'),
  ('withdraw_window_to',            '21:00')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- ----------------------------------------------------------------------------
-- 4. Sanity: the window must be usable before members meet the new gate.
--    Reads platform_settings directly (no app_setting_* dependency, so this
--    file also runs on a database whose RPCs are still the previous version).
-- ----------------------------------------------------------------------------
do $$
declare
  v_from time := (select value::time from platform_settings where key = 'withdraw_window_from');
  v_to   time := (select value::time from platform_settings where key = 'withdraw_window_to');
  v_tz   text := (select value from platform_settings where key = 'timezone');
begin
  if v_from >= v_to then
    raise exception 'withdrawal window is inverted (from % >= to %) - fix platform_settings', v_from, v_to;
  end if;
  if not pg_timezone_exists(coalesce(v_tz, 'Africa/Kampala')) then
    raise exception 'platform_settings.timezone % is not an IANA zone', v_tz;
  end if;
  raise notice '%', format(
    'withdrawals open %s-%s %s | fee %s%% | welcome bonus %s UGX | L1 commission %s%%',
    v_from, v_to, v_tz,
    (select value from platform_settings where key = 'withdrawal_fee_percent'),
    (select value from platform_settings where key = 'signup_bonus'),
    (select value from platform_settings where key = 'referral_commission_percent'));
end $$;

-- Result set for a quick eyeball in the SQL editor.
select key, value, updated_at
from platform_settings
order by key;
