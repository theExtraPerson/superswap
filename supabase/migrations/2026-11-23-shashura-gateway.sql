-- ============================================================================
-- SuperSwap — Shashura payment gateway (run after 2026-11-23-daily-checkin.sql)
--
-- Mobile Money collections + payouts via https://shashura.com/api/v1.
-- Rules this migration encodes:
--   * DEPOSITS ARE AUTOMATIC. /api/deposits fires requestToPay to the payer
--     and the signed webhook credits wallet + reserve through
--     app_deposit_credited_core — the SAME core the admin Confirm uses
--     (Confirm survives only as the bank/mismatch/failed-attempt fallback).
--   * WITHDRAWALS are admin-approved, settled two ways:
--       manual  -> "Mark paid" (money sent off-platform by the operator)
--       API     -> Shashura disburse; instant (Airtel) settles on the spot,
--                  pending (MTN) settles automatically via the webhook.
--     Both through ONE settlement core, so the ledger can't drift.
--   * The webhook funnel (app_hook_shashura) is service-role only, dedupes
--     events through payment_events and replays safely. Gateway fees are
--     honest: the reserve is funded with net cash that actually landed.
-- Function bodies below are byte-identical to supabase/admin.sql.
-- ============================================================================

-- 1. Gateway columns on the queues (idempotent for live tables)
alter table deposits add column if not exists gateway_ref text;
alter table deposits add column if not exists gateway_tid text;
alter table deposits add column if not exists gateway_state text not null default 'none'
  check (gateway_state in ('none', 'requested', 'verified', 'failed'));
alter table deposits add column if not exists gateway_detail text;
alter table withdrawals add column if not exists gateway_ref text;
alter table withdrawals add column if not exists gateway_tid text;
alter table withdrawals add column if not exists gateway_state text not null default 'none'
  check (gateway_state in ('none', 'initiated', 'paid', 'failed'));
alter table withdrawals add column if not exists gateway_detail text;
create unique index if not exists deposits_gateway_ref_uidx on deposits (gateway_ref) where gateway_ref is not null;
create unique index if not exists withdrawals_gateway_ref_uidx on withdrawals (gateway_ref) where gateway_ref is not null;

-- 2. Settlement cores + wrappers + gateway ops + webhook funnel
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

create or replace function app_deposit_credited_core(p_deposit_id bigint, p_note text, p_source text, p_actor uuid, p_reserve_amount numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dep deposits;
  v_referrer uuid;
  v_comm_pct numeric := app_setting_num('referral_commission_percent', 18);
  v_commission numeric(16,2) := 0;
  v_cash numeric;
  v_new_balance numeric;
begin
  select * into v_dep from deposits where id = p_deposit_id for update;
  if not found then raise exception 'NOT_FOUND: Deposit not found.'; end if;
  if v_dep.status <> 'pending' then
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  -- The status transition (guarded by the row lock) is the replay guard.
  v_cash := coalesce(p_reserve_amount, v_dep.amount);
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

  -- Wallet credit (member's money has arrived)...
  perform app_credit(v_dep.user_id, v_dep.amount, 'deposit_credit', 'deposits', v_dep.id,
                     'Deposit ' || v_dep.channel, 'dep_credit:' || v_dep.id);
  -- ...and ONLY the cash that really landed is declared into the reserve —
  -- the gateway's processing fee never counts as covered cash, so coverage
  -- stays honest on the automatic path.
  update reserve set balance = balance + v_cash, updated_at = now()
    where id = 1 returning balance into v_new_balance;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
  values (v_cash, 'reserve_credit', v_new_balance, coalesce(v_dep.reference, v_dep.gateway_ref),
          'Deposit ' || v_dep.id || ' received via ' || p_source, p_actor, 'dep_reserve:' || v_dep.id);

  -- L1 referral commission: a percent of THIS deposit, to the direct referrer,
  -- every time (not only the first). Promo money: exempt from the solvency
  -- gate and overlay-funded inside app_promo_credit (see rpc.sql). The idem
  -- key makes replay impossible, even if this deposit is settled twice.
  if coalesce(v_comm_pct, 0) > 0 then
    select referred_by into v_referrer from profiles where user_id = v_dep.user_id;
    if v_referrer is not null then
      v_commission := round(v_dep.amount * v_comm_pct / 100, 2);
      perform app_promo_credit(v_referrer, v_commission, 'referral_reward', 'deposits', v_dep.id,
                               'Referral commission ' || trim(to_char(v_comm_pct, 'FM999.99')) ||
                                 '% · ' || (select username from profiles where user_id = v_dep.user_id),
                               'ref_comm:' || v_dep.id);
    end if;
  end if;

  perform app_admin_log('confirm_deposit', v_dep.id::text,
                        v_dep.amount || ' UGX to ' || v_dep.user_id || ' via ' || p_source ||
                        case when v_commission > 0
                             then ' · commission ' || v_commission || ' UGX to ' || v_referrer
                             else '' end);
  return jsonb_build_object('deposit', to_jsonb(v_dep), 'credited', v_dep.amount,
                            'commission_percent', v_comm_pct, 'commission', v_commission,
                            'coverage_pct', app_coverage());
end $$;

create or replace function app_admin_confirm_deposit(p_deposit_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  return app_deposit_credited_core(p_deposit_id, p_note, 'manual', v_uid, null);
end $$;

create or replace function app_withdrawal_paid_core(p_withdrawal_id bigint, p_reference text, p_source text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wd withdrawals;
  v_new_balance numeric;
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

  -- Cash actually leaves the operator float now.
  update reserve set balance = greatest(0, balance - v_wd.payout_amount), updated_at = now()
    where id = 1 returning balance into v_new_balance;
  insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
  values (-v_wd.payout_amount, 'reserve_debit', v_new_balance, p_reference,
          'Withdrawal ' || v_wd.id || ' paid', p_actor, 'wd_pay:' || v_wd.id);

  if v_wd.fee_amount > 0 then
    update reserve set balance = balance + v_wd.fee_amount, updated_at = now()
      where id = 1 returning balance into v_new_balance;
    insert into reserve_entries (amount, kind, balance_after, reference, note, actor_user_id, idem_key)
    values (v_wd.fee_amount, 'fee_income', v_new_balance, null,
            'Fee from withdrawal ' || v_wd.id, p_actor, 'wd_fee:' || v_wd.id);
  end if;

  perform app_admin_log('pay_withdrawal', v_wd.id::text,
                        v_wd.payout_amount || ' UGX to ' || v_wd.user_id || ' via ' || p_source);
  return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'paid', v_wd.payout_amount, 'source', p_source);
end $$;

create or replace function app_withdrawal_failed_core(p_withdrawal_id bigint, p_reason text, p_source text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wd withdrawals;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'INVALID_REQUEST: A failure reason is required.';
  end if;
  select * into v_wd from withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'NOT_FOUND: Withdrawal not found.'; end if;
  if v_wd.status <> 'pending' then
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;

  -- Return the member's reserved balance.
  perform app_credit(v_wd.user_id, v_wd.amount, 'withdrawal_reversal', 'withdrawals', v_wd.id,
                     'Withdrawal failed: ' || left(trim(p_reason), 120), 'wd_fail:' || v_wd.id);

  update withdrawals set status = 'failed', processed_at = now(), processed_by = p_actor,
         gateway_state = case when p_source = 'shashura' then 'failed' else gateway_state end,
         gateway_detail = case when p_source = 'shashura' then left(trim(p_reason), 300) else gateway_detail end,
         note = left(trim(p_reason), 300)
    where id = p_withdrawal_id and status = 'pending';
  select * into v_wd from withdrawals where id = p_withdrawal_id;
  perform app_admin_log('fail_withdrawal', v_wd.id::text, p_reason || ' via ' || p_source);
  return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'refunded', v_wd.amount, 'source', p_source);
end $$;

create or replace function app_admin_pay_withdrawal(p_withdrawal_id bigint, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  return app_withdrawal_paid_core(p_withdrawal_id, p_reference, 'manual', v_uid);
end $$;

create or replace function app_admin_fail_withdrawal(p_withdrawal_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
begin
  return app_withdrawal_failed_core(p_withdrawal_id, p_reason, 'manual', v_uid);
end $$;

create or replace function app_admin_shashura_collect(p_deposit_id bigint, p_gateway_ref text, p_gateway_tid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_dep deposits;
begin
  if coalesce(trim(p_gateway_ref), '') = '' then
    raise exception 'INVALID_REQUEST: A gateway reference is required.';
  end if;
  select * into v_dep from deposits where id = p_deposit_id for update;
  if not found then raise exception 'NOT_FOUND: Deposit not found.'; end if;
  if v_dep.status <> 'pending' then raise exception 'INVALID_REQUEST: Only pending deposits can be collected.'; end if;
  if v_dep.gateway_state not in ('none', 'failed') then
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  update deposits set gateway_ref = trim(p_gateway_ref), gateway_tid = nullif(trim(coalesce(p_gateway_tid, '')), ''),
         gateway_state = 'requested', gateway_detail = null
    where id = p_deposit_id returning * into v_dep;
  perform app_admin_log('shashura_collect', v_dep.id::text,
                        'Requested ' || v_dep.amount || ' UGX from ' || v_dep.payer_account || ' (' || v_dep.gateway_ref || ')');
  return to_jsonb(v_dep);
end $$;

create or replace function app_member_shashura_collect(p_deposit_id bigint, p_gateway_ref text, p_gateway_tid text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_dep deposits;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED: Sign in first.'; end if;
  if coalesce(trim(p_gateway_ref), '') = '' then
    raise exception 'INVALID_REQUEST: A gateway reference is required.';
  end if;
  select * into v_dep from deposits where id = p_deposit_id for update;
  if not found then raise exception 'NOT_FOUND: Deposit not found.'; end if;
  if v_dep.user_id <> v_uid then raise exception 'FORBIDDEN: Not your deposit.'; end if;
  if v_dep.status <> 'pending' then raise exception 'INVALID_REQUEST: Only pending deposits can be collected.'; end if;
  if v_dep.gateway_state not in ('none', 'failed') then
    return jsonb_build_object('deposit', to_jsonb(v_dep), 'replayed', true);
  end if;

  update deposits set gateway_ref = trim(p_gateway_ref), gateway_tid = nullif(trim(coalesce(p_gateway_tid, '')), ''),
         gateway_state = 'requested', gateway_detail = null
    where id = p_deposit_id returning * into v_dep;
  return to_jsonb(v_dep);
end $$;

create or replace function app_admin_shashura_disburse(p_withdrawal_id bigint, p_gateway_ref text, p_gateway_tid text, p_immediate text default 'initiated') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app_admin_guard();
  v_wd withdrawals;
begin
  if coalesce(trim(p_gateway_ref), '') = '' then
    raise exception 'INVALID_REQUEST: A gateway reference is required.';
  end if;
  if p_immediate not in ('initiated', 'paid') then
    raise exception 'INVALID_REQUEST: p_immediate must be initiated or paid.';
  end if;
  select * into v_wd from withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'NOT_FOUND: Withdrawal not found.'; end if;
  if v_wd.status <> 'pending' then
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;
  if v_wd.gateway_state not in ('none', 'failed') then
    return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'replayed', true);
  end if;

  update withdrawals set gateway_ref = trim(p_gateway_ref), gateway_tid = nullif(trim(coalesce(p_gateway_tid, '')), ''),
         gateway_state = p_immediate, gateway_detail = null
    where id = p_withdrawal_id;
  perform app_admin_log('shashura_disburse', p_withdrawal_id::text,
                        'Payout ' || v_wd.payout_amount || ' UGX to ' || v_wd.destination_account ||
                        ' (' || trim(p_gateway_ref) || ', ' || p_immediate || ')');
  if p_immediate = 'paid' then
    return app_withdrawal_paid_core(p_withdrawal_id, coalesce(nullif(trim(coalesce(p_gateway_tid, '')), ''), p_gateway_ref), 'shashura', v_uid);
  end if;
  select * into v_wd from withdrawals where id = p_withdrawal_id;
  return jsonb_build_object('withdrawal', to_jsonb(v_wd), 'initiated', true);
end $$;

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
      -- Deposits settle AUTOMATICALLY: the same credited core the admin
      -- Confirm uses. Only cash that really landed (net of the gateway
      -- charge) funds the reserve, so coverage stays honest.
      perform app_admin_log('shashura_collection_settled', v_dep.id::text,
                            v_dep.amount || ' UGX auto-credited (' || coalesce(v_dep.gateway_ref, v_ref) || ')');
      return app_deposit_credited_core(v_dep.id, null, 'shashura', null,
             case when v_net is not null and v_amt is not null and v_net <= v_amt
                  then v_net else null end);
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


-- 3. Grants (same posture as admin.sql)
grant execute on function app_admin_queue(text) to authenticated;
grant execute on function app_admin_confirm_deposit(bigint, text) to authenticated;
grant execute on function app_admin_pay_withdrawal(bigint, text) to authenticated;
grant execute on function app_admin_fail_withdrawal(bigint, text) to authenticated;
grant execute on function app_admin_shashura_collect(bigint, text, text) to authenticated;
grant execute on function app_member_shashura_collect(bigint, text, text) to authenticated;
grant execute on function app_admin_shashura_disburse(bigint, text, text, text) to authenticated;
revoke all on function app_deposit_credited_core(bigint, text, text, uuid, numeric) from public, anon, authenticated;
revoke all on function app_withdrawal_paid_core(bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function app_withdrawal_failed_core(bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function app_hook_shashura(jsonb) from public, anon, authenticated;
grant execute on function app_hook_shashura(jsonb) to service_role;

-- 4. Sanity: every piece exists with the right signature
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('app_deposit_credited_core', 'app_withdrawal_paid_core',
      'app_withdrawal_failed_core', 'app_admin_shashura_collect', 'app_member_shashura_collect',
      'app_admin_shashura_disburse', 'app_hook_shashura');
  if n <> 7 then raise exception 'shashura-gateway: expected 7 new functions, found %', n; end if;
  if (select count(*) from information_schema.columns
      where table_name = 'deposits' and column_name like 'gateway%') <> 4 then
    raise exception 'shashura-gateway: deposits gateway columns missing';
  end if;
  if (select count(*) from information_schema.columns
      where table_name = 'withdrawals' and column_name like 'gateway%') <> 4 then
    raise exception 'shashura-gateway: withdrawals gateway columns missing';
  end if;
end $$;
