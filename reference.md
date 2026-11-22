# Reference — concrete catalogues (worked example: Vanta Fintech)

Vanta is the reference implementation of the [SKILL.md](SKILL.md) blueprint: a
Uganda mobile-money investment-plan app on Next.js + Supabase + the Shashura
gateway. Everything below is a copy-paste-able starting point for a new clone —
swap brand, currency, gateway and the numbers, keep the structure.

## The five plans (price → earnings → maturity)

| slug | product | price (UGX) | daily | days | total earnings | payout at maturity | ROI |
|------|---------|-------------|-------|------|----------------|--------------------|-----|
| core | VINTA Core | 20,000 | 3,000 | 3 | 9,000 | 29,000 | 45% |
| nova | VINTA Nova | 50,000 | 9,000 | 4 | 36,000 | 86,000 | 72% |
| pulse | VINTA Pulse | 150,000 | 20,000 | 5 | 100,000 | 250,000 | 67% |
| max | VINTA max | 200,000 | 30,000 | 6 | 180,000 | 380,000 | 90% |
| gold | VANTAgold | 500,000 | 80,000 | 7 | 560,000 | 1,060,000 | 112% |

`total_return = amount + daily_return*duration_days` is snapshotted onto each
`investments` row at activation, so a later admin edit never rewrites a live cycle.

## Money rules — the published defaults (must match in 3 places)

A rule lives in **three** synced spots: the `platform_settings` row (authority),
the RPC fallback string (used before `admin.sql` runs or if the row is malformed),
and `config.ts` via `NEXT_PUBLIC_*` (UI mirror). Keep them equal.

| key | default | enforced in | mirrored in |
|-----|---------|-------------|-------------|
| `min_deposit` | 10000 | `vanta_start_deposit` | `NEXT_PUBLIC_MIN_DEPOSIT` |
| `min_withdrawal` | 5000 | `vanta_start_withdrawal` | `NEXT_PUBLIC_MIN_WITHDRAWAL` |
| `withdrawal_fee_percent` | 16 | withdrawal open (net = gross − fee) | `NEXT_PUBLIC_WITHDRAWAL_FEE_PERCENT` |
| `withdrawal_opens_at` | "09:00" | `vanta_within_withdrawal_window()` | `NEXT_PUBLIC_WITHDRAWAL_OPENS` |
| `withdrawal_closes_at` | "22:00" | same window | `NEXT_PUBLIC_WITHDRAWAL_CLOSES` |
| `earnings_mature_at` | "22:00" | `vanta_maturity_at()` | `NEXT_PUBLIC_EARNINGS_MATURE_AT` |
| `registration_bonus` | 1000 | `handle_new_user` | — (server only) |
| `referral_rate_l1` | 0.17 | `vanta_create_investment` | — |
| `referral_rate_l2` | 0.01 | `vanta_create_investment` | — |
| `platform_frozen` | false | every client money RPC | — |
| `freeze_message` | "…paused for maintenance." | UI banner | — |
| `telegram_community/support/handle` | t.me/… | `vanta_links()` | brand.ts fallback |
| `timezone` | Africa/Kampala | clock helpers | `NEXT_PUBLIC_PLATFORM_TZ` |

Deposits table keeps a lower `amount >= 2000` CHECK; withdrawals `>= 5000` — the
**setting** is the real gate, the CHECK is a historical floor.

## Env vars

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY                     # server only
NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_PLATFORM_NAME, NEXT_PUBLIC_USERNAME_DOMAIN
NEXT_PUBLIC_PLATFORM_TZ, NEXT_PUBLIC_EARNINGS_MATURE_AT
NEXT_PUBLIC_MIN_DEPOSIT, NEXT_PUBLIC_MIN_WITHDRAWAL
NEXT_PUBLIC_WITHDRAWAL_OPENS, NEXT_PUBLIC_WITHDRAWAL_CLOSES
NEXT_PUBLIC_WITHDRAWAL_FEE_PERCENT
SHASHURA_BASE_URL, SHASHURA_CLIENT_ID, SHASHURA_CLIENT_SECRET,
SHASHURA_ENV, SHASHURA_COUNTRY, SHASHURA_WEBHOOK_SECRET   # all server only
CRON_SECRET                                   # bearer for the payout route
```

## Status vocabularies

- **investments.status**: `active | completed`
- **deposits.status**: `pending | awaiting_pin | credited | failed | rejected | approved`
  (`approved` = legacy manual path kept for history)
- **withdrawals.status**: `pending | processing | paid | failed | rejected | processed`
- **transactions.status**: `pending | completed | rejected`
- **transactions.type**: `deposit | investment | earning | referral | withdrawal | capital_return | registration_bonus | adjustment_credit | adjustment_debit`
- **payment_events**: `type ∈ COLLECTION | DISBURSEMENT`, `status ∈ PENDING | SUCCESSFUL | FAILED`, `unique (tid, type, status)`, `applied boolean`

## RPC inventory (prefix `vanta_`)

**Member entry points (→ `authenticated`)**
- `rules()` → live money rules; `links()` → Telegram targets; `dashboard()` → whole authenticated payload in one call; `is_admin_self()` → show/hide the admin button.
- `start_deposit(amount, msisdn, method)` → books pending row, returns gateway ref.
- `start_withdrawal(amount, msisdn, method)` → rules + eligibility lock, holds gross, queues.
- `create_investment(plan_slug)` → debit, open cycle, pay L1/L2 referral.
- `claim_earnings(investment_id)` → pay one matured day (usually the scheduler does this).

**Server-only (→ `service_role`)**
- `run_daily_payouts(limit)` → pay every matured day of every active cycle (idempotent, inner loop catches up).
- `set_deposit_gateway(...)`, `set_withdrawal_gateway(...)` → record the `/requestToPay` and `/disburse` answers.
- `handle_gateway_event(jsonb)` → signed `transaction.finalized` callback.
- `approve_deposit(id)` → manual/bank confirmation.

**Internal helpers (revoked from all client roles)**
- `local_now()`, `maturity_at(started_at, index)`, `within_withdrawal_window()`,
  `normalize_msisdn(text)`, `setting(key, fallback)` / `setting_text` / `setting_number`,
  `pay_day(investment_id)`, `credit_referral(...)`, `settle_collection` / `fail_collection`,
  `settle_disbursement` / `fail_disbursement`, `assert_not_banned(uid)`, `random_code(len)`.

**Admin (→ `authenticated`, each calls `admin_guard()` then `admin_log()`)**
- `admin_dashboard(member_query)`, `admin_member(user_id)`.
- `admin_approve_deposit / reject_deposit`, `admin_settle_withdrawal / reject_withdrawal / disburse_withdrawal`.
- `admin_adjust_wallet(user_id, delta, reason)`, `admin_set_ban(user_id, bool, reason)`.
- `admin_upsert_plan(...)`, `admin_grant(username)`, `admin_revoke(user_id)`, `admin_set_setting(key, value)`.

## The maturity function (the heart of the daily credit)

```sql
-- day p_index (0-based) of a cycle opened at p_started_at matures at
-- earnings_mature_at on that local calendar day, always strictly after start.
v_due := ((date_trunc('day', p_started_at at time zone 'Africa/Kampala')
           + make_interval(days => p_index)
           + v_at::interval)          -- v_at = setting_text('earnings_mature_at','22:00')
          at time zone 'Africa/Kampala');
if v_due <= p_started_at then v_due := v_due + interval '1 day'; end if;
```

`run_daily_payouts` selects `investments where status='active' and maturity_at(started_at, days_paid) <= now()`, then loops `pay_day` until nothing further is due. `pay_day` credits `daily_return`, appends an `earning` ledger row with note `"<plan> · day N of M"`, advances `days_paid`/`last_paid_at`; on the final day it flips `completed`, returns `amount` as a `capital_return` row. Because it keys off `<= now()`, a run that missed several nights catches up one matured day per pass.

## Error-code → message map (client)

The RPCs raise `'CODE: detail'`. The action layer splits on `:` and looks the
code up:

`NOT_AUTHENTICATED, PROFILE_NOT_FOUND, MIN_DEPOSIT, MIN_WITHDRAWAL, MAX_DEPOSIT,
ODD_AMOUNT, MSISDN_INVALID, WITHDRAWAL_WINDOW, INVESTMENT_REQUIRED, DEPOSIT_PENDING,
INSUFFICIENT_BALANCE, INSUFFICIENT_FUNDS, EARNING_NOT_DUE, INVESTMENT_COMPLETED,
INVESTMENT_NOT_FOUND, PLAN_NOT_FOUND, ACCOUNT_RESTRICTED, FORBIDDEN, PAYOUT_NOT_QUEUED,
PAYOUT_SUBMISSION_IN_PROGRESS`

## Idempotency + safety invariants

- Callback/poll settlement is guarded by `payment_events unique (tid,type,status)`; already-credited rows return 0.
- All wallet mutations `select … for update` the row first.
- A stale prompt that later really arrives is reconciled: `settle_collection` flips the pending (or `rejected`) ledger row to `completed`.
- Withdrawal holds funds at request; refusal releases the hold; disburse refuses if `gateway_state = 'SUBMITTING'` (can't push twice).
- Referral `on conflict (investment_id, user_id, level) do nothing` → no double pay.
- Registration bonus credited only when the profile row is actually created (`found`).
- Admin cannot ban self, cannot remove the last admin, cannot revoke self.

## App shell — quick-action → destination map

| quick action | destination |
|--------------|-------------|
| Deposit | `/dashboard/wallet?tab=deposit` (also a PWA shortcut) |
| Withdraw | `/dashboard/wallet?tab=withdraw` (PWA shortcut) |
| Invite | `/dashboard/referrals` (link `<site>/register?code=<referral_code>`) |
| Chat / Support | floating Telegram → support + community links |
| Download | PWA install tile (`beforeinstallprompt`) / `manifest.ts` |

Tab bar: Home · Plans · Wallet · Team · Account. Whole dashboard is one
`vanta_dashboard()` call; PWA is standalone with maskable icons and finance
category.
