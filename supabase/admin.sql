-- ============================================================================
-- SuperSwap — admin / operations layer (run after rpc.sql)
-- Membership in `admins` IS admin access. Every privileged RPC calls
-- app_admin_guard() first and writes app_admin_audit last, in SQL — the API
-- routes never decide authorization.
--
-- Settlement (MVP rails): deposits/withdrawals queue up; the operator moves
-- real money off-platform, then confirms here. Confirmation is idempotent
-- (payment_events + ledger idem keys) and keeps the reserve in lockstep:
--   confirm deposit  -> wallet +amount, reserve +amount (declared received)
--   pay withdrawal   -> reserve -payout, +fee income
--   open vault       -> reserve must already cover the promise (rpc.sql gate)
--   withdrawal       -> BLOCKED while coverage < 100%
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,                 -- username at grant time (synthetic emails are unstable)
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists admin_handles (
  handle text primary key,              -- queued username
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists admin_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users (id) on delete set null,
  actor_username text,
  action text not null,
  target text,
  detail text,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;
alter table admin_handles enable row level security;
alter table admin_audit enable row level security;
-- No policies: readable/writable only through the definer functions below.

-- ----------------------------------------------------------------------------
-- Guard / identity / audit
-- ----------------------------------------------------------------------------
create or replace function app_admin_guard() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED: Sign in first.'; end if;
  if not exists (select 1 from admins where user_id = v_uid) then
    raise exception 'FORBIDDEN: Admin access required.';
  end if;
  return v_uid;
end $$;

create or replace function app_admin_self() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_is boolean;
  v_profile jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED: Sign in first.'; end if;
  select exists (select 1 from admins where user_id = v_uid) into v_is;
  if v_is then
    select jsonb_build_object('user_id', p.user_id, 'display_name', p.display_name,
                              'username', p.username)
      into v_profile from profiles p where p.user_id = v_uid;
  end if;
  return jsonb_build_object('is_admin', v_is, 'profile', v_profile);
end $$;

create or replace function app_admin_log(p_action text, p_target text default null, p_detail text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text;
begin
  select username into v_actor from profiles where user_id = auth.uid();
  insert into admin_audit (actor_user_id, actor_username, action, target, detail)
  values (coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(v_actor, 'system'), p_action, p_target, p_detail);
end $$;

-- ----------------------------------------------------------------------------
-- Read surface
-- ----------------------------------------------------------------------------
create or replace function app_admin_dashboard(p_member_query text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_q text := trim(coalesce(p_member_query, ''));
begin
  return jsonb_build_object(
    'actor', (select to_jsonb(p) from profiles p where p.user_id = v_uid),
    'metrics', jsonb_build_object(
      'members', (select count(*) from profiles),
      'members_today', (select count(*) from profiles where created_at >= date_trunc('day', now())),
      'wallets_total', (select coalesce(sum(wallet_balance), 0) from profiles),
      'open_cycles', (select count(*) from vault_cycles where status = 'open'),
      'open_principal', (select coalesce(sum(principal), 0) from vault_cycles where status = 'open'),
      'open_promised_yield', (select coalesce(sum(promised_yield), 0) from vault_cycles where status = 'open'),
      'obligations', app_obligations(),
      'reserve_balance', (select balance from reserve where id = 1),
      'coverage_pct', app_coverage(),
      'pending_deposits', (select count(*) from deposits where status = 'pending'),
      'pending_deposits_total', (select coalesce(sum(amount), 0) from deposits where status = 'pending'),
      'pending_withdrawals', (select count(*) from withdrawals where status = 'pending'),
      'pending_withdrawals_total', (select coalesce(sum(payout_amount), 0) from withdrawals where status = 'pending'),
      'deposits_total', (select coalesce(sum(amount), 0) from deposits where status = 'confirmed'),
      'withdrawals_total', (select coalesce(sum(payout_amount), 0) from withdrawals where status = 'paid'),
      'fees_total', (select coalesce(sum(amount), 0) from reserve_entries where kind = 'fee_income'),
      'yield_paid_total', (select coalesce(sum(promised_yield), 0) from vault_cycles where status = 'closed'),
      'reserve_topped_total', (select coalesce(sum(amount), 0) from reserve_entries where kind = 'reserve_credit'),
      'reserve_drawn_total', (select coalesce(sum(-amount), 0) from reserve_entries where kind = 'reserve_debit')
    ),
    'members', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
      from (select user_id, display_name, username, phone, referral_code, wallet_balance,
                   kyc_status, is_banned, referred_by, created_at
            from profiles
            where v_q = ''
               or lower(username) like '%' || lower(v_q) || '%'
               or phone like '%' || v_q || '%'
               or upper(referral_code) = upper(v_q)
               or lower(display_name) like '%' || lower(v_q) || '%'
               or user_id::text like lower(v_q) || '%'
            limit 25) p),
    'admins', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', a.user_id, 'handle', a.handle, 'created_at', a.created_at,
        'username', p.username, 'display_name', p.display_name) order by a.created_at), '[]'::jsonb)
      from admins a left join profiles p on p.user_id = a.user_id),
    'pending_handles', (select coalesce(jsonb_agg(jsonb_build_object(
        'handle', h.handle, 'created_at', h.created_at) order by h.created_at), '[]'::jsonb)
      from admin_handles h),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from platform_settings),
    'audit', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      from (select id, actor_username, action, target, detail, created_at
            from admin_audit order by created_at desc limit 50) x)
  );
end $$;

create or replace function app_admin_queue(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := app_admin_guard();
begin
  if p_kind = 'deposits' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'amount', d.amount, 'channel', d.channel, 'payer_account', d.payer_account,
        'reference', d.reference, 'status', d.status, 'created_at', d.created_at,
        'settled_at', d.settled_at, 'note', d.note,
        'username', p.username, 'display_name', p.display_name, 'phone', p.phone)
        order by d.created_at), '[]'::jsonb)
      from (select * from deposits where status = 'pending' order by created_at limit 100) d
      left join profiles p on p.user_id = d.user_id);
  elsif p_kind = 'withdrawals' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'amount', w.amount, 'fee_amount', w.fee_amount, 'payout_amount', w.payout_amount,
        'channel', w.channel, 'destination_account', w.destination_account,
        'status', w.status, 'created_at', w.created_at, 'processed_at', w.processed_at, 'note', w.note,
        'username', p.username, 'display_name', p.display_name, 'phone', p.phone)
        order by w.created_at), '[]'::jsonb)
      from (select * from withdrawals where status = 'pending' order by created_at limit 100) w
      left join profiles p on p.user_id = w.user_id);
  end if;
  raise exception 'INVALID_REQUEST: kind must be deposits or withdrawals.';
end $$;

create or replace function app_admin_member(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := app_admin_guard();
begin
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from profiles p where p.user_id = p_user_id),
    'referrer', (select jsonb_build_object('username', q.username, 'display_name', q.display_name)
                 from profiles me join profiles q on q.user_id = me.referred_by where me.user_id = p_user_id),
    'cycles', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
      from (select id, principal, total_rate_pct, promised_yield, payout_total, status,
                   opened_at, matures_at, closed_at, product_snapshot -> 'name' as product_name
            from vault_cycles where user_id = p_user_id order by created_at desc limit 50) c),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
      from (select id, amount, kind, balance_after, note, created_at
            from ledger where user_id = p_user_id order by created_at desc limit 100) l),
    'deposits', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
      from (select id, amount, channel, status, reference, created_at, settled_at
            from deposits where user_id = p_user_id order by created_at desc limit 25) d),
    'withdrawals', (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at desc), '[]'::jsonb)
      from (select id, amount, fee_amount, payout_amount, channel, destination_account, status, created_at, processed_at
            from withdrawals where user_id = p_user_id order by created_at desc limit 25) w)
  );
end $$;

create or replace function app_admin_list_products() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := app_admin_guard();
begin
  return (select coalesce(jsonb_agg(to_jsonb(p) order by p.duration_days, p.id), '[]'::jsonb)
    from vault_products p);
end $$;

-- ----------------------------------------------------------------------------
-- Settlement: deposits
-- ----------------------------------------------------------------------------
create or replace function app_admin_confirm_deposit(p_deposit_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_dep deposits;
  v_referrer uuid;
  v_reward numeric := app_setting_num('referral_reward', 0);
  v_new_balance numeric;
begin
  select * into v_dep from deposits where id = p_deposit_id for update;
  if not found then raise exception 'NOT_FOUND: Deposit not found.'; end if;
  if v_dep.status <> 'pending' then
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  -- The status transition (guarded by the row lock) is the replay guard.
  update deposits set status = 'confirmed', settled_at = now(), settled_by = v_uid,
         note = coalesce(p_note, note)
    where id = p_deposit_id and status = 'pending'
    returning * into v_dep;
  if not found then
    select * into v_dep from deposits where id = p_deposit_id;
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  insert into payment_events (sha256_hash, source, event_type, payload)
  values (app_hash_sha256('manual:deposit:' || p_deposit_id), 'manual', 'deposit.confirmed', to_jsonb(v_dep))
  on conflict (sha256_hash) do nothing;

  -- Wallet credit (member's money has arrived)...
  perform app_credit(v_dep.user_id, v_dep.amount, 'deposit_credit', 'deposits', v_dep.id,
                     'Deposit ' || v_dep.channel, 'dep_credit:' || v_dep.id);
  -- ...and the operator declares the same cash into the reserve, so coverage
  -- is preserved by construction.
  update reserve set balance = balance + v_dep.amount, updated_at = now()
    where id = 1 returning balance into v_new_balance;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
  values (v_dep.amount, 'reserve_credit', v_new_balance, v_dep.reference,
          'Deposit ' || v_dep.id || ' received', v_uid, 'dep_reserve:' || v_dep.id);

  -- One-time referral reward on the referee's first confirmed deposit.
  if v_reward > 0 then
    select referred_by into v_referrer from profiles where user_id = v_dep.user_id;
    if v_referrer is not null
       and not exists (select 1 from ledger where kind = 'referral_reward'
                       and user_id = v_referrer and idem_key = 'ref_reward:' || v_dep.user_id) then
      perform app_assert_solvent(v_reward);
      perform app_credit(v_referrer, v_reward, 'referral_reward', 'deposits', v_dep.id,
                         'Referral reward: first deposit', 'ref_reward:' || v_dep.user_id);
    end if;
  end if;

  perform app_admin_log('confirm_deposit', v_dep.id::text,
                        v_dep.amount || ' UGX to ' || v_dep.user_id);
  return jsonb_build_object('deposit', to_jsonb(v_dep), 'credited', v_dep.amount);
end $$;

create or replace function app_admin_reject_deposit(p_deposit_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_dep deposits;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'INVALID_REQUEST: A rejection reason is required.';
  end if;
  select * into v_dep from deposits where id = p_deposit_id for update;
  if not found then raise exception 'NOT_FOUND: Deposit not found.'; end if;
  if v_dep.status <> 'pending' then raise exception 'INVALID_REQUEST: Only pending deposits can be rejected.'; end if;

  update deposits set status = 'rejected', settled_at = now(), settled_by = v_uid,
         note = left(trim(p_reason), 300) where id = v_dep.id;
  perform app_admin_log('reject_deposit', v_dep.id::text, p_reason);
  return to_jsonb(v_dep);
end $$;

-- ----------------------------------------------------------------------------
-- Settlement: withdrawals
-- ----------------------------------------------------------------------------
create or replace function app_admin_pay_withdrawal(p_withdrawal_id bigint, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_wd withdrawals;
  v_new_balance numeric;
begin
  select * into v_wd from withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'NOT_FOUND: Withdrawal not found.'; end if;
  if v_wd.status <> 'pending' then
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;

  update withdrawals set status = 'paid', processed_at = now(), processed_by = v_uid,
         note = coalesce(nullif(trim(coalesce(p_reference, '')), ''), note)
    where id = p_withdrawal_id and status = 'pending'
    returning * into v_wd;
  if not found then
    select * into v_wd from withdrawals where id = p_withdrawal_id;
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;

  insert into payment_events (sha256_hash, source, event_type, payload)
  values (app_hash_sha256('manual:withdrawal:' || p_withdrawal_id), 'manual', 'withdrawal.paid', to_jsonb(v_wd))
  on conflict (sha256_hash) do nothing;

  -- Cash actually leaves the operator float now.
  update reserve set balance = greatest(0, balance - v_wd.payout_amount), updated_at = now()
    where id = 1 returning balance into v_new_balance;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
  values (-v_wd.payout_amount, 'reserve_debit', v_new_balance, p_reference,
          'Withdrawal ' || v_wd.id || ' paid', v_uid, 'wd_pay:' || v_wd.id);

  if v_wd.fee_amount > 0 then
    update reserve set balance = balance + v_wd.fee_amount, updated_at = now()
      where id = 1 returning balance into v_new_balance;
    insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
    values (v_wd.fee_amount, 'fee_income', v_new_balance, null,
            'Fee from withdrawal ' || v_wd.id, v_uid, 'wd_fee:' || v_wd.id);
  end if;

  perform app_admin_log('pay_withdrawal', v_wd.id::text,
                        v_wd.payout_amount || ' UGX to ' || v_wd.user_id);
  return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'paid', v_wd.payout_amount);
end $$;

create or replace function app_admin_fail_withdrawal(p_withdrawal_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_wd withdrawals;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'INVALID_REQUEST: A failure reason is required.';
  end if;
  select * into v_wd from withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'NOT_FOUND: Withdrawal not found.'; end if;
  if v_wd.status <> 'pending' then raise exception 'INVALID_REQUEST: Only pending withdrawals can be failed.'; end if;

  -- Return the member's reserved balance.
  perform app_credit(v_wd.user_id, v_wd.amount, 'withdrawal_reversal', 'withdrawals', v_wd.id,
                     'Withdrawal failed: ' || left(trim(p_reason), 120), 'wd_fail:' || v_wd.id);

  update withdrawals set status = 'failed', processed_at = now(), processed_by = v_uid,
         note = left(trim(p_reason), 300) where id = v_wd.id;
  perform app_admin_log('fail_withdrawal', v_wd.id::text, p_reason);
  return to_jsonb(v_wd);
end $$;

-- ----------------------------------------------------------------------------
-- Reserve operations
-- ----------------------------------------------------------------------------
create or replace function app_admin_topup_reserve(p_amount numeric, p_reference text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_new numeric;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT: Top-up must be positive.'; end if;
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'INVALID_REQUEST: A bank/momo reference is required for reserve top-ups.';
  end if;
  update reserve set balance = balance + p_amount, updated_at = now()
    where id = 1 returning balance into v_new;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id)
  values (p_amount, 'reserve_credit', v_new, trim(p_reference), p_note, v_uid);
  perform app_admin_log('reserve_topup', null, p_amount || ' UGX ref ' || p_reference);
  return jsonb_build_object('balance', v_new, 'coverage_pct', app_coverage());
end $$;

create or replace function app_admin_draw_reserve(p_amount numeric, p_reference text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_new numeric;
begin
  if p_amount <= 0 then raise exception 'INVALID_AMOUNT: Draw must be positive.'; end if;
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'INVALID_REQUEST: A reference is required for reserve draws.';
  end if;
  -- The operator may only take what is NOT promised to members.
  if p_amount > (select balance from reserve where id = 1) - app_obligations() then
    raise exception 'INVALID_REQUEST: Draw would push coverage below 100%. Reserve free: %.',
      greatest(0, (select balance from reserve where id = 1) - app_obligations());
  end if;
  update reserve set balance = balance - p_amount, updated_at = now()
    where id = 1 returning balance into v_new;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id)
  values (-p_amount, 'reserve_debit', v_new, trim(p_reference), null, v_uid);
  perform app_admin_log('reserve_draw', null, p_amount || ' UGX ref ' || p_reference);
  return jsonb_build_object('balance', v_new, 'coverage_pct', app_coverage());
end $$;

-- ----------------------------------------------------------------------------
-- Catalogue management
-- ----------------------------------------------------------------------------
create or replace function app_admin_upsert_product(p_json jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_id integer := nullif(p_json ->> 'id', '')::integer;
  v_row vault_products;
begin
  if coalesce(p_json ->> 'slug', '') !~ '^[a-z][a-z0-9_-]{1,30}$' then
    raise exception 'INVALID_REQUEST: slug must be lowercase, 2-31 chars [a-z0-9_-].';
  end if;
  if coalesce(p_json ->> 'total_rate_pct', '')::numeric < 0
     or coalesce(p_json ->> 'total_rate_pct', '')::numeric > 100 then
    raise exception 'INVALID_REQUEST: total_rate_pct must be 0-100 (TOTAL over the term).';
  end if;

  if v_id is null then
    insert into vault_products (slug, name, min_principal, max_principal, duration_days,
                                total_rate_pct, early_exit_percent, terms, visible, active)
    values (p_json ->> 'slug', p_json ->> 'name',
            (p_json ->> 'min_principal')::numeric, (p_json ->> 'max_principal')::numeric,
            (p_json ->> 'duration_days')::integer, (p_json ->> 'total_rate_pct')::numeric,
            coalesce((p_json ->> 'early_exit_percent')::numeric, 90),
            p_json ->> 'terms',
            coalesce((p_json ->> 'visible')::boolean, true),
            coalesce((p_json ->> 'active')::boolean, true))
    returning * into v_row;
  else
    update vault_products set
      slug = p_json ->> 'slug', name = p_json ->> 'name',
      min_principal = (p_json ->> 'min_principal')::numeric,
      max_principal = (p_json ->> 'max_principal')::numeric,
      duration_days = (p_json ->> 'duration_days')::integer,
      total_rate_pct = (p_json ->> 'total_rate_pct')::numeric,
      early_exit_percent = coalesce((p_json ->> 'early_exit_percent')::numeric, early_exit_percent),
      terms = p_json ->> 'terms',
      visible = coalesce((p_json ->> 'visible')::boolean, visible),
      active = coalesce((p_json ->> 'active')::boolean, active)
    where id = v_id returning * into v_row;
  end if;

  perform app_admin_log('upsert_product', v_row.id::text, v_row.slug);
  return to_jsonb(v_row);
end $$;

-- ----------------------------------------------------------------------------
-- Settings management (whitelist + typed validation; mirror of config.ts)
-- ----------------------------------------------------------------------------
create or replace function app_admin_setting_spec() returns table (
  key text, kind text, label text, hint text
)
language sql stable as $$
  select * from (values
    ('min_deposit',            'number', 'Minimum deposit (UGX)',        'Smallest accepted top-up.'),
    ('min_withdrawal',         'number', 'Minimum withdrawal (UGX)',     'Smallest allowed payout.'),
    ('withdrawal_fee_percent', 'number', 'Withdrawal fee (%)',           'Flat percent of the withdrawal amount; shown up-front.'),
    ('referral_reward',        'number', 'Referral reward (UGX)',        'One-time, operator-funded, paid on the referee''s first deposit. 0 disables.'),
    ('settlement_hour',        'time',   'Settlement hour (HH:MM)',      'Vaults mature at this hour on their maturity date.'),
    ('lock_at',                'time',   'Daily lock start (HH:MM)',     'Money movement locked for 2 hours from this time.'),
    ('platform_paused',        'bool',   'Pause money movement',         'Blocks deposits/withdrawals/vault operations (reads keep working).'),
    ('pause_message',          'text',   'Pause message',                'Shown to members while paused.'),
    ('support_contact',        'text',   'Support contact',              'Shown in member UI.')
  ) as t(key, kind, label, hint);
$$;

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

  insert into platform_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform app_admin_log('set_setting', p_key, p_value);
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

-- ----------------------------------------------------------------------------
-- Member management
-- ----------------------------------------------------------------------------
create or replace function app_admin_adjust_wallet(p_user_id uuid, p_delta numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_new numeric;
begin
  if p_delta = 0 then raise exception 'INVALID_AMOUNT: Delta must be non-zero.'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'INVALID_REQUEST: A written reason is required (audit trail).';
  end if;
  if p_delta > 0 then
    -- Even gifts must be reserved before they are given.
    perform app_assert_solvent(p_delta);
    v_new := app_credit(p_user_id, p_delta, 'adjustment_credit', null, null, left(trim(p_reason), 200));
  else
    v_new := app_debit(p_user_id, -p_delta, 'adjustment_debit', null, null, left(trim(p_reason), 200));
  end if;
  perform app_admin_log('adjust_wallet', p_user_id::text, p_delta || ' UGX — ' || p_reason);
  return jsonb_build_object('user_id', p_user_id, 'wallet_balance', v_new);
end $$;

create or replace function app_admin_set_ban(p_user_id uuid, p_banned boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  if p_user_id = v_uid then raise exception 'INVALID_REQUEST: You cannot change your own access.'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then
    raise exception 'INVALID_REQUEST: A written reason is required (audit trail).';
  end if;
  update profiles set is_banned = p_banned where user_id = p_user_id;
  perform app_admin_log(case when p_banned then 'ban_member' else 'unban_member' end,
                        p_user_id::text, p_reason);
  return jsonb_build_object('user_id', p_user_id, 'is_banned', p_banned);
end $$;

-- ----------------------------------------------------------------------------
-- Admin roster (pending handles bind at sign-up)
-- ----------------------------------------------------------------------------
create or replace function app_admin_grant(p_username text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_username text := lower(trim(p_username));
  v_user_id uuid;
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'INVALID_REQUEST: Provide the operator username (3-20 chars, lowercase).';
  end if;

  select user_id into v_user_id from profiles where username = v_username;
  if v_user_id is not null then
    insert into admins (user_id, handle, granted_by) values (v_user_id, v_username, v_uid)
      on conflict (user_id) do nothing;
    perform app_admin_log('grant_admin', v_username, 'immediate');
    return jsonb_build_object('status', 'granted', 'handle', v_username);
  end if;

  insert into admin_handles (handle, granted_by) values (v_username, v_uid) on conflict (handle) do nothing;
  perform app_admin_log('grant_admin', v_username, 'queued (account not created yet)');
  return jsonb_build_object('status', 'queued', 'handle', v_username);
end $$;

create or replace function app_admin_revoke(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_count integer;
begin
  if p_user_id = v_uid then raise exception 'INVALID_REQUEST: You cannot revoke yourself.'; end if;
  select count(*) into v_count from admins;
  if v_count <= 1 then raise exception 'INVALID_REQUEST: Cannot revoke the last admin.'; end if;
  delete from admins where user_id = p_user_id;
  perform app_admin_log('revoke_admin', p_user_id::text, null);
  return jsonb_build_object('user_id', p_user_id, 'revoked', true);
end $$;

create or replace function app_bind_admin_handle() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
begin
  if v_username <> '' and exists (select 1 from admin_handles where handle = v_username) then
    insert into admins (user_id, handle, granted_by)
    select new.id, v_username, h.granted_by from admin_handles h where h.handle = v_username
    on conflict (user_id) do nothing;
    delete from admin_handles where handle = v_username;
  end if;
  return new;
end $$;
revoke all on function app_bind_admin_handle() from public, anon, authenticated;

drop trigger if exists app_bind_admin_handle on auth.users;
create trigger app_bind_admin_handle after insert on auth.users
  for each row execute function app_bind_admin_handle();

create or replace function app_admin_audit(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := app_admin_guard();
begin
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    from (select id, actor_username, action, target, detail, created_at
          from admin_audit order by created_at desc limit least(coalesce(p_limit, 100), 500)) x);
end $$;

-- ----------------------------------------------------------------------------
-- Grants (desk routes run under the operator's own session)
-- ----------------------------------------------------------------------------
grant execute on function app_admin_self() to authenticated;
grant execute on function app_admin_dashboard(text) to authenticated;
grant execute on function app_admin_queue(text) to authenticated;
grant execute on function app_admin_member(uuid) to authenticated;
grant execute on function app_admin_list_products() to authenticated;
grant execute on function app_admin_upsert_product(jsonb) to authenticated;
grant execute on function app_admin_setting_spec() to authenticated;
grant execute on function app_admin_set_setting(text, text) to authenticated;
grant execute on function app_admin_topup_reserve(numeric, text, text) to authenticated;
grant execute on function app_admin_draw_reserve(numeric, text) to authenticated;
grant execute on function app_admin_confirm_deposit(bigint, text) to authenticated;
grant execute on function app_admin_reject_deposit(bigint, text) to authenticated;
grant execute on function app_admin_pay_withdrawal(bigint, text) to authenticated;
grant execute on function app_admin_fail_withdrawal(bigint, text) to authenticated;
grant execute on function app_admin_adjust_wallet(uuid, numeric, text) to authenticated;
grant execute on function app_admin_set_ban(uuid, boolean, text) to authenticated;
grant execute on function app_admin_grant(text) to authenticated;
grant execute on function app_admin_revoke(uuid) to authenticated;
grant execute on function app_admin_audit(integer) to authenticated;

revoke all on function app_admin_guard() from public, anon, authenticated;
revoke all on function app_admin_log(text, text, text) from public, anon, authenticated;
revoke all on function app_admin_setting_spec() from public, anon;

-- ----------------------------------------------------------------------------
-- Bootstrap: edit the username list, then run. Idempotent; skipped if any
-- admin already exists. Unregistered usernames queue and bind at sign-up.
-- ----------------------------------------------------------------------------
do $$
declare
  v_handles text[] := array[
    -- 'founder_username'
  ];
  v_handle text;
  v_user_id uuid;
begin
  if exists (select 1 from admins) then
    raise notice 'admins already exist — bootstrap skipped';
    return;
  end if;
  foreach v_handle in array v_handles loop
    select user_id into v_user_id from profiles where username = lower(v_handle);
    if v_user_id is not null then
      insert into admins (user_id, handle) values (v_user_id, lower(v_handle))
        on conflict (user_id) do nothing;
      raise notice 'bootstrapped admin %', v_handle;
    else
      insert into admin_handles (handle) values (lower(v_handle)) on conflict (handle) do nothing;
      raise notice 'queued admin username % (binds at sign-up)', v_handle;
    end if;
  end loop;
end $$;
