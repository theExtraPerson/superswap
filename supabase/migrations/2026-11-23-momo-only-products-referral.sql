-- ============================================================================
-- SuperSwap migration — 2026-11-23
--   1. Mobile money only (Airtel + MTN): drop the 'bank' channel.
--   2. Products: relax the total-rate cap and load the published catalogue
--      (Spark / Comet / Nova / Quasar / Galaxy) from public/products.jpg.
--   3. Referral program: two generations — L1 17%, L2 1%.
--
-- Run this in the Supabase SQL editor. It is idempotent.
--
-- IMPORTANT — this file only changes DATA and TABLE CONSTRAINTS. The matching
-- logic changes live in the (idempotent, create-or-replace) function scripts, so
-- AFTER running this migration, re-run in order:
--     supabase/rpc.sql      -- app_dashboard, app_public_info, app_team,
--                           -- app_open_deposit / app_open_withdrawal
--     supabase/admin.sql    -- app_deposit_credited_core (pays L1 + L2),
--                           -- app_admin_upsert_product, app_admin_setting_spec
-- Without those two, the app still enforces the old single-tier referral and the
-- old channel/rate rules at the function level.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Channels: mobile money only.
--    Added NOT VALID so any legacy 'bank' rows do not abort the migration; the
--    constraint governs every new/updated row from now on.
-- ---------------------------------------------------------------------------
alter table deposits    drop constraint if exists deposits_channel_check;
alter table deposits    add constraint deposits_channel_check
  check (channel in ('momo')) not valid;

alter table withdrawals drop constraint if exists withdrawals_channel_check;
alter table withdrawals add constraint withdrawals_channel_check
  check (channel in ('momo')) not valid;

-- ---------------------------------------------------------------------------
-- 2a. Vault products: allow total returns above 100% (the published plans run
--     225%–547% total over their terms).
-- ---------------------------------------------------------------------------
alter table vault_products drop constraint if exists vault_products_total_rate_pct_check;
alter table vault_products add constraint vault_products_total_rate_pct_check
  check (total_rate_pct between 0 and 1000);

-- ---------------------------------------------------------------------------
-- 2b. Replace the catalogue with the published product table.
--     Each plan is a FIXED swap amount (min = max). total_rate_pct is the TOTAL
--     profit over the term against that principal (total_profit / principal).
--     Old cycles keep their stored product_snapshot, so history is unaffected.
-- ---------------------------------------------------------------------------
delete from vault_products where slug in ('starter-30', 'growth-90', 'anchor-180', 'anchor-365');

insert into vault_products (slug, name, min_principal, max_principal, duration_days, total_rate_pct, early_exit_percent, terms) values
  ('spark',  'Spark',  10000,  10000,  10, 225.000, 90,
   'Swap 10,000 UGX · earn 2,250 daily for 10 days · total profit 22,500. Yield is fixed at opening and paid in full at maturity. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('comet',  'Comet',  30000,  30000,  15, 300.000, 90,
   'Swap 30,000 UGX · earn 6,000 daily for 15 days · total profit 90,000. Yield is fixed at opening and paid in full at maturity. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('nova',   'Nova',   80000,  80000,  20, 546.875, 90,
   'Swap 80,000 UGX · total profit 437,500 over the term. Yield is fixed at opening and paid in full at maturity. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('quasar', 'Quasar', 150000, 150000, 25, 500.000, 90,
   'Swap 150,000 UGX · total profit 750,000 over the term. Yield is fixed at opening and paid in full at maturity. Early exit returns 90% of principal; unearned yield is forfeited.'),
  ('galaxy', 'Galaxy', 300000, 300000, 30, 500.900, 90,
   'Swap 300,000 UGX · earn 50,090 daily for 30 days · total profit 1,502,700. Yield is fixed at opening and paid in full at maturity. Early exit returns 90% of principal; unearned yield is forfeited.')
on conflict (slug) do update set
  name = excluded.name,
  min_principal = excluded.min_principal,
  max_principal = excluded.max_principal,
  duration_days = excluded.duration_days,
  total_rate_pct = excluded.total_rate_pct,
  early_exit_percent = excluded.early_exit_percent,
  terms = excluded.terms,
  visible = true,
  active = true,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Referral program: two generations (L1 17%, L2 1%).
--    Seeded here so the live rules match the published program; the operator
--    can still change either from the admin Settings desk.
-- ---------------------------------------------------------------------------
insert into platform_settings (key, value, updated_at) values
  ('referral_commission_percent',    '17', now()),
  ('referral_commission_l2_percent', '1',  now())
on conflict (key) do update set value = excluded.value, updated_at = now();
