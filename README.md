# SuperSwap — term savings with reserved yield

A live fintech-style app for Uganda (UGX, mobile money first) built on the
lesson the original scheme material teaches: **fixed daily yields and
recruitment commissions are how these schemes collapse.** SuperSwap is the
honest version of the same mechanics —

- **Term vaults with a fixed total rate.** The total rate is fixed at opening
  (never a "daily" rate). The float that backs every payout is held in the
  external Shashura account, which the application does not mirror — there is
  no in-app reserve balance or coverage number.
- **One-level (L1) referral commission + a one-time welcome bonus.** The
  referrer earns a percent of every deposit their referee makes; new members
  are credited a flat bonus at sign-in. Both are operator-funded promotions
  that ride outside vault yield — no commission on commissions, ever.
- **Withdrawal desk hours.** Withdrawal requests are only taken inside a
  published window on the platform timezone (deposits and vault operations are
  not windowed; the separate daily books-close lock still applies).
- **Admin-confirmed money movement.** Deposits and withdrawals are queued and
  settled by an operator against real MoMo/bank movements (idempotent,
  ledgered); a PSP integration can drive the same RPCs later.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres,
Auth, RLS) · installable PWA.

**The rules live in SQL, not in this repo's TypeScript.** Routes are thin
pass-throughs to `app_*` RPCs; clients never write tables (RLS is read-only)
and never supply user ids — `auth.uid()` is read inside the definer
functions.

## Database (`supabase/`)

Apply in order against your project (SQL editor or `supabase db push`):

0. **`migrations/*.sql`** — deploy-time changes for a database that already
   runs. Apply in filename order: `2026-11-22-money-rules-v2.sql` retires the
   old flat referral reward and sets the 17% withdrawal fee, 18% L1 commission,
   1 500 UGX welcome bonus and the 09:00–21:00 `Africa/Kampala` withdrawal
   window; `2026-11-24-remove-reserve-functions.sql` MUST run before
   `2026-11-24-drop-reserve-tables.sql` (functions first, then the tables —
   never CASCADE). Skip on a virgin database — `schema.sql` already reflects
   the current shape — then re-run steps 2 and 3 so the functions match.

1. **`schema.sql`** — drops any legacy simulator tables; creates
   `platform_settings` (the money-rule authority, seeded), `vault_products`
   (honest vaults seeded), `profiles` (username/phone/referral validation
   via the `app_handle_new_user` auth trigger), append-only `ledger`,
   `vault_cycles` (rate snapshot + `promised_yield` per cycle),
   `deposits`/`withdrawals` queues, `payment_events`, RLS on everything.
   There is no reserve table — the backing float lives in Shashura.
2. **`rpc.sql`** — member RPCs: `app_dashboard`, `app_open_vault`,
   `app_exit_vault`, `app_open_deposit`, `app_open_withdrawal`, `app_team`,
   `app_public_info`. `app_obligations()` reports member liability (wallets +
   open-vault payouts) to the admin desk; there is no coverage ratio or
   solvency gate because the backing float is external and not mirrored here.
   `app_settle_matured()` is the idempotent settlement body — Supabase pg_cron
   fires it daily at 22:05 EAT (vaults mature on the `timezone` wall clock at
   `settlement_hour`). Clock rules go through
   `app_clock()` (wall clock in the `timezone` setting), the withdrawal window
   gate is `app_assert_withdrawal_window()`, and promo credits go through
   `app_promo_credit()` — a plain, idempotent wallet credit.
3. **`admin.sql`** — operator layer: `app_admin_guard()` (membership in the
   `admins` table **is** admin) + `app_admin_log()` audit in every mutation;
   settlement (`app_admin_confirm_deposit` / `reject_deposit` /
   `pay_withdrawal` / `fail_withdrawal`), products, settings whitelist, wallet
   corrections, bans, grants by **username**. There is no reserve top-up/draw
   RPC — that money moves through Shashura, outside the app.
   Bootstrap the first operators: put their usernames in the array in the
   `do $$` block at the bottom and re-run (idempotent; skipped once any admin
   exists).

### Auth model

Members register with **name, username, phone, password (+ optional referral
code)**. Supabase Auth is email-keyed, so the DB maps `username →
username@auth_email_domain` via `app_auth_email()` — the domain is a
deploy-time `platform_settings` seed (`auth_email_domain`; this deployment uses
`accounts.superswap-nine.vercel.app`, and no mail is ever sent there).
**Changing it after users exist breaks their logins**, so `app_auth_email()`
returns NULL for an unusable host (empty, or a reserved TLD such as `*.local`)
and `app_admin_set_setting()` refuses the key entirely once any profile exists.
Login is username + password (`/api/auth/login`, cookie sessions via
`@supabase/ssr`, bearer JWT also accepted).

Two Supabase **dashboard** switches this design depends on and SQL cannot set —
Authentication → Providers (Sign in / Up) → **Email**:

1. **Email provider: enabled.** Otherwise every signup dies with
   `400 Email signups are disabled` and every login with
   `422 Email logins are disabled`.
2. **Confirm email: disabled.** These mailboxes do not exist, so a confirmation
   mail can never arrive and members would be locked out at "check your inbox".

Both faults answer `503 AUTH_NOT_CONFIGURED` (never a bare 500), and the raw
GoTrue message is logged server-side as `[auth-fail] <op> <status> <message>`.

### Branding & the share card

`public/logo.jpg` (the 1280x478 wordmark) is the visible mark everywhere —
welcome, login, register and the member-desk header — rendered by `BrandMark`
(`src/components/ui.tsx`). `public/ogg.jpg` is the Open Graph image every shared
link previews with (`openGraph` + `twitter: summary_large_image` in
`src/app/layout.tsx`). The two files are byte-identical today and named
separately on purpose, so the share artwork can diverge without a code change;
both paths come from `brand.logo` / `brand.share` (`src/lib/brand.ts`).

A referral link is `…/register?code=CODE`, built in the Refer tab (native share
sheet, clipboard fallback). `/register` is a **server** route with
`generateMetadata`, so the code is echoed into `og:title`, `og:description` and
`og:url` before any JavaScript runs — which is exactly what a WhatsApp/Facebook
scraper sees. Nothing here is guessed:

- code shape `^[A-Z0-9]{4,10}$` is the same regex `POST /api/auth/register`
  enforces, and `app_gen_code()` emits 8 characters from
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — a link, the form field and the trigger's
  `upper(trim(code))` lookup cannot disagree;
- attribution stays in SQL: `app_handle_new_user()` resolves the code to
  `profiles.referred_by`, `app_admin_confirm_deposit()` pays the L1 commission off
  every confirmed referee deposit, `app_team()` reads both back;
- the card shows the code but never the referrer's name — the only public lookup
  is `app_referral_valid()`, which answers existence, not identity.

## API routes

Uniform envelope `{ data } | { error: { code, message } }`.

| Route | RPC | Auth |
|-------|-----|------|
| `GET /api/health` · `GET /api/info` | `app_public_info` (probe) | public |
| `POST /api/auth/register` · `/login` · `/logout` | Supabase Auth | public |
| `GET /api/auth/callback` | PKCE code exchange | public |
| `GET /api/me` · `GET /api/dashboard` | `app_profile` / `app_dashboard` | member |
| `GET /api/team` | `app_team` | member |
| `POST /api/bonus/welcome` | `app_claim_signup_bonus` (replay-safe) | member |
| `POST /api/vaults/open` · `/exit` | `app_open_vault` / `app_exit_vault` | member |
| `POST /api/deposits` · `/withdrawals` | `app_open_deposit` / `app_open_withdrawal` | member |
| `POST /api/settle` | `app_settle_matured` | `Bearer $CRON_SECRET` (service-role) |
| `/api/admin/*` (self, dashboard, queue, settle, members, products, settings, admins, audit) | `app_admin_*` | admin (guard in SQL) |

Scheduling: Supabase pg_cron (registered by
`supabase/migrations/2026-11-24-referral-league-and-eat-settlement.sql`) releases
all matured payouts daily at 22:05 EAT — Vercel Cron is deprecated. Any external
timer may also fire the same idempotent run:
`POST /api/settle` with `Authorization: Bearer $CRON_SECRET`. The service-role
key is used **only** there.

## Screens

- `/` — branded welcome (fee + catalogue via anon RPC)
- `/register` · `/login` — username-based auth
- `/app` — member desk: Vaults (catalogue, open with preview, cycles, early
  exit) · Money (deposit/withdraw queues) · History (own ledger) · Refer
- `/admin` — ops desk: Overview (obligations + queues) · **Queues** (settlement
  workbench) · Members · Vaults (products) · Settings (money rules, whitelisted
  keys) · Admins · Audit

## Money-rule sync rule

Every default exists in **three places that must match**:
`platform_settings` seeds (`schema.sql`) = `app_setting_*` fallbacks
(`rpc.sql`) = `appRulesFallback` (`src/lib/supabase/config.ts`).

For a **live** database the seed never overwrites operator edits, so changing a
rule means: add/adjust a key in the seed + the RPC fallbacks + `config.ts`, then
ship a migration that upserts the new value and (for a new key) adds it to the
`app_admin_setting_spec()` whitelist so the desk can edit it. `/api/admin/*`
and the settings form render from that whitelist — nothing to patch in the UI.

Current values: min deposit 10 000 · min withdrawal 5 000 · withdrawal fee 17% ·
withdrawal window 09:00–21:00 `Africa/Kampala` · welcome bonus 1 500 UGX ·
L1 referral commission 18% · L2 referral commission 1% · settlement 22:00 EAT
(payouts released 22:05 EAT by pg_cron) · daily lock 19:45 (2 h, database
clock).

## Develop

```bash
npm install
cp .env.example .env.local   # fill in your Supabase keys
npm run dev                  # http://localhost:3000
npm run build ; npm run lint
```

## Before going live

- Set `auth_email_domain` to a host you own **before** the first signup — it
  freezes afterwards (see Auth model).
- Enable the Email provider and keep "Confirm email" off (see Auth model);
  configure SMTP only if you deliberately turn confirmation back on.
- Set `NEXT_PUBLIC_SITE_URL` to the deployed origin. It is both the auth
  redirect base and `metadataBase`, so a stale value ships share cards that
  point at the wrong site.
- Point the merchant line in the deposit copy at a real receivable account.
- Rates: keep total-over-term honest; growth is bounded by the operator's
  externally funded reserve — that is the intended trade-off.
