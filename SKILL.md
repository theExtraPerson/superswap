---
name: fintech-plan-app
description: Blueprint for building a mobile-money "investment plan" fintech app by cloning an existing site's UI/UX and user flow, then rebuilding the standard money logic on Next.js + Supabase. Covers the invariant subsystems — plans/products with daily earnings + maturity, an append-only ledger driven by security-definer RPCs, admin-editable money rules (min/max deposit & withdrawal, windows, credit time, payout fee %, daily check-in reward), a two-way deposits/withdrawals flow (API + manual), a referral commission engine, an admin operations desk with a privilege guard + audit log, and the app shell (Home carousel · product tab with progress bars · league/team · wallet · avatar profile, tab bar, downloadable PWA, floating support). Use when creating, cloning, or reverse-engineering an earnings/investment/referral wallet app, wiring Supabase money RPCs, or standing up its admin dashboard and quick-action UI.
---

# Fintech Plan App — Clone the Skin, Rebuild the Money Engine

This is a repeatable playbook, not a one-off. Almost every app in this family —
"activate a package, earn a fixed amount every day until maturity, deposit and
withdraw via mobile money, invite to earn commission, run it from an admin desk"
— has the **same skeleton**. The winning move is:

1. **Clone the reference site's UI/UX and flow** (theme, screens, wording, quick actions).
2. **Rebuild the logic from this blueprint** (schema, RPCs, rules, admin, referrals).

Treat the money layer as the product. The skin is interchangeable; the engine
is not.

## The eight invariant subsystems

| # | Subsystem | Where it lives | Non-negotiable |
|---|-----------|----------------|----------------|
| 1 | Data model (ledger + queues) | `supabase/schema.sql` | Append-only ledger; RLS on every table |
| 2 | Money RPC engine | `supabase/rpc.sql` | All writes go through `security definer` functions; never direct table writes |
| 3 | Money rules & settings | `platform_settings` + `src/lib/supabase/config.ts` | A DB settings row overrides the code fallback; env mirrors it for UI |
| 4 | Deposits & withdrawals | RPCs + gateway lib + callback route | Deposits automatic via the gateway; withdrawals admin-approved (manual or API); settlement idempotent via a unique event key |
| 5 | Plans / products & earnings | `plans` table + `src/lib/plans.ts` | `price + daily×days = total return`; daily credit matures at a fixed local hour |
| 6 | Referral commission | `referral_commissions` + credit on activation | 2 levels, rates from settings, idempotent per investment |
| 7 | Admin desk + privileges | `supabase/admin.sql` + `src/app/admin` | Membership-in-table = admin; every mutation guarded + audited |
| 8 | App shell & quick actions | `src/components/shell`, `manifest.ts`, Telegram float | Tab bar, downloadable PWA, floating support, one-round-trip dashboard |

## Tech stack baseline

- **Next.js (App Router) + TypeScript**, server actions for writes.
- **Supabase**: Postgres + RLS + `security definer` RPCs; auth is username-mapped-to-email (`user@domain`) so login is just handle + password.
- **Mobile-money gateway** behind one server-only module (e.g. Shashura `/requestToPay` + `/disburse` + signed callback). Keep every secret non-`NEXT_PUBLIC_`.
- **Vercel** deploy with a scheduled job for the daily credit (Schedules/Cron → a private route).
- Single `brand.ts` as the one source of truth for name, currency, support links, referral copy.

## 1 · Data model

Six money tables plus admin. Column types `numeric(14,2)`; every table gets indexes on `(user_id, …)` and `(status, created_at)`.

- **profiles** — `balance` (cash to invest/withdraw), `total_invested`, `total_earned`, `referral_earned`, `referral_code`, `referred_by`, `is_banned`. Provisioned by an `after insert on auth.users` trigger (`handle_new_user`) that also credits a one-time registration bonus.
- **plans** — `slug`, `name`, `amount`, `daily_return`, `duration_days`, `badge`, `is_active`, `sort_order`. Seed the catalogue with `on conflict (slug) do update`; retire old rows via `is_active` so history still resolves.
- **investments** — one row per activated cycle: snapshot the plan's `amount`/`daily_return`/`duration_days`, then `total_return = amount + daily_return*duration_days`, `days_paid`, `last_paid_at`, `status ('active'|'completed')`, `started_at`, `ends_at`. **Snapshot the plan** so later admin edits don't rewrite live cycles.
- **transactions** — append-only ledger. `type ∈ (deposit, investment, earning, referral, withdrawal, capital_return, registration_bonus, adjustment_credit, adjustment_debit)`; `status ∈ (pending, completed, rejected)`; unique `reference`; `meta jsonb`. This is the single source of truth for "what happened".
- **deposits / withdrawals** — operator + gateway queues with a shared status shape (`pending/awaiting_pin/…` and `pending/processing/paid/…`), gateway columns (`tid, network, gateway_state, charge, net_amount, failure_*`) and `settled_at`. Withdrawal holds the wallet at request time.
- **payment_events** — every callback/poll is logged here first; `unique (tid, type, status)` is what makes settlement idempotent (retries and a poll racing a callback settle exactly once).
- **referral_commissions** — `unique (investment_id, user_id, level)` so a commission cannot pay twice.

> Full column lists, status vocabularies and the upgrade/idempotency pattern: [reference.md](reference.md).

## 2 · Money RPC engine

Every balance change is a Postgres function. Rules to follow without exception:

- **`security definer` + `set search_path = public`** on every function that touches money.
- **Revoke** helper/internal functions from `public, anon, authenticated`; **grant** member entry points to `authenticated` and server entry points to `service_role` explicitly (don't rely on default privileges).
- Read `auth.uid()` inside the function; **never trust a client-supplied user id**.
- Row-lock (`select … for update`) the profile/investment before mutating.
- Raise **named exceptions** (`'INSUFFICIENT_BALANCE: …'`, `'MIN_DEPOSIT: …'`) so the client can map the code before the colon to a friendly sentence.
- Credit the ledger and the balance in the **same** function so they can't drift.

The daily credit is a **maturity** function, not a timer:
`vanta_maturity_at(started_at, day_index)` = the local calendar day of `start + index` at the configured `earnings_mature_at` hour, always rolled strictly after `started_at`. The scheduler then pays every investment whose next maturity `<= now()`, one credit per day of the cycle, and on the last day returns `amount` as `capital_return` and marks the cycle `completed`. Because the query is `maturity <= now()`, a missed night is caught up on the next run.

> Function inventory and the `pay_day` / `run_daily_payouts` / `claim_earnings` flow: [reference.md](reference.md).

## 3 · Money rules & settings

The **authority is a `platform_settings` row**, and every RPC reads it through a helper that falls back to a published default:

```sql
vanta_setting_number('min_withdrawal', 5000)
vanta_setting_text('earnings_mature_at', '22:00')
```

The same figures are mirrored in `src/lib/supabase/config.ts` (via `NEXT_PUBLIC_*`) **only** so forms can state them before a round-trip — the code copy never wins. A `vanta_rules()` RPC returns the live set so the UI shows truth.

Standard rules to expose (all admin-editable, none requiring a deploy):

- `min_deposit`, `min_withdrawal` (table `CHECK` keeps a lower historical floor; the setting is the real gate)
- `withdrawal_fee_percent` (cut from gross → member paid net)
- `withdrawal_opens_at` / `withdrawal_closes_at` (local-time window)
- `earnings_mature_at` (the daily credit hour, local time)
- `registration_bonus` (0 disables)
- `checkin_bonus` (daily check-in reward; 0 disables; overlay-funded like other promos)
- `referral_rate_l1` / `referral_rate_l2`
- `platform_frozen` + `freeze_message` (global "pause deposits/claims/withdrawals" switch)
- `telegram_community` / `telegram_support` / `telegram_handle` (support links retarget without a deploy)

## 4 · Deposits & withdrawals (API + manual, two-way)

The gateway in this build is **Shashura** (`https://shashura.com/developers`): Bearer token from `/auth` (client_id + secret, `X-Target-Environment: sandbox|production`, `X-COUNTRY: UG`), `/requestToPay` collections, `/disburse` payouts, `/enquiry/{ref|tid}` status pulls, and a signed `transaction.finalized` webhook. The server client lives in `src/lib/shashura/client.ts`; credentials are env-only (`SHASHURA_CLIENT_ID/SECRET/TARGET_ENV/WEBHOOK_SECRET`), never DB settings.

**Deposit (collection) — AUTOMATIC:** the member opens a `deposits` row (pending) and `/api/deposits` immediately fires a MoMo PIN prompt (`/requestToPay`, ref `DEP-<id>-<ts>`) to the payer number. The signed callback (or a "Check status" enquiry) runs `app_hook_shashura`, which **credits the deposit itself** through `app_deposit_credited_core` — the SAME core the admin Confirm uses — funding the wallet at `amount` and the reserve at `net_amount` (only cash that really landed). The admin desk keeps Confirm/Reject purely as the fallback for bank transfers, dead/failed gateway attempts and amount mismatches (the one case the hook refuses to auto-credit). A failed collection stays retryable by the member or the admin.

**Withdrawal (disbursement) — the admin approves, and picks the settlement route:** the member's request runs **rules first** (window, min, fee, banned check, coverage gate), debits the wallet at request time and queues a `pending` row. The desk then chooses:
- **manual** — operator sends the money off-platform, then "Mark paid" (`app_admin_pay_withdrawal`).
- **API** — "Pay via Shashura" (`/disburse`, deterministic ref `WD-<id>` so a replay hits `DUPLICATE_REFERENCE` instead of double-paying). Airtel returns `TS` and settles on the spot; MTN returns `PENDING` and settles automatically when the webhook fires. A `FAILED` result auto-refunds the member.

Both routes funnel through ONE settlement core (`app_deposit_credited_core` / `app_withdrawal_paid_core` / `app_withdrawal_failed_core`), so automatic and manual settlement can never drift; the status transition under a row lock is the replay guard, and every callback is deduped in `payment_events`. If the webhook never lands (local dev, firewalled), the admin's "Check status" runs the same `app_hook_shashura` funnel from an enquiry result.

Webhook rule: verify `X-Shashura-Signature` (HMAC-SHA256 over the RAW body, keyed with the app's webhook secret) before parsing; the callback route has no session, so it runs through the service-role-only `app_hook_shashura`.

Quick-action / eligibility gate worth copying: block withdrawals for members with **no investment yet** (`not exists (select 1 from investments where user_id = auth.uid())`), so a registration bonus or referral credit can't be cashed out without ever funding a plan. Once they invest, it unlocks permanently.

## 5 · Plans / products & earnings

A plan is `(price, daily_return, duration_days)`. Derive everything else:

```
totalEarnings = daily_return * duration_days
totalReturn   = price + totalEarnings
roi%          = round(totalEarnings / price * 100)
```

Show price, daily earning, duration, total earnings and payout-at-maturity on the card *before* activation (this is a trust feature). Activating debits `price` from `balance`, credits `total_invested`, opens an `investment`, and pays referral commission.

## 6 · Referral commission

Two levels, rates from settings, paid the instant an invitee **activates** a plan:

```
L1 (referrer of investor): rate_l1 * amount     e.g. 17%
L2 (referrer of referrer): rate_l2 * amount     e.g.  1%
```

Each level: write a `referral_commissions` row (`on conflict do nothing` → idempotent), credit the beneficiary's `balance` + `referral_earned`, and append a `referral` ledger entry. The invite code rides in from `/register?code=XXXXXX`. Keep codes ambiguous-glyph-free (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) so they can be read aloud.

## 7 · Admin desk & privileges

**Model:** membership in an `admins` table *is* admin — no role enum on profiles. Every admin entry point is a `security definer` function that first calls `vanta_admin_guard()` (checks `auth.uid()` against `admins`, returns the actor id, else raises `FORBIDDEN`). Granted to `authenticated` (admin acts with their own session → the audit log is meaningful), never `anon`. Every mutation calls `vanta_admin_log(actor, action, target_type, target_id, note)`.

**Sections (mirrors a single `vanta_admin_dashboard()` round-trip):**
- **Metrics** — members total/today, active cycles, deposits received, withdrawals paid, fees collected, returns + commission paid, wallet liability.
- **Members** — searchable; per-member detail (profile, cycles, ledger, downline); adjust wallet (`p_delta` signed, reason required, writes an `adjustment_*` ledger row); ban/unban (can't ban self).
- **Deposits** / **Withdrawals** — the queues; approve/reject/disburse/settle actions.
- **Plans** — upsert products (existing cycles keep their snapshot).
- **Admins** — grant by username; revoke (never the last one, never self).
- **Settings** — the money rules + freeze switch + Telegram links.
- **Audit** — the append-only trail.

Bootstrap the first admin with an idempotent `do $$` seed (edit the username list), skipped entirely if any admin already exists.

## 8 · App shell & quick actions

The **user flow** to clone: Landing → Register (phone/username, optional invite) → **Home** → Products (**VIP**) → **League** (team) → **Wallet** → **Profile** (settings). A **single `vanta_dashboard()` RPC** returns the whole authenticated payload in one round-trip (profile, wallet, investments, transactions, referrals, payments, rules, check-in state).

Reference information architecture (superswca-style), one screen per bottom tab plus an avatar sheet:
- **Tab bar** (Home · VIP · League · Wallet), sticky bottom, safe-area padding, icon + caption per tab. **Profile is not a tab** — it opens from the circular avatar button in the top-right header.
- **Header** (all screens): brand wordmark left, avatar right; the avatar toggles the Profile sheet.
- **Home**: wallet hero (balance + live reserve-coverage bar) → **sliding highlights carousel** (autoplay + dots + swipe; slides are built from the live rules: welcome bonus, referral rate, coverage, withdrawal window) → **daily check-in strip** (7-day boxes, `Claim +bonus` → the check-in RPC, replay-safe per platform day, streak shown) → **quick-action orbs** (Deposit · Withdraw · Vaults · Refer) → **recent activity** (top ledger rows + "See all" deep-link into Wallet).
- **VIP**: an "your active plan" hero with a real **term progress bar** (elapsed/total toward maturity), then the product shelf — every card shows rate, duration, range and a **Start investing now** CTA that opens the activation form inline; open cycles list below with per-cycle progress + disclosed early exit.
- **League**: rank-style header with real counters (Invited · Active · Commission earned), the referral code + Share/Copy card, and the **invited-members table** showing join date, first deposit, deposits total and what each earned you.
- **Wallet**: **Total balance vs Withdrawable vs In active plans** up front (total = cash + locked principal; the delta is explained in one line), then the deposit/withdraw forms + queues, then the full **recent transactions** ledger.
- **Profile**: identity block (gradient-ring avatar, name, @handle, member since) → money snapshot → **quick-jump buttons** (Wallet · Referrals · Team · Rewards) → settings pack: **Install app** (PWA tile), **Change password** (own-session GoTrue update, min length = registration's), **About** (promise, rails, compliance note, support), ops-desk link, **Sign out**.
- **Floating support**: links come from settings with brand fallback so the desk never disappears.
- **Downloadable PWA**: `manifest.ts` (standalone, icons incl. maskable, app shortcuts) + an install tile using `beforeinstallprompt`; iOS Add-to-Home via meta.
- **Marketing/auth components** reuse `brand.ts` copy; the auth screens map username → email.

## Build workflow checklist

```
- [ ] brand.ts: name, currency, support links, referral copy, plan table
- [ ] schema.sql: 6 money tables + RLS + handle_new_user trigger + plan seed
- [ ] rpc.sql: helpers (clock/maturity/settings/lock), pay_day, create_investment,
      claim_earnings, deposit/withdrawal openers, gateway settle/fail, dashboard, rules
- [ ] admin.sql: admins/platform_settings/audit + guard + log + all admin RPCs + seed
- [ ] config.ts: env-mirrored rules (fallbacks must equal RPC fallbacks)
- [ ] Server actions + a DB-error → friendly-message map (code before ':')
- [ ] Gateway module (server-only) + /callback route (signature-verified, idempotent)
- [ ] Daily payout route + Vercel Schedule/Cron at the maturity hour
- [ ] Shell: tab bar, dashboard RPC, wallet forms, quick actions, PWA, Telegram float
- [ ] Admin dashboard screens wired to the admin RPCs
- [ ] Security pass: RLS everywhere, writes only via definer, secrets non-public,
      idempotent settlement, admin guard + audit on every mutation
```

## Security rules — never break these

- No client ever writes a money table directly; only `security definer` RPCs do.
- Read `auth.uid()` server-side; ignore any `user_id` from the client.
- Settlement is **idempotent** (unique event key; already-credited short-circuits return 0).
- Fee/min/max/window are enforced **in SQL**, not just the form.
- Admin = table membership + per-call guard + audit row. No shared admin password.
- Gateway webhook must verify signature before touching the ledger.
- Platform freeze + per-account ban are enforced inside the money RPCs.

For concrete column lists, the full RPC/settings/status catalogues, the exact five-plan earnings table and the env-var set, see [reference.md](reference.md).
