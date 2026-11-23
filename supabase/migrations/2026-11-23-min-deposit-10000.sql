-- ============================================================================
-- Migration: deposit/withdrawal minimums — 10 000 / 5 000 UGX
-- Date: 2026-11-23
--
-- What changes (platform_settings is the authority; code only mirrors it):
--   min_deposit      1 000 -> 10 000  (three synced places updated with this:
--                                      schema.sql seed, rpc.sql app_setting_num
--                                      fallbacks, src/lib/supabase/config.ts)
--   min_withdrawal   5 000 ->  5 000  (unchanged; upserted here so a live
--                                      database that drifted is realigned)
--
-- Idempotent: upserts the two rows regardless of prior operator edits.
-- Apply on a live project (Supabase SQL editor) or `supabase db push`.
-- For a FRESH database the seed in schema.sql already carries these values;
-- this file is harmless to re-run there too.
-- ============================================================================
insert into platform_settings (key, value)
values
  ('min_deposit', '10000'),
  ('min_withdrawal', '5000')
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

-- Sanity: minimums must be positive and the deposit floor is the larger one.
do $$
declare
  v_dep numeric := (select value::numeric from platform_settings where key = 'min_deposit');
  v_wd  numeric := (select value::numeric from platform_settings where key = 'min_withdrawal');
begin
  if v_dep < 1 or v_wd < 1 then
    raise exception 'minimums must be positive (deposit %, withdrawal %)', v_dep, v_wd;
  end if;
  raise notice 'min deposit % UGX | min withdrawal % UGX', v_dep, v_wd;
end $$;

-- Result set for a quick eyeball in the SQL editor.
select key, value, updated_at
from platform_settings
where key in ('min_deposit', 'min_withdrawal')
order by key;
