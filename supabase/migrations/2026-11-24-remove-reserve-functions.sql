-- ============================================================================
-- SuperSwap — remove the reserve feature (phase 1: FUNCTIONS FIRST)
-- run AFTER 2026-11-23-shashura-gateway.sql, and BEFORE
-- 2026-11-24-drop-reserve-tables.sql
--
-- The real reserve is the external Shashura account, which is protected from
-- the application. We therefore delete the in-app reserve concept entirely:
-- no reads, no writes, no coverage ratio, no solvency gate — and we NEVER
-- substitute a computed estimate for that external balance.
--
-- This migration ONLY touches functions + grants. It deliberately runs while
-- the `reserve` / `reserve_entries` tables STILL EXIST, because dropping the
-- tables before rewriting the RPCs that reference them (dashboard, deposit +
-- withdrawal settlement, promo credit, reserve top-up/draw) would break those
-- functions at call time. Function bodies below are byte-identical to the
-- updated supabase/rpc.sql and supabase/admin.sql.
--
-- 2026-11-24 SYNC: bodies re-synced after the referral-league + EAT-settlement
-- final touches (see 2026-11-24-referral-league-and-eat-settlement.sql, which
-- supersedes these definitions and MUST run after this file).
-- ============================================================================

-- 1. Promo credit: no longer mirrored into the reserve as a 'promo_overlay'.
--    It is a plain, idempotent wallet credit through the shared ledger.
create or replace function app_promo_credit(
  p_user uuid, p_amount numeric, p_kind text,
  p_ref_table text default null, p_ref_id bigint default null,
  p_note text default null, p_idem_key text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  if p_idem_key is not null
     and exists (select 1 from ledger where idem_key = p_idem_key and kind = p_kind) then
    return null;                                     -- already granted
  end if;
  return app_credit(p_user, p_amount, p_kind, p_ref_table, p_ref_id, p_note, p_idem_key);
end $$;

-- 2. Deposit settlement core: signature changes (p_reserve_amount is gone),
--    so drop the old overload before recreating the 4-arg core. Wallet credit
--    + L1/L2 commission remain; every reserve write is removed.
revoke all on function app_deposit_credited_core(bigint, text, text, uuid, numeric) from public, anon, authenticated;
drop function if exists app_deposit_credited_core(bigint, text, text, uuid, numeric);

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

-- 3. Manual-confirm wrapper: call the core without the dropped reserve arg.
create or replace function app_admin_confirm_deposit(p_deposit_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  return app_deposit_credited_core(p_deposit_id, p_note, 'manual', v_uid);
end $$;
grant execute on function app_admin_confirm_deposit(bigint, text) to authenticated;

-- 4. Withdrawal settlement core: no reserve debit / fee-income entry. The
--    payout and fee settle against the external Shashura float off-platform.
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

-- 5. Webhook funnel: stop passing the net-amount reserve arg into the core.
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

-- 6. Member dashboard: the whole 'transparency' block (reserve_balance /
--    obligations / coverage_pct) is gone. Members never saw the external
--    balance and there is no in-app coverage number to publish.
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

-- 7. Admin dashboard: drop the reserve_balance / coverage_pct / overlay /
--    topped / drawn metrics. 'fees_total' now reads paid-withdrawal fees
--    (platform revenue) instead of the reserve_entries fee_income ledger.
--    'obligations' stays as a member-liability figure — it is NOT an estimate
--    of the external reserve, just what the platform owes its members.
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
      'pending_deposits', (select count(*) from deposits where status = 'pending'),
      'pending_deposits_total', (select coalesce(sum(amount), 0) from deposits where status = 'pending'),
      'pending_withdrawals', (select count(*) from withdrawals where status = 'pending'),
      'pending_withdrawals_total', (select coalesce(sum(payout_amount), 0) from withdrawals where status = 'pending'),
      'deposits_total', (select coalesce(sum(amount), 0) from deposits where status = 'confirmed'),
      'withdrawals_total', (select coalesce(sum(payout_amount), 0) from withdrawals where status = 'paid'),
      'fees_total', (select coalesce(sum(fee_amount), 0) from withdrawals where status = 'paid'),
      'bonus_total', (select coalesce(sum(amount), 0) from ledger where kind = 'bonus_credit'),
      'referral_commission_total', (select coalesce(sum(amount), 0) from ledger where kind = 'referral_reward'),
      'yield_paid_total', (select coalesce(sum(promised_yield), 0) from vault_cycles where status = 'closed')
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

-- 8. Public marketing info: drop the published coverage_pct.
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

-- 9. Vault opening: no in-app reserve to gate against, so the solvency check
--    is removed. Rate/min/max/limit validation still applies.
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

-- 10. Wallet adjustment: no "gifts must be reserved" gate. Reason + audit stay.
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
    v_new := app_credit(p_user_id, p_delta, 'adjustment_credit', null, null, left(trim(p_reason), 200));
  else
    v_new := app_debit(p_user_id, -p_delta, 'adjustment_debit', null, null, left(trim(p_reason), 200));
  end if;
  perform app_admin_log('adjust_wallet', p_user_id::text, p_delta || ' UGX — ' || p_reason);
  return jsonb_build_object('user_id', p_user_id, 'wallet_balance', v_new);
end $$;

-- 11. Drop the reserve-only surface. Nothing above references these anymore, so
--     they can go without CASCADE. Their grants die with the functions.
revoke all on function app_coverage() from public, anon, authenticated;
drop function if exists app_coverage();
drop function if exists app_assert_solvent(numeric);
revoke all on function app_admin_topup_reserve(numeric, text, text) from public, anon, authenticated;
revoke all on function app_admin_draw_reserve(numeric, text) from public, anon, authenticated;
drop function if exists app_admin_topup_reserve(numeric, text, text);
drop function if exists app_admin_draw_reserve(numeric, text);

-- 12. Sanity: reserve references must be fully gone from the function layer
--     BEFORE the table-drop migration runs. Postgres stores function bodies as
--     text and does NOT record a dependency on tables referenced inside them,
--     so we scan the source itself for any remaining reserve-table DML.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('app_coverage', 'app_assert_solvent',
      'app_admin_topup_reserve', 'app_admin_draw_reserve');
  if n <> 0 then raise exception 'remove-reserve: reserve functions still present (%)', n; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and (
      p.prosrc like '%reserve_entries%'
      or p.prosrc like '%update reserve %'
      or p.prosrc like '%from reserve %'
      or p.prosrc like '%reserve set %'
    );
  if n <> 0 then raise exception 'remove-reserve: % function(s) still reference the reserve tables', n; end if;
end $$;
