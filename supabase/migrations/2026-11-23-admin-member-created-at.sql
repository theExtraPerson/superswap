-- Fix: admin member-detail 500.
-- app_admin_member aggregated the cycles block with `order by c.created_at desc`,
-- but its inner subquery did not project created_at, so Postgres raised
-- "column c.created_at does not exist" (42703), which the API mapped to a 500.
-- Adding created_at to the select list resolves it. Re-running this is safe.

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
                   opened_at, matures_at, closed_at, created_at, product_snapshot -> 'name' as product_name
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

grant execute on function app_admin_member(uuid) to authenticated;
