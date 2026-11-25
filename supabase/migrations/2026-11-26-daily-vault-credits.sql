-- ============================================================================
-- 2026-11-26 — Daily-credit vault engine + bank-hours withdrawal window
-- ============================================================================
-- 1. vault_cycles gains days_paid / yield_paid / last_paid_at: the yield now
--    drips one ledger row per due day ('vault_earning', settlement_hour on the
--    platform clock) and the principal returns with the FINAL credit
--    ('vault_payout' — same idem key as the old lump sum, so replay-safe).
-- 2. The 19:45–21:45 "books close" daily lock is RETIRED: only withdrawals
--    keep office hours, now 09:00–22:00 EAT (closed 22:00–09:00). Deposits,
--    vault opens/exits, check-ins run 24/7.
-- 3. Scheduler: pg_cron fires app_settle_matured() daily at 22:05 EAT
--    (19:05 UTC). /api/settle stays as the manual/operator bearer fallback —
--    both run the identical function; vercel.json drops its cron entry.
--
-- Idempotent; safe to re-run. NEVER run supabase/schema.sql on a live DB.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema: cycle day counters + earning ledger kind
-- ----------------------------------------------------------------------------
alter table vault_cycles add column if not exists days_paid integer not null default 0
  check (days_paid >= 0);
alter table vault_cycles add column if not exists yield_paid numeric(16,2) not null default 0
  check (yield_paid between 0 and promised_yield);
alter table vault_cycles add column if not exists last_paid_at timestamptz;

-- Re-run convergence (same pattern as the check-in migration): rebuild the
-- kind CHECK so 'vault_earning' is accepted.
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check check (kind in (
    'deposit_credit', 'withdrawal_debit', 'withdrawal_reversal',
    'vault_debit', 'vault_earning', 'vault_payout', 'vault_exit_credit',
    'referral_reward', 'referral_reward_l2', 'bonus_credit', 'checkin_bonus',
    'adjustment_credit', 'adjustment_debit'));

-- ----------------------------------------------------------------------------
-- 2. Settings: withdrawals 09:00–22:00; the daily lock stops existing
-- ----------------------------------------------------------------------------
-- Only move the window if nobody retargeted it past the shipped default.
update platform_settings set value = '22:00', updated_at = now()
  where key = 'withdraw_window_to' and value = '21:00';
delete from platform_settings where key = 'lock_at';

-- ----------------------------------------------------------------------------
-- 3. Backfill cycles that predate the drip engine (never re-pay them by drift)
-- ----------------------------------------------------------------------------
-- Closed in the lump-sum era: they hold the FULL payout already; stamp them as
-- every day paid. Their unique 'vault_payout:<id>' ledger row is the proof.
update vault_cycles c
   set days_paid = (c.product_snapshot ->> 'duration_days')::integer,
       yield_paid = c.promised_yield
  where c.status = 'closed' and c.days_paid = 0
    and exists (select 1 from ledger l
                 where l.idem_key = 'vault_payout:' || c.id and l.kind = 'vault_payout')
    and c.product_snapshot ->> 'duration_days' is not null;

-- Exited/void: no yield was ever owed; day counters stay at 0 on purpose
-- (the settle loop only scans status = 'open').

-- ----------------------------------------------------------------------------
-- 4. Functions (mirror of the updated supabase/rpc.sql + admin.sql)
-- ----------------------------------------------------------------------------

-- 4a. Withdrawal window now closes at 22:00 (bank hours).
create or replace function app_withdrawals_open() returns boolean
language sql stable security definer set search_path = public as $$
  select app_clock() between app_setting_time('withdraw_window_from', '09:00')
                         and app_setting_time('withdraw_window_to', '22:00')
$$;

-- 4b. Gate: platform pause ONLY. The daily 2-hour money lock is retired.
create or replace function app_assert_running() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if app_setting_bool('platform_paused', false) then
    raise exception 'PLATFORM_PAUSED: %',
      nullif(app_setting_text('pause_message', ''), 'Money movement is briefly paused.');
  end if;
end $$;

create or replace function app_assert_withdrawal_window() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if app_withdrawals_open() then return; end if;
  raise exception 'OUTSIDE_WINDOW: Withdrawals open %–% (%).',
    app_setting_time('withdraw_window_from', '09:00'),
    app_setting_time('withdraw_window_to', '22:00'),
    app_clock_label();
end $$;

-- 4c. Day-due helper: day p_day (0-based) of a cycle opened at p_opened_at is
-- payable at settlement_hour on the platform wall clock, strictly after open.
create or replace function app_cycle_day_due(p_opened_at timestamptz, p_day integer) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when v_due <= p_opened_at then v_due + interval '1 day' else v_due end
  from (
    select ((date_trunc('day', p_opened_at at time zone v.name)
             + make_interval(days => p_day)
             + v.hour::interval) at time zone v.name) as v_due
    from (select app_setting_text('timezone', 'Africa/Kampala') as name,
                 app_setting_time('settlement_hour', '22:00') as hour) v
  ) x
$$;

-- 4d. Liability now nets out yield already dripped to wallets.
create or replace function app_obligations() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(wallet_balance) from profiles), 0)
       + coalesce((select sum(payout_total - yield_paid) from vault_cycles where status = 'open'), 0)
$$;

-- 4e. Opens record maturity as the LAST day's due time.
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

  insert into vault_cycles (user_id, product_id, product_snapshot, principal, total_rate_pct,
                            promised_yield, payout_total, matures_at, idem_key)
  values (v_me.user_id, v_product.id, to_jsonb(v_product), p_principal, v_product.total_rate_pct,
          v_yield, v_payout,
          app_cycle_day_due(now(), v_product.duration_days - 1), p_idem_key)
  returning * into v_cycle;

  perform app_debit(v_me.user_id, p_principal, 'vault_debit', 'vault_cycles', v_cycle.id,
                    'Vault ' || v_product.slug);

  return to_jsonb(v_cycle);
end $$;

-- 4f. THE DAILY-CREDIT ENGINE (see rpc.sql header for the full contract).
create or replace function app_settle_matured() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cycle vault_cycles;
  v_days integer;
  v_next integer;
  v_amount numeric(16,2);
  v_idem text;
  v_days_paid integer := 0;
  v_yield_total numeric(16,2) := 0;
  v_closed integer := 0;
  v_failed integer := 0;
begin
  for v_cycle in
    select * from vault_cycles
      where status = 'open'
        and app_cycle_day_due(opened_at, days_paid) <= now()
      order by matures_at
      for update skip locked
  loop
    v_days := nullif(v_cycle.product_snapshot ->> 'duration_days', '')::integer;

    -- Paid in full by the lump-sum code (or a crashed run): close, backfill,
    -- never credit again.
    if v_days is not null and exists (select 1 from ledger
        where idem_key = 'vault_payout:' || v_cycle.id and kind = 'vault_payout') then
      update vault_cycles
         set status = 'closed', closed_at = coalesce(closed_at, now()),
             days_paid = v_days, yield_paid = v_cycle.promised_yield
       where id = v_cycle.id;
      v_closed := v_closed + 1;
      continue;
    end if;

    begin
      if v_days is null or v_days < 1 then
        raise exception 'SNAPSHOT_MISSING: cycle % has no usable duration_days', v_cycle.id;
      end if;
      v_next := v_cycle.days_paid;
      while v_next < v_days and app_cycle_day_due(v_cycle.opened_at, v_next) <= now() loop
        v_amount := case when v_next = v_days - 1
                     then v_cycle.promised_yield - v_cycle.yield_paid
                     else round(v_cycle.promised_yield / v_days, 2)
                   end;
        v_idem := 'vault_earn:' || v_cycle.id || ':' || (v_next + 1);
        if v_amount > 0
           and not exists (select 1 from ledger where idem_key = v_idem) then
          perform app_credit(v_cycle.user_id, v_amount, 'vault_earning',
                             'vault_cycles', v_cycle.id,
                             (v_cycle.product_snapshot ->> 'name')
                               || ' · day ' || (v_next + 1) || ' of ' || v_days,
                             v_idem);
        end if;
        if v_amount > 0 then
          v_cycle.yield_paid := v_cycle.yield_paid + v_amount;
          v_days_paid := v_days_paid + 1;
          v_yield_total := v_yield_total + v_amount;
        end if;
        v_next := v_next + 1;
        update vault_cycles
           set days_paid = v_next, yield_paid = v_cycle.yield_paid, last_paid_at = now()
         where id = v_cycle.id;
      end loop;

      if v_next >= v_days then
        if v_cycle.principal > 0 then
          perform app_credit(v_cycle.user_id, v_cycle.principal, 'vault_payout',
                             'vault_cycles', v_cycle.id,
                             'Maturity · principal return ' || (v_cycle.product_snapshot ->> 'name'),
                             'vault_payout:' || v_cycle.id);
        end if;
        update vault_cycles set status = 'closed', closed_at = now(), last_paid_at = now()
          where id = v_cycle.id;
        v_closed := v_closed + 1;
      end if;
    exception when others then
      raise notice 'app_settle_matured: cycle % skipped (%)', v_cycle.id, SQLERRM;
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('settled', v_closed, 'closed', v_closed,
                            'days_credited', v_days_paid, 'yield_credited', v_yield_total,
                            'failed', v_failed);
end $$;

-- 4g. Dashboard: cycles carry the day counters; rules drop lock_at.
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
      'withdraw_window_to', app_setting_text('withdraw_window_to', '22:00'),
      'timezone', app_setting_text('timezone', 'Africa/Kampala'),
      'withdrawals_open', app_withdrawals_open(),
      'settlement_hour', app_setting_text('settlement_hour', '22:00'),
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
                   days_paid, yield_paid, last_paid_at,
                   (product_snapshot ->> 'duration_days')::int as duration_days,
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

-- 4h. Public marketing reads: same rule changes.
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
      'withdraw_window_to', app_setting_text('withdraw_window_to', '22:00'),
      'timezone', app_setting_text('timezone', 'Africa/Kampala'),
      'withdrawals_open', app_withdrawals_open(),
      'settlement_hour', app_setting_text('settlement_hour', '22:00'),
      'platform_paused', app_setting_bool('platform_paused', false)),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'name', p.name, 'min_principal', p.min_principal,
        'max_principal', p.max_principal, 'duration_days', p.duration_days,
        'total_rate_pct', p.total_rate_pct, 'early_exit_percent', p.early_exit_percent,
        'terms', p.terms) order by p.duration_days), '[]'::jsonb)
      from vault_products p where p.visible and p.active)
  )
$$;

-- 4i. Admin settings whitelist: lock_at is gone; window fallbacks equal.
create or replace function app_admin_setting_spec() returns table (
  key text, kind text, label text, hint text
)
language sql stable as $$
  select * from (values
    ('min_deposit',            'number', 'Minimum deposit (UGX)',        'Smallest accepted top-up.'),
    ('min_withdrawal',         'number', 'Minimum withdrawal (UGX)',     'Smallest allowed payout.'),
    ('withdrawal_fee_percent', 'number', 'Withdrawal fee (%)',           'Flat percent of the withdrawal amount; shown up-front.'),
    ('withdraw_window_from',   'time',   'Withdrawals open at (HH:MM)',  'Member wall-clock time in the timezone below.'),
    ('withdraw_window_to',     'time',   'Withdrawals close at (HH:MM)', 'Requests outside the window are refused (deposits and vaults are unaffected).'),
    ('timezone',               'text',   'Rules timezone',               'IANA zone name, e.g. Africa/Kampala. Drives the withdrawal window and the desk clock.'),
    ('signup_bonus',           'number', 'Welcome bonus (UGX)',          'One-time credit on the member''s first sign-in. 0 disables.'),
    ('checkin_bonus',          'number', 'Daily check-in reward (UGX)',  'Credited once per platform-timezone day from the Home tab. 0 disables.'),
    ('referral_commission_percent', 'number', 'Referral commission L1 (%)', 'Paid to the direct referrer on EVERY confirmed deposit by their referee. 0 disables.'),
    ('referral_commission_l2_percent', 'number', 'Referral commission L2 (%)', 'Paid to the referrer''s own referrer (2nd generation) on EVERY confirmed deposit. 0 disables.'),
    ('settlement_hour',        'time',   'Settlement hour (HH:MM)',      'Each vault day''s earning matures at this wall-clock hour in the rules timezone; pg_cron releases the daily credits minutes after it.'),
    ('platform_paused',        'bool',   'Pause money movement',         'Blocks deposits/withdrawals/vault operations (reads keep working).'),
    ('pause_message',          'text',   'Pause message',                'Shown to members while paused.'),
    ('support_contact',        'text',   'Support contact',              'Shown in member UI.'),
    ('community_link',         'link',   'Community channel link',       'Opened by the "Community" button on the Home tab (Telegram channel). Full https:// URL; empty hides the button.'),
    ('support_link',           'link',   'Support chat link',            'Opened by the "Support" button on the Home tab (chat, e.g. a t.me username DM). Full https:// URL; empty hides the button.'),
    ('auth_email_domain',      'text',   'Login email host',             'Usernames sign in as username@<this>; no mail is ever sent. Set BEFORE the first signup — it freezes once members exist (changing it breaks every login).')
  ) as t(key, kind, label, hint);
$$;

-- ----------------------------------------------------------------------------
-- 5. Product terms: honest daily-credit copy (seeds use ON CONFLICT DO NOTHING,
--    so live rows need this explicit UPDATE).
-- ----------------------------------------------------------------------------
update vault_products set terms =
  'Swap 10,000 UGX · credited daily at 22:00: 2,250 UGX every day for 10 days · total profit 22,500. Your principal returns with the final credit. Early exit returns 90% of principal; unearned yield is forfeited.'
  where slug = 'spark';
update vault_products set terms =
  'Swap 30,000 UGX · credited daily at 22:00: 6,000 UGX every day for 15 days · total profit 90,000. Your principal returns with the final credit. Early exit returns 90% of principal; unearned yield is forfeited.'
  where slug = 'comet';
update vault_products set terms =
  'Swap 80,000 UGX · credited daily at 22:00: 21,875 UGX every day for 20 days · total profit 437,500. Your principal returns with the final credit. Early exit returns 90% of principal; unearned yield is forfeited.'
  where slug = 'nova';
update vault_products set terms =
  'Swap 150,000 UGX · credited daily at 22:00: 30,000 UGX every day for 25 days · total profit 750,000. Your principal returns with the final credit. Early exit returns 90% of principal; unearned yield is forfeited.'
  where slug = 'quasar';
update vault_products set terms =
  'Swap 300,000 UGX · credited daily at 22:00: 50,090 UGX every day for 30 days · total profit 1,502,700. Your principal returns with the final credit. Early exit returns 90% of principal; unearned yield is forfeited.'
  where slug = 'galaxy';

-- ----------------------------------------------------------------------------
-- 6. Grants for the new helper (signatures unchanged elsewhere, so existing
--    grants still apply). Internal helper: no client role may call it.
-- ----------------------------------------------------------------------------
revoke all on function app_cycle_day_due(timestamptz, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. pg_cron: the primary daily trigger at 22:05 EAT (19:05 UTC — Supabase
--    servers run UTC). The function computes due times from settings, so the
--    job stays correct even if settlement_hour moves; a missed run catches up
--    thanks to the due-day loop. Scheduling runs as the operator role and the
--    function is SECURITY DEFINER, so no service key is involved here.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron could not be created here (%): enable it in the Supabase Dashboard → Database → Extensions, then re-run section 7.', SQLERRM;
end $$;

do $$
begin
  perform cron.schedule(
    'vault-daily-credits',
    '5 19 * * *',                                  -- 22:05 Africa/Kampala (UTC server clock)
    $$ select public.app_settle_matured(); $$
  );
  raise notice 'vault-daily-credits cron scheduled (daily 19:05 UTC / 22:05 EAT)';
exception when others then
  raise warning 'Could not schedule the pg_cron job (%). Until it is scheduled, POST /api/settle (or the Vercel cron) must fire daily — the function itself is replay-safe.', SQLERRM;
end $$;
