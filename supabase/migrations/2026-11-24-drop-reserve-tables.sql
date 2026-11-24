-- ============================================================================
-- SuperSwap — remove the reserve feature (phase 2: DROP TABLES)
-- run ONLY AFTER 2026-11-24-remove-reserve-functions.sql is deployed.
--
-- The real reserve is the external Shashura account, protected from the app,
-- so the in-app reserve tables are removed outright — NOT replaced by a
-- computed estimate. The functions that read/wrote them were already rewritten
-- in the previous migration, so nothing here depends on these objects.
--
-- IRREVERSIBLE: dropping these tables permanently deletes the single reserve
-- record and its reserve-history entries. That is intended — the authoritative
-- balance lives off-platform in Shashura, and keeping a stale local mirror
-- would be misleading.
--
-- NO CASCADE: CASCADE would silently drop other database objects that happen
-- to point at these tables. Child table first, then the parent; a plain DROP
-- fails loudly if anything still references them, which is exactly what we
-- want as the guard that phase 1 completed.
-- ============================================================================

drop table if exists reserve_entries;
drop table if exists reserve;

-- Sanity: both reserve tables are gone and nothing was left dangling.
do $$
declare n int;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name in ('reserve', 'reserve_entries');
  if n <> 0 then raise exception 'drop-reserve-tables: reserve table(s) still present'; end if;
end $$;
