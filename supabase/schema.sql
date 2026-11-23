-- ============================================================================
-- SuperSwap — Ledger Core schema (real application)
-- UGX savings with FULLY-RESERVED term vaults:
--   every promised payout must be covered by the operator reserve BEFORE the
--   vault opens; the coverage invariant is enforced inside the RPCs, and the
--   coverage % is published to members.
--
-- Run order: schema.sql  ->  rpc.sql  ->  admin.sql
-- Pre-launch migration: this file drops the legacy simulator objects first.
-- ============================================================================

create extension if not exists pgcrypto;

-- Idempotency helper (payment events, client-generated keys).
create or replace function app_hash_sha256(p_text text) returns text
language sql immutable
as $$ select encode(digest(coalesce(p_text, ''), 'sha256'), 'hex') $$;

-- ----------------------------------------------------------------------------
-- 0. Drop legacy simulator objects (no live data before launch)
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'sim\_%' or p.proname in ('handle_new_user', 'handle_username_to_email'))
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
drop view if exists team_rows;
drop table if exists
  referral_rewards, investment_cycles, investments, investment_plans,
  withdrawals, deposits, transactions, pool, profiles,
  admins, admin_handles, admin_audit
cascade;

-- ----------------------------------------------------------------------------
-- 1. Money rules — the single authority (mirror in RPC fallbacks + config.ts)
-- This seed only paints a FRESH database (do nothing on conflict); deployed
-- projects change values through supabase/migrations/* and the admin desk.
-- ----------------------------------------------------------------------------
create table if not exists platform_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into platform_settings (key, value) values
  -- Synthetic login host: usernames become username@<this>. It must be a real
  -- public hostname (GoTrue rejects reserved TLDs like *.local) and can NEVER
  -- change once a single member exists, because their login address is derived
  -- from it. No mail is ever sent here.
  ('auth_email_domain', 'accounts.superswap-nine.vercel.app'),
  ('min_deposit', '10000'),
  ('min_withdrawal', '5000'),
  ('withdrawal_fee_percent', '17'),
  ('referral_commission_percent', '18'),  -- L1 only: to the referrer on each referee deposit
  ('signup_bonus', '1500'),               -- UGX, once per member, credited at first sign-in
  ('checkin_bonus', '100'),               -- UGX, daily check-in reward on the Home tab; 0 disables
  ('timezone', 'Africa/Kampala'),         -- IANA zone the member-facing clock rules use
  ('withdraw_window_from', '09:00'),      -- withdrawals open (wall clock in `timezone`)
  ('withdraw_window_to', '21:00'),        -- withdrawals close (wall clock in `timezone`)
  ('settlement_hour', '22:00'),           -- matured vaults close at this hour
  ('lock_at', '19:45'),                   -- daily money-movement lock window (DB clock, UTC on Supabase)
  ('platform_paused', 'false'),
  ('pause_message', ''),
  ('support_contact', '')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Vault catalogue (products). Rates are TOTAL over the term, not daily.
-- ----------------------------------------------------------------------------
create table if not exists vault_products (
  id integer generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name text not null check (char_length(name) between 2 and 60),
  min_principal numeric(16,2) not null check (min_principal > 0),
  max_principal numeric(16,2) not null check (max_principal >= min_principal),
  duration_days integer not null check (duration_days between 7 and 730),
  total_rate_pct numeric(8,3) not null check (total_rate_pct between 0 and 100),
  early_exit_percent numeric(5,2) not null default 90
    check (early_exit_percent between 0 and 100),   -- % of principal returned early; yield is forfeited
  terms text,
  visible boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into vault_products (slug, name, min_principal, max_principal, duration_days, total_rate_pct, early_exit_percent, terms) values
  ('starter-30',  'Starter 30',  10000,  1000000,  30,  2.50, 90,
   'Yield fixed at opening and fully covered by the published reserve. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('growth-90',   'Growth 90',   50000,  5000000,  90,  7.00, 90,
   'Yield fixed at opening and fully covered by the published reserve. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('anchor-180',  'Anchor 180', 100000, 10000000, 180, 13.00, 90,
   'Yield fixed at opening and fully covered by the published reserve. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('anchor-365',  'Anchor 365', 100000, 20000000, 365, 24.00, 90,
   'Yield fixed at opening and fully covered by the published reserve. Early exit returns 90% of principal; unearned yield is forfeited.')
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Members
-- ----------------------------------------------------------------------------
create or replace function app_gen_code() returns text
language plpgsql volatile as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from profiles where referral_code = v_code);
  end loop;
  return v_code;
end $$;

create table if not exists profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  phone text not null check (phone ~ '^(\+256|0)7[0-9]{8}$'),
  referral_code text not null unique default app_gen_code(),
  referred_by uuid references profiles (user_id) on delete set null,
  wallet_balance numeric(16,2) not null default 0 check (wallet_balance >= 0),
  kyc_status text not null default 'unverified'
    check (kyc_status in ('unverified', 'pending', 'verified')),
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_referral_code_idx on profiles (lower(referral_code));
create index if not exists profiles_referred_by_idx on profiles (referred_by);

-- ----------------------------------------------------------------------------
-- 4. Reserve — the declared operator float that secures every promise
-- ----------------------------------------------------------------------------
create table if not exists reserve (
  id integer primary key check (id = 1),
  balance numeric(16,2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
insert into reserve (id, balance) values (1, 0) on conflict (id) do nothing;

-- 'promo_overlay' is the non-cash mirror the marketing promises (sign-up
-- bonus, L1 commission) are funded from: it raises the reserve by exactly
-- what it raises member obligations, so published coverage is unaffected and
-- the overlay can never be drawn as free cash (free = reserve - obligations).
create table if not exists reserve_entries (
  id bigint generated always as identity primary key,
  amount numeric(16,2) not null,                      -- signed
  kind text not null check (kind in (
    'reserve_credit', 'reserve_debit', 'fee_income', 'promo_overlay')),
  balance_after numeric(16,2) not null,
  reference text,
  note text,
  actor_user_id uuid references auth.users (id) on delete set null,
  idem_key text,
  created_at timestamptz not null default now()
);
create unique index reserve_entries_idem_uidx on reserve_entries (idem_key) where idem_key is not null;
create index if not exists reserve_entries_created_idx on reserve_entries (created_at desc);

-- Re-run convergence: an older deployment carries the pre-promo kind list, and
-- `create table if not exists` would leave that constraint in place forever.
alter table reserve_entries drop constraint if exists reserve_entries_kind_check;
alter table reserve_entries add constraint reserve_entries_kind_check
  check (kind in ('reserve_credit', 'reserve_debit', 'fee_income', 'promo_overlay'));

-- ----------------------------------------------------------------------------
-- 5. Append-only member ledger (UPDATE/DELETE are never granted)
-- ----------------------------------------------------------------------------
create table if not exists ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (user_id) on delete cascade,
  amount numeric(16,2) not null,                      -- signed; wallet delta
  kind text not null check (kind in (
    'deposit_credit', 'withdrawal_debit', 'withdrawal_reversal',
    'vault_debit', 'vault_payout', 'vault_exit_credit',
    'referral_reward', 'bonus_credit', 'checkin_bonus',
    'adjustment_credit', 'adjustment_debit')),
  balance_after numeric(16,2) not null,
  ref_table text,
  ref_id bigint,
  note text,
  idem_key text,
  created_at timestamptz not null default now()
);
create unique index ledger_idem_uidx on ledger (idem_key) where idem_key is not null;
create index if not exists ledger_user_created_idx on ledger (user_id, created_at desc);

-- Re-run convergence: an older deployment carries the pre-check-in kind list,
-- and `create table if not exists` would leave that constraint in place forever.
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check check (kind in (
    'deposit_credit', 'withdrawal_debit', 'withdrawal_reversal',
    'vault_debit', 'vault_payout', 'vault_exit_credit',
    'referral_reward', 'bonus_credit', 'checkin_bonus',
    'adjustment_credit', 'adjustment_debit'));

-- Daily check-in log — one row per member per platform-timezone day. The
-- primary key IS the idempotency guard; reward credits flow through
-- app_promo_credit like every other overlay-funded promotion (section 7 RPC).
create table if not exists checkin_log (
  user_id uuid not null references profiles (user_id) on delete cascade,
  day date not null,
  amount numeric(16,2) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ----------------------------------------------------------------------------
-- 6. Vault cycles — terms locked at opening via snapshot
-- ----------------------------------------------------------------------------
create table if not exists vault_cycles (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (user_id) on delete cascade,
  product_id integer references vault_products (id) on delete set null,
  product_snapshot jsonb not null,
  principal numeric(16,2) not null check (principal > 0),
  total_rate_pct numeric(8,3) not null,
  promised_yield numeric(16,2) not null check (promised_yield >= 0),
  payout_total numeric(16,2) not null check (payout_total = principal + promised_yield),
  status text not null default 'open'
    check (status in ('open', 'closed', 'exited', 'void')),
  opened_at timestamptz not null default now(),
  matures_at timestamptz not null,
  closed_at timestamptz,
  idem_key text,
  note text,
  -- Row-creation stamp, kept for parity with every other ledger-ish table
  -- (deposits/withdrawals/ledger/profiles all carry created_at). app_dashboard
  -- and the admin member-detail RPC both order cycles by this column.
  created_at timestamptz not null default now()
);
create index if not exists vault_cycles_user_idx on vault_cycles (user_id, status);
create index if not exists vault_cycles_open_idx on vault_cycles (matures_at) where status = 'open';
create unique index vault_cycles_idem_uidx on vault_cycles (idem_key) where idem_key is not null;

-- ----------------------------------------------------------------------------
-- 7. Deposit & withdrawal queues (deposits automatic, withdrawals approved)
-- Deposits settle themselves: /api/deposits pushes a Shashura requestToPay
-- to the payer's phone and the signed webhook credits via the shared
-- deposit core. The admin Confirm/Reject survives as the fallback for bank
-- transfers, failed gateway attempts and amount mismatches. Withdrawals are
-- ALWAYS admin-approved — settled manually or via the Shashura API, which
-- then completes automatically.
-- ----------------------------------------------------------------------------
create table if not exists deposits (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (user_id) on delete cascade,
  amount numeric(16,2) not null check (amount > 0),
  channel text not null default 'momo' check (channel in ('momo', 'bank')),
  payer_account text not null,            -- sender's momo number / bank ref identity
  reference text,                         -- member's transaction reference
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  -- Shashura collection trail (ref sent in requestToPay + returned tid) so the
  -- webhook can match a final state back to this row.
  gateway_ref text,
  gateway_tid text,
  gateway_state text not null default 'none'
    check (gateway_state in ('none', 'requested', 'verified', 'failed')),
  gateway_detail text,                    -- failure code/message when state='failed'
  idem_key text not null unique,
  note text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  settled_by uuid references auth.users (id)
);
create index if not exists deposits_status_idx on deposits (status, created_at desc);
create unique index deposits_gateway_ref_uidx on deposits (gateway_ref) where gateway_ref is not null;

create table if not exists withdrawals (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles (user_id) on delete cascade,
  amount numeric(16,2) not null check (amount > 0),
  fee_amount numeric(16,2) not null default 0,
  payout_amount numeric(16,2) not null,   -- amount - fee
  channel text not null default 'momo' check (channel in ('momo', 'bank')),
  destination_account text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  -- Shashura payout trail: 'initiated' waits for the final callback (MTN),
  -- the settlement cores flip it to 'paid'/'failed' alongside the status.
  gateway_ref text,
  gateway_tid text,
  gateway_state text not null default 'none'
    check (gateway_state in ('none', 'initiated', 'paid', 'failed')),
  gateway_detail text,
  idem_key text not null unique,
  note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users (id)
);
create index if not exists withdrawals_status_idx on withdrawals (status, created_at desc);
create unique index withdrawals_gateway_ref_uidx on withdrawals (gateway_ref) where gateway_ref is not null;

-- Gateway event idempotency (reserved for the PSP cutover; used by manual settlement too)
create table if not exists payment_events (
  id bigint generated always as identity primary key,
  sha256_hash text not null unique,
  source text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. Security: RLS on every table; writes ONLY through security-definer RPCs.
-- ----------------------------------------------------------------------------
alter table platform_settings enable row level security;
alter table vault_products enable row level security;
alter table profiles enable row level security;
alter table reserve enable row level security;
alter table reserve_entries enable row level security;
alter table ledger enable row level security;
alter table checkin_log enable row level security;
alter table vault_cycles enable row level security;
alter table deposits enable row level security;
alter table withdrawals enable row level security;
alter table payment_events enable row level security;

-- The published catalogue is world-readable (marketing page shows real rates).
drop policy if exists vault_products_public_read on vault_products;
create policy vault_products_public_read on vault_products
  for select using (visible and active);

-- Members read only their own rows.
drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles
  for select using (auth.uid() = user_id);
drop policy if exists vault_cycles_self_read on vault_cycles;
create policy vault_cycles_self_read on vault_cycles
  for select using (auth.uid() = user_id);
drop policy if exists ledger_self_read on ledger;
create policy ledger_self_read on ledger
  for select using (auth.uid() = user_id);
drop policy if exists deposits_self_read on deposits;
create policy deposits_self_read on deposits
  for select using (auth.uid() = user_id);
drop policy if exists withdrawals_self_read on withdrawals;
create policy withdrawals_self_read on withdrawals
  for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 9. updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function app_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vault_products_touch on vault_products;
create trigger vault_products_touch before update on vault_products
  for each row execute function app_touch_updated_at();
drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function app_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 10. Profile bootstrap from sign-up metadata (name, username, phone, referral)
-- ----------------------------------------------------------------------------
create or replace function app_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_name text := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  v_phone text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9+]', '', 'g');
  v_ref text := upper(trim(coalesce(new.raw_user_meta_data ->> 'referral_code', '')));
  v_referrer uuid;
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME: Username must be 3-20 characters: lowercase letters, numbers or underscore.';
  end if;
  if exists (select 1 from profiles where username = v_username) then
    raise exception 'USERNAME_TAKEN: That username is already taken.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'INVALID_NAME: Please provide your real name (2-60 characters).';
  end if;
  if v_phone not like '+256%' then
    if v_phone like '256%' then v_phone := '+256' || substring(v_phone from 4);
    elsif v_phone like '0%' then v_phone := '+256' || substring(v_phone from 2);
    end if;
  end if;
  if v_phone !~ '^\+2567[0-9]{8}$' then
    raise exception 'INVALID_PHONE: Provide a Ugandan mobile number, e.g. 0772123456.';
  end if;

  if v_ref <> '' then
    select user_id into v_referrer from profiles where referral_code = v_ref;
    if v_referrer is null then
      raise exception 'BAD_REFERRAL: That referral code does not exist.';
    end if;
  end if;

  insert into profiles (user_id, display_name, username, phone, referred_by)
  values (new.id, v_name, v_username, v_phone, v_referrer);
  return new;
end $$;
revoke all on function app_handle_new_user() from public, anon, authenticated;

drop trigger if exists app_users_bootstrap on auth.users;
create trigger app_users_bootstrap after insert on auth.users
  for each row execute function app_handle_new_user();

-- ----------------------------------------------------------------------------
-- Grants on base tables: none beyond authenticated reads. All writes live in
-- the RPC layer (rpc.sql / admin.sql).
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
grant select on vault_products to anon, authenticated;
grant select on profiles, ledger, vault_cycles, deposits, withdrawals to authenticated;
