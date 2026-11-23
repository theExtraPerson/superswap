-- ============================================================================
-- Migration: vault_cycles.created_at — fixes the member desk + admin 500
-- Date: 2026-11-23
--
-- Root cause it repairs:
--   app_dashboard (rpc.sql) and app_admin_member_detail (admin.sql) both do
--   `... from vault_cycles ... order by created_at desc`. The live vault_cycles
--   table never had a created_at column, so for any member with a session the
--   aggregator raised `42703 column "created_at" does not exist`, which the API
--   masked as a generic 500. The whole member desk hangs on that one call.
--
-- Fix chosen (parity, not code churn): every sibling ledger table
--   (deposits/withdrawals/ledger/profiles) already carries created_at; this
--   aligns vault_cycles with them rather than editing two function bodies.
--   schema.sql is updated to match so fresh databases get the column directly.
--
-- Idempotent and backfill-safe. Apply on the LIVE project (Supabase SQL
-- editor) or `supabase db push`. A FRESH database does not need this file —
-- schema.sql already creates the column — but re-running it is harmless.
-- ============================================================================

-- 1) Add the column nullable first so existing rows can be backfilled sensibly.
alter table vault_cycles add column if not exists created_at timestamptz;

-- 2) Backfill existing cycles from their business open time, not now(), so the
--    "newest first" ordering reflects when each vault was actually opened.
update vault_cycles set created_at = opened_at where created_at is null;

-- 3) Now tighten it to match the schema.sql contract.
alter table vault_cycles alter column created_at set default now();
alter table vault_cycles alter column created_at set not null;

-- 4) Sanity: the column must exist and be fully populated.
do $$
declare
  v_nulls bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vault_cycles' and column_name = 'created_at'
  ) then
    select count(*) into v_nulls from vault_cycles where created_at is null;
    raise notice 'vault_cycles.created_at present; % rows still null (must be 0)', v_nulls;
  else
    raise exception 'vault_cycles.created_at is STILL missing - migration did not apply';
  end if;
end $$;

-- Result set for a quick eyeball in the SQL editor.
select column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'vault_cycles'
order by ordinal_position;
