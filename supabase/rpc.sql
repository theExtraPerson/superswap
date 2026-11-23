-- ============================================================================
-- SuperSwap — member RPC layer (run after schema.sql)
-- All money movement happens here: SECURITY DEFINER functions, auth.uid()
-- identity only, append-only ledger, client idempotency keys, and the
-- reserve-coverage gate that makes every promised payout a kept promise.
-- ============================================================================

-- ---------------------------------------------------------------- settings
create or replace function app_setting_text(p_key text, p_default text default '') returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from platform_settings where key = p_key), p_default)
$$;

create or replace function app_setting_num(p_key text, p_default numeric default 0) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select value::numeric from platform_settings where key = p_key), p_default)
$$;

create or replace function app_setting_time(p_key text, p_default time default '00:00') returns time
language sql stable security definer set search_path = public as $$
  select coalesce((select value::time from platform_settings where key = p_key), p_default)
$$;

create or replace function app_setting_bool(p_key text, p_default boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value::boolean from platform_settings where key = p_key), p_default)
$$;

-- ---------------------------------------------------------------- clock
-- Member-facing time rules are wall-clock in the platform timezone (Supabase
-- Postgres runs UTC, so `localtime`/`now()` alone would shift them by 3h for
-- Uganda). 'now() at time zone X' yields the wall clock inside X.
create or replace function app_clock() returns time
language sql stable security definer set search_path = public as $$
  select (now() at time zone app_setting_text('timezone', 'Africa/Kampala'))::time
$$;

-- Abbreviation of that zone (EAT, UTC, ...) for human-readable messages.
-- Read from the tz catalogue: to_char(..., 'TZ') on a wall-clock timestamp
-- would report the SESSION zone instead, which is never what members are told.
create or replace function app_clock_label() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.abbrev from pg_timezone_names t
      where t.name = app_setting_text('timezone', 'Africa/Kampala')
      order by t.is_dst limit 1),
    app_setting_text('timezone', 'Africa/Kampala')
  )
$$;

-- The platform-timezone calendar day — the unit of the daily check-in.
create or replace function app_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone app_setting_text('timezone', 'Africa/Kampala'))::date
$$;

-- Are withdrawal requests accepted at this instant? (window is inclusive)
create or replace function app_withdrawals_open() returns boolean
language sql stable security definer set search_path = public as $$
  select app_clock() between app_setting_time('withdraw_window_from', '09:00')
                         and app_setting_time('withdraw_window_to', '21:00')
$$;

-- ---------------------------------------------------------------- gates
-- Platform pause + the daily books-close lock. The lock keeps its historical
-- DB-clock semantics; the withdrawal window (below) is the Kampala one.
create or replace function app_assert_running() returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_lock_from time := app_setting_time('lock_at', '19:45');
  v_lock_to time := v_lock_from + interval '2 hours';
begin
  if app_setting_bool('platform_paused', false) then
    raise exception 'PLATFORM_PAUSED: %',
      nullif(app_setting_text('pause_message', ''), 'Money movement is briefly paused.');
  end if;
  if localtime between v_lock_from and v_lock_to then
    raise exception 'DAILY_LOCK: Money movement is locked %-% each day while the books close.', v_lock_from, v_lock_to;
  end if;
end $$;

-- Withdrawal requests alone are confined to the published window, so the
-- queue the operator works by day matches the desk's opening hours.
create or replace function app_assert_withdrawal_window() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if app_withdrawals_open() then return; end if;
  raise exception 'OUTSIDE_WINDOW: Withdrawals open %–% (%).',
    app_setting_time('withdraw_window_from', '09:00'),
    app_setting_time('withdraw_window_to', '21:00'),
    app_clock_label();
end $$;

create or replace function app_profile() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row profiles;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED: Sign in first.'; end if;
  select * into v_row from profiles where user_id = v_uid;
  if not found then raise exception 'PROFILE_MISSING: Account not initialised.'; end if;
  if v_row.is_banned then raise exception 'ACCOUNT_RESTRICTED: Contact support.'; end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------- reserve maths
-- Total member claims the operator float must cover at this instant:
-- cash balances + every open vault's full payout (principal + promised yield).
create or replace function app_obligations() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(wallet_balance) from profiles), 0)
       + coalesce((select sum(payout_total) from vault_cycles where status = 'open'), 0)
$$;

create or replace function app_coverage() returns numeric
language sql stable security definer set search_path = public as $$
  select case when app_obligations() = 0 then 100
    else round(100 * (select balance from reserve where id = 1) / app_obligations(), 2)
  end
$$;

-- Refuse anything that would take the reserve below 100% coverage.
-- p_new_yield: additional promised yield created by this operation (0 if none).
create or replace function app_assert_solvent(p_new_yield numeric default 0) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if (select balance from reserve where id = 1) < app_obligations() + coalesce(p_new_yield, 0) then
    raise exception 'INSUFFICIENT_RESERVE: The yield reserve cannot cover this promise. The operator must top up the reserve first.';
  end if;
end $$;

-- ---------------------------------------------------------------- wallet primitives
create or replace function app_credit(
  p_user uuid, p_amount numeric, p_kind text,
  p_ref_table text default null, p_ref_id bigint default null,
  p_note text default null, p_idem_key text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_new numeric;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT: Credit must be positive.'; end if;
  update profiles set wallet_balance = wallet_balance + p_amount where user_id = p_user
    returning wallet_balance into v_new;
  insert into ledger (user_id, amount, kind, balance_after, ref_table, ref_id, note, idem_key)
    values (p_user, p_amount, p_kind, v_new, p_ref_table, p_ref_id, p_note, p_idem_key);
  return v_new;
end $$;

create or replace function app_debit(
  p_user uuid, p_amount numeric, p_kind text,
  p_ref_table text default null, p_ref_id bigint default null,
  p_note text default null, p_idem_key text default null,
  p_min_balance numeric default 0
) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_new numeric;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT: Debit must be positive.'; end if;
  update profiles set wallet_balance = wallet_balance - p_amount
    where user_id = p_user and wallet_balance - p_amount >= p_min_balance
    returning wallet_balance into v_new;
  if not found then raise exception 'INSUFFICIENT_FUNDS: Not enough available balance.'; end if;
  insert into ledger (user_id, amount, kind, balance_after, ref_table, ref_id, note, idem_key)
    values (p_user, -p_amount, p_kind, v_new, p_ref_table, p_ref_id, p_note, p_idem_key);
  return v_new;
end $$;

-- ---------------------------------------------------------------- promo credits
-- Marketing promises (sign-up bonus, L1 referral commission) are operator
-- spend rather than member cash-in, so — by product decision — they skip the
-- solvency gate. To keep the published coverage number true, each promo credit
-- is mirrored into the reserve as a non-cash 'promo_overlay' entry: reserve
-- and obligations rise by the same amount, coverage does not move, and the
-- overlay is not free cash (app_admin_draw_reserve measures reserve -
-- obligations, which the overlay leaves unchanged).
-- Idempotent on p_idem_key: a promo is never paid twice.
create or replace function app_promo_credit(
  p_user uuid, p_amount numeric, p_kind text,
  p_ref_table text default null, p_ref_id bigint default null,
  p_note text default null, p_idem_key text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_reserve numeric;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  if p_idem_key is not null
     and exists (select 1 from ledger where idem_key = p_idem_key and kind = p_kind) then
    return null;                                     -- already granted
  end if;

  update reserve set balance = balance + p_amount, updated_at = now()
    where id = 1 returning balance into v_reserve;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
  values (p_amount, 'promo_overlay', v_reserve, null,
          'Overlay for ' || p_kind || coalesce(' (' || p_note || ')', ''),
          null, case when p_idem_key is null then null else 'overlay:' || p_idem_key end);

  return app_credit(p_user, p_amount, p_kind, p_ref_table, p_ref_id, p_note, p_idem_key);
end $$;

-- One-time sign-up bonus, claimed by the member's own session: the auth routes
-- call it right after a successful sign-in, so it lands on first login.
create or replace function app_claim_signup_bonus() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles := app_profile();
  v_amount numeric := app_setting_num('signup_bonus', 1500);
  v_balance numeric;
begin
  if coalesce(v_amount, 0) <= 0 then
    return jsonb_build_object('credited', 0, 'status', 'disabled',
                              'wallet_balance', v_me.wallet_balance);
  end if;

  v_balance := app_promo_credit(v_me.user_id, v_amount, 'bonus_credit', 'profiles', null,
                                'Welcome bonus', 'signup_bonus:' || v_me.user_id);
  if v_balance is null then
    return jsonb_build_object('credited', 0, 'status', 'already_claimed',
                              'wallet_balance', v_me.wallet_balance);
  end if;
  return jsonb_build_object('credited', v_amount, 'status', 'credited',
                            'wallet_balance', v_balance);
end $$;

-- Consecutive check-in days ending today (yesterday's run continues until the
-- current day if today is not claimed yet — the Home tab shows it either way).
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
    if v_streak >= 366 then exit; end if;                    -- hard safety stop
  end loop;
  return v_streak;
end $$;

-- Daily check-in reward: once per platform-timezone day, overlay-funded like
-- every other promo (coverage-neutral). The (user_id, day) primary key is the
-- replay guard; the ledger idem key doubles it for money movement.
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

-- ---------------------------------------------------------------- auth helpers (called by API routes)
-- Username -> synthetic email. The login handle is the username, so the host
-- comes from platform_settings.auth_email_domain. A malformed host (unset, or a
-- reserved TLD such as *.local) makes GoTrue reject the signup with an opaque
-- 400 that reads as a server fault everywhere downstream — so emit NULL and let
-- the routes answer AUTH_NOT_CONFIGURED instead of inventing a dead address.
create or replace function app_auth_email(p_username text) returns text
language sql stable security definer set search_path = public as $$
  select case
           when d.domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
                and d.domain !~ '\.(local|localhost|test|example|invalid|onion)$'
           then lower(trim(p_username)) || '@' || d.domain
         end
    from (select lower(trim(coalesce(app_setting_text('auth_email_domain', ''), ''))) as domain) d
   where lower(trim(coalesce(p_username, ''))) <> ''
$$;

-- Pre-signup availability check (the real guard is the unique index + trigger).
create or replace function app_username_taken(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where username = lower(trim(p_username)))
$$;

-- Pre-signup referral code validity check (existence only, no identity leak).
create or replace function app_referral_valid(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where referral_code = upper(trim(p_code)))
$$;

-- ---------------------------------------------------------------- dashboard
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

-- ---------------------------------------------------------------- vaults
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

  -- THE GATE: this exact promise must be funded before it can be made.
  perform app_assert_solvent(v_yield);

  -- Cycle first: its unique idem key is the atomic replay guard.
  insert into vault_cycles (user_id, product_id, product_snapshot, principal, total_rate_pct,
                            promised_yield, payout_total, matures_at, idem_key)
  values (v_me.user_id, v_product.id, to_jsonb(v_product), p_principal, v_product.total_rate_pct,
          v_yield, v_payout,
          (date_trunc('day', now()) + app_setting_time('settlement_hour', '22:00')::interval
            + make_interval(days => v_product.duration_days)), p_idem_key)
  returning * into v_cycle;

  perform app_debit(v_me.user_id, p_principal, 'vault_debit', 'vault_cycles', v_cycle.id,
                    'Vault ' || v_product.slug);

  return to_jsonb(v_cycle);
end $$;

-- Early exit: principal x disclosed % comes back; unearned yield is forfeited.
create or replace function app_exit_vault(p_cycle_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles := app_profile();
  v_cycle vault_cycles;
  v_return numeric(16,2);
begin
  perform app_assert_running();
  select * into v_cycle from vault_cycles
    where id = p_cycle_id and user_id = v_me.user_id and status = 'open'
    for update;
  if not found then raise exception 'CYCLE_NOT_OPEN: Vault not found or already closed.'; end if;

  v_return := round(v_cycle.principal
    * coalesce((v_cycle.product_snapshot ->> 'early_exit_percent')::numeric, 90) / 100, 2);

  update vault_cycles set status = 'exited', closed_at = now(),
         note = 'Early exit; forfeited yield ' || (v_cycle.payout_total - v_return)
    where id = v_cycle.id;

  if v_return > 0 then
    perform app_credit(v_me.user_id, v_return, 'vault_exit_credit', 'vault_cycles', v_cycle.id,
                       'Early exit ' || (v_cycle.product_snapshot ->> 'name'));
  end if;
  return to_jsonb(v_cycle);
end $$;

-- Cron (also admin-runnable): close matured open vaults, credit full payouts.
-- Safe any time; pays out at most once per cycle.
create or replace function app_settle_matured() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cycle vault_cycles;
  v_count integer := 0;
  v_total numeric(16,2) := 0;
begin
  for v_cycle in
    select * from vault_cycles
      where status = 'open' and matures_at <= now()
      order by matures_at for update skip locked limit 500
  loop
    perform app_credit(v_cycle.user_id, v_cycle.payout_total, 'vault_payout',
                       'vault_cycles', v_cycle.id,
                       'Maturity ' || (v_cycle.product_snapshot ->> 'name'),
                       'vault_payout:' || v_cycle.id);
    update vault_cycles set status = 'closed', closed_at = now() where id = v_cycle.id;
    v_count := v_count + 1;
    v_total := v_total + v_cycle.payout_total;
  end loop;
  return jsonb_build_object('settled', v_count, 'paid_total', v_total);
end $$;

-- ---------------------------------------------------------------- deposits
-- Records the intent; a momo deposit then rides the Shashura requestToPay
-- fired by /api/deposits and CREDITS ITSELF when the signed webhook confirms
-- (app_hook_shashura -> app_deposit_credited_core). Bank/off-platform rows
-- wait for an operator (app_admin_confirm_deposit) — the fallback, not the
-- main road.
create or replace function app_open_deposit(
  p_amount numeric, p_channel text, p_payer_account text,
  p_reference text default null, p_idem_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles := app_profile();
  v_min numeric := app_setting_num('min_deposit', 10000);
  v_deposit deposits;
begin
  perform app_assert_running();
  if p_amount < v_min then raise exception 'BELOW_MINIMUM: Minimum deposit is %.', v_min; end if;
  if p_channel not in ('momo', 'bank') then raise exception 'INVALID_CHANNEL: momo or bank.'; end if;
  if coalesce(trim(p_payer_account), '') = '' then
    raise exception 'MISSING_ACCOUNT: Provide the account/number you are sending from.';
  end if;

  if p_idem_key is null then p_idem_key := 'dep:' || gen_random_uuid(); end if;
  begin
    insert into deposits (user_id, amount, channel, payer_account, reference, idem_key)
    values (v_me.user_id, p_amount, p_channel, trim(p_payer_account),
            nullif(trim(coalesce(p_reference, '')), ''), p_idem_key)
    returning * into v_deposit;
  exception when unique_violation then
    select * into v_deposit from deposits where idem_key = p_idem_key;
    if v_deposit.user_id <> auth.uid() then raise exception 'FORBIDDEN: Idempotency key already used.'; end if;
  end;
  return to_jsonb(v_deposit);
end $$;

-- ---------------------------------------------------------------- withdrawals
-- Wallet is debited at REQUEST time (funds are now reserved for the member);
-- operator settlement moves the reserve and records the fee.
create or replace function app_open_withdrawal(
  p_amount numeric, p_channel text, p_destination_account text, p_idem_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me profiles := app_profile();
  v_min numeric := app_setting_num('min_withdrawal', 5000);
  v_fee_pct numeric := app_setting_num('withdrawal_fee_percent', 17);
  v_fee numeric(16,2);
  v_idem text := coalesce(p_idem_key, 'wd:' || gen_random_uuid());
  v_existing withdrawals;
  v_row withdrawals;
begin
  perform app_assert_running();
  perform app_assert_withdrawal_window();
  if p_amount < v_min then raise exception 'BELOW_MINIMUM: Minimum withdrawal is %.', v_min; end if;
  if p_channel not in ('momo', 'bank') then raise exception 'INVALID_CHANNEL: momo or bank.'; end if;
  if coalesce(trim(p_destination_account), '') = '' then
    raise exception 'MISSING_ACCOUNT: Provide the number/account to pay out to.';
  end if;

  select * into v_existing from withdrawals where idem_key = v_idem;
  if found then
    if v_existing.user_id <> auth.uid() then raise exception 'FORBIDDEN: Idempotency key already used.'; end if;
    return to_jsonb(v_existing);
  end if;

  v_fee := round(p_amount * v_fee_pct / 100, 2);
  if p_amount - v_fee <= 0 then raise exception 'INVALID_AMOUNT: Payout would be zero after fees.'; end if;

  perform app_debit(v_me.user_id, p_amount, 'withdrawal_debit', 'withdrawals', null,
                    'Withdrawal request', v_idem);

  insert into withdrawals (user_id, amount, fee_amount, payout_amount, channel, destination_account, idem_key)
  values (v_me.user_id, p_amount, v_fee, p_amount - v_fee, p_channel, trim(p_destination_account), v_idem)
  returning * into v_row;

  update ledger set ref_id = v_row.id
    where user_id = v_me.user_id and kind = 'withdrawal_debit' and idem_key = v_idem;

  return to_jsonb(v_row);
end $$;

-- ---------------------------------------------------------------- team & commissions
-- One level only: the direct referrer earns a percent of each deposit their
-- referee makes (paid inside app_admin_confirm_deposit). No commission on
-- commissions — an L2 chain is not modelled anywhere, by design.
create or replace function app_team() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me profiles := app_profile();
begin
  return jsonb_build_object(
    'referral_code', v_me.referral_code,
    'commission_percent', app_setting_num('referral_commission_percent', 18),
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
    'referral_credits', (select coalesce(sum(amount), 0) from ledger
      where user_id = v_me.user_id and kind = 'referral_reward')
  );
end $$;

-- ---------------------------------------------------------------- grants
grant execute on function app_setting_text(text, text) to anon, authenticated;
grant execute on function app_setting_num(text, numeric) to anon, authenticated;
grant execute on function app_setting_time(text, time) to anon, authenticated;
grant execute on function app_setting_bool(text, boolean) to anon, authenticated;
grant execute on function app_auth_email(text) to anon, authenticated;
grant execute on function app_username_taken(text) to anon, authenticated;
grant execute on function app_referral_valid(text) to anon, authenticated;
grant execute on function app_coverage() to anon;
grant execute on function app_obligations() to anon;
grant execute on function app_clock() to anon, authenticated;
grant execute on function app_clock_label() to anon, authenticated;
grant execute on function app_withdrawals_open() to anon, authenticated;
grant execute on function app_assert_running() to authenticated;
grant execute on function app_assert_withdrawal_window() to authenticated;
grant execute on function app_profile() to authenticated;
grant execute on function app_dashboard() to authenticated;
grant execute on function app_claim_signup_bonus() to authenticated;
grant execute on function app_today() to anon, authenticated;
grant execute on function app_checkin() to authenticated;
grant execute on function app_open_vault(integer, numeric, text) to authenticated;
grant execute on function app_exit_vault(bigint) to authenticated;
grant execute on function app_settle_matured() to authenticated, service_role;
grant execute on function app_open_deposit(numeric, text, text, text, text) to authenticated;
grant execute on function app_open_withdrawal(numeric, text, text, text) to authenticated;
grant execute on function app_team() to authenticated;
revoke all on function app_credit, app_debit, app_assert_solvent from public, anon, authenticated;
-- Promo plumbing is internal: only the definer functions above may grant a promo.
revoke all on function app_promo_credit(uuid, numeric, text, text, bigint, text, text)
  from public, anon, authenticated;
-- Streak maths is internal: the dashboard and app_checkin expose the number.
revoke all on function app_checkin_streak(uuid) from public, anon, authenticated;

-- ============================================================================
-- Public marketing reads (no session required)
-- ============================================================================
create or replace function app_public_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
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
      'platform_paused', app_setting_bool('platform_paused', false)),
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'name', p.name, 'min_principal', p.min_principal,
        'max_principal', p.max_principal, 'duration_days', p.duration_days,
        'total_rate_pct', p.total_rate_pct, 'early_exit_percent', p.early_exit_percent,
        'terms', p.terms) order by p.duration_days), '[]'::jsonb)
      from vault_products p where p.visible and p.active),
    'coverage_pct', app_coverage()
  )
$$;
grant execute on function app_public_info() to anon, authenticated;
