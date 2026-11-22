# SuperSwap — term savings with reserved yield

A live fintech-style app for Uganda (UGX, mobile money first) built on the
lesson the original scheme material teaches: **fixed daily yields and
recruitment commissions are how these schemes collapse.** SuperSwap is the
honest version of the same mechanics —

- **Fully-reserved term vaults.** The total rate is fixed at opening (never a
  "daily" rate), and the SQL *refuses to open any vault whose full payout is
  not already funded* in the operator reserve. Coverage % is published to
  every member and can never silently drop below 100%.
- **One-level referral attribution, flat operator-funded reward** — no chain
  commissions, ever.
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

1. **`schema.sql`** — drops any legacy simulator tables; creates
   `platform_settings` (the money-rule authority, seeded), `vault_products`
   (4 honest vaults seeded), `profiles` (username/phone/referral validation
   via the `app_handle_new_user` auth trigger), append-only `ledger`,
   `reserve` + `reserve_entries`, `vault_cycles` (rate snapshot +
   `promised_yield` per cycle), `deposits`/`withdrawals` queues,
   `payment_events`, RLS on everything.
2. **`rpc.sql`** — member RPCs: `app_dashboard`, `app_open_vault`,
   `app_exit_vault`, `app_open_deposit`, `app_open_withdrawal`, `app_team`,
   `app_public_info`, plus the solvency gate (`app_obligations`,
   `app_coverage`, `app_assert_solvent`) that every promise passes through.
   `app_settle_matured()` is the idempotent cron body.
3. **`admin.sql`** — operator layer: `app_admin_guard()` (membership in the
   `admins` table **is** admin) + `app_admin_log()` audit in every mutation;
   settlement (`app_admin_confirm_deposit` / `reject_deposit` /
   `pay_withdrawal` / `fail_withdrawal`), reserve
   (`app_admin_topup_reserve` / `app_admin_draw_reserve` — draws below 100%
   coverage are refused), products, settings whitelist, wallet corrections,
   bans, grants by **username**.
   Bootstrap the first operators: put their usernames in the array in the
   `do $$` block at the bottom and re-run (idempotent; skipped once any admin
   exists).

### Auth model

Members register with **name, username, phone, password (+ optional referral
code)**. Supabase Auth is email-keyed, so the DB maps `username →
username@auth_email_domain` via `app_auth_email()` — the domain is a
deploy-time `platform_settings` seed (`auth_email_domain`). **Changing it
after users exist breaks their logins**; it is deliberately not editable in
the admin desk. Login is username + password (`/api/auth/login`, cookie
sessions via `@supabase/ssr`, bearer JWT also accepted).

## API routes

Uniform envelope `{ data } | { error: { code, message } }`.

| Route | RPC | Auth |
|-------|-----|------|
| `GET /api/health` · `GET /api/info` | `app_public_info` (probe) | public |
| `POST /api/auth/register` · `/login` · `/logout` | Supabase Auth | public |
| `GET /api/auth/callback` | PKCE code exchange | public |
| `GET /api/me` · `GET /api/dashboard` | `app_profile` / `app_dashboard` | member |
| `GET /api/team` | `app_team` | member |
| `POST /api/vaults/open` · `/exit` | `app_open_vault` / `app_exit_vault` | member |
| `POST /api/deposits` · `/withdrawals` | `app_open_deposit` / `app_open_withdrawal` | member |
| `POST /api/settle` | `app_settle_matured` | `Bearer $CRON_SECRET` (service-role) |
| `/api/admin/*` (self, dashboard, queue, settle, reserve, members, products, settings, admins, audit) | `app_admin_*` | admin (guard in SQL) |

Scheduling: point a Vercel Cron (or any timer) at
`POST /api/settle` with `Authorization: Bearer $CRON_SECRET` — daily near
the `settlement_hour` setting. The service-role key is used **only** there.

## Screens

- `/` — branded welcome (live coverage + fee + catalogue via anon RPC)
- `/register` · `/login` — username-based auth
- `/app` — member desk: Vaults (catalogue, open with preview, cycles, early
  exit) · Money (deposit/withdraw queues) · History (own ledger) · Refer
- `/admin` — ops desk: Overview (coverage first) · **Queues** (settlement
  workbench) · **Reserve** (top-up/draw with headroom guard) · Members ·
  Vaults (products) · Settings (money rules, whitelisted keys) · Admins ·
  Audit

## Money-rule sync rule

Every default exists in **three places that must match**:
`platform_settings` seeds (`schema.sql`) = `app_setting_*` fallbacks
(`rpc.sql`) = `appRulesFallback` (`src/lib/supabase/config.ts`). Change the
seed, re-run the SQL, update the fallback.

## Develop

```bash
npm install
cp .env.example .env.local   # fill in your Supabase keys
npm run dev                  # http://localhost:3000
npm run build ; npm run lint
```

## Before going live

- Swap `auth_email_domain` to a domain you own **before** the first signup.
- Point the merchant line in the deposit copy at a real receivable account.
- Configure SMTP in Supabase if you keep email confirmation on.
- Rates: keep total-over-term honest; the reserve gate means growth is
  bounded by real funded capital — that is the intended trade-off.
