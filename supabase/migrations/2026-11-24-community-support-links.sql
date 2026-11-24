-- ============================================================================
-- 2026-11-24 · Community & Support links + self-service password reset
-- ----------------------------------------------------------------------------
-- Two independent Home-tab affordances, both admin-editable without a deploy:
--   * community_link — the Telegram channel behind the "Community" button
--     (seeded with the published invite link);
--   * support_link   — the chat behind the "Support" button (empty = hidden
--     until the operator publishes one).
-- Plus the identity RPC behind /api/auth/password-reset: there is no mail
-- server (usernames sign in as <name>@<synthetic host>), so a member who
-- forgot their password proves identity with username + the phone they
-- registered with, and the server route performs the reset with the
-- service-role key. No password ever touches Postgres.
--
-- Run AFTER 2026-11-24-remove-reserve-functions.sql and
-- 2026-11-24-referral-league-and-eat-settlement.sql, but the bodies below are
-- byte-identical to supabase/rpc.sql + admin.sql, so any run order converges.
-- Idempotent: re-running changes nothing.
-- ============================================================================

-- 1 · Settings seeds — fresh DBs get the channel; a deployed project edits
-- these through the admin desk (do nothing keeps any operator change).
insert into platform_settings (key, value) values
  ('community_link', 'https://t.me/+D8o6_tUFNbFjNjE0'),
  ('support_link', '')
on conflict (key) do nothing;

-- 2 · Password-reset identity check (see header). Grants at the bottom.
create or replace function app_password_reset_verify(p_username text, p_phone text) returns uuid
language sql stable security definer set search_path = public as $$
  select pr.user_id
    from profiles pr
   where pr.username = lower(trim(p_username))
     and right(regexp_replace(pr.phone, '\D', '', 'g'), 9)
         = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9)
     and not pr.is_banned
$$;

-- 3 · Dashboard rules now carry both links so the member desk can render the
-- buttons with no extra round-trip. Byte-identical to supabase/rpc.sql.
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

-- 4 · Admin whitelist grows the two links (kind 'link': full https URL or
-- empty). Byte-identical to supabase/admin.sql.
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
    ('settlement_hour',        'time',   'Settlement hour (HH:MM)',      'Vaults mature at this wall-clock hour in the rules timezone; pg_cron releases payouts daily right after it.'),
    ('lock_at',                'time',   'Daily lock start (HH:MM)',     'All money movement locked for 2 hours from this time. Uses the database clock (UTC on Supabase), not the timezone above.'),
    ('platform_paused',        'bool',   'Pause money movement',         'Blocks deposits/withdrawals/vault operations (reads keep working).'),
    ('pause_message',          'text',   'Pause message',                'Shown to members while paused.'),
    ('support_contact',        'text',   'Support contact',              'Shown in member UI.'),
    ('community_link',         'link',   'Community channel link',       'Opened by the "Community" button on the Home tab (Telegram channel). Full https:// URL; empty hides the button.'),
    ('support_link',           'link',   'Support chat link',            'Opened by the "Support" button on the Home tab (chat, e.g. a t.me username DM). Full https:// URL; empty hides the button.'),
    ('auth_email_domain',      'text',   'Login email host',             'Usernames sign in as username@<this>; no mail is ever sent. Set BEFORE the first signup — it freezes once members exist (changing it breaks every login).')
  ) as t(key, kind, label, hint);
$$;

-- 5 · Setter learns the 'link' kind. Byte-identical to supabase/admin.sql.
create or replace function app_admin_set_setting(p_key text, p_value text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_kind text;
begin
  select kind into v_kind from app_admin_setting_spec() where key = p_key;
  if v_kind is null then raise exception 'INVALID_REQUEST: Setting % is not manageable here.', p_key; end if;

  if v_kind = 'number' and p_value !~ '^[0-9]+(\.[0-9]{1,4})?$' then
    raise exception 'INVALID_REQUEST: % must be a non-negative number.', p_key;
  end if;
  if v_kind = 'bool' and p_value not in ('true', 'false') then
    raise exception 'INVALID_REQUEST: % must be true or false.', p_key;
  end if;
  if v_kind = 'time' and p_value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'INVALID_REQUEST: % must be HH:MM (24h).', p_key;
  end if;
  if v_kind = 'text' and char_length(p_value) > 300 then
    raise exception 'INVALID_REQUEST: % too long (max 300).', p_key;
  end if;
  -- Link settings are clicked straight into an <a href>, so demand a full URL
  -- (or empty, which hides the member-facing button) — never javascript:, etc.
  if v_kind = 'link' and p_value <> '' and p_value !~ '^https?://\S+$' then
    raise exception 'INVALID_REQUEST: % must be a full https:// URL, or empty to hide the button.', p_key;
  end if;
  -- A bad zone name would break every clock-derived rule, so it must be real.
  if p_key = 'timezone' and not pg_timezone_exists(p_value) then
    raise exception 'INVALID_REQUEST: timezone must be an IANA zone name, e.g. Africa/Kampala.';
  end if;
  -- The synthetic login host is normalized exactly as app_auth_email() reads it
  -- (a pasted URL collapses to its hostname), must be a public name, and is
  -- frozen once any member exists — their login address is derived from it.
  if p_key = 'auth_email_domain' then
    p_value := regexp_replace(
      lower(trim(split_part(replace(replace(p_value, 'https://', ''), 'http://', ''), '/', 1))),
      '\.$', '');
    if p_value !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
       or p_value ~ '\.(local|localhost|test|example|invalid|onion)$' then
      raise exception 'INVALID_REQUEST: auth_email_domain must be a public hostname, e.g. accounts.example.com.';
    end if;
    if exists (select 1 from profiles)
       and p_value <> coalesce((select value from platform_settings where key = 'auth_email_domain'), '') then
      raise exception 'INVALID_REQUEST: auth_email_domain is frozen once members exist — changing it would break every login.';
    end if;
  end if;

  insert into platform_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  -- The window must stay usable; raising aborts the whole transaction.
  if p_key in ('withdraw_window_from', 'withdraw_window_to') then
    if app_setting_time('withdraw_window_from', '09:00') >= app_setting_time('withdraw_window_to', '21:00') then
      raise exception 'INVALID_REQUEST: The withdrawal window must open before it closes.';
    end if;
  end if;

  perform app_admin_log('set_setting', p_key, p_value);
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- 6 · Grants. The reset verifier is called by the public server route before
-- anyone signs in, so anon needs it (the route, not the browser, holds it).
grant execute on function app_password_reset_verify(text, text) to anon, authenticated;
grant execute on function app_dashboard() to authenticated;
grant execute on function app_admin_setting_spec() to authenticated;
grant execute on function app_admin_set_setting(text, text) to authenticated;
revoke all on function app_admin_setting_spec() from public, anon;

-- ----------------------------------------------------------------------------
-- Sanity — prints one NOTICE when everything landed.
-- ----------------------------------------------------------------------------
do $$
declare
  v_community text;
  v_src text;
begin
  select value into v_community from platform_settings where key = 'community_link';
  if v_community is null then
    raise exception 'community_link setting missing — seed did not run';
  end if;
  select prosrc into v_src from pg_proc where proname = 'app_dashboard';
  if v_src not like '%community_link%' then
    raise exception 'app_dashboard does not expose community_link — redeploy failed';
  end if;
  if not has_function_privilege('anon', 'app_password_reset_verify(text, text)', 'EXECUTE') then
    raise exception 'app_password_reset_verify is not granted to anon';
  end if;
  raise notice 'community/support links + reset verifier in place (channel: %)', v_community;
end $$;
