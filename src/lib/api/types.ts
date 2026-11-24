// Shared payload shapes between /api routes and the frontend client.
// These mirror the rows produced by supabase/schema.sql + rpc.sql + admin.sql
// (the app_* / app_admin_* functions). Postgres numerics may arrive as
// numbers or numeric-strings — format through src/lib/format.ts.

/** Uniform error envelope every route returns on failure. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ---------- member domain ----------

export interface ProfileRow {
  user_id: string;
  display_name: string;
  username: string;
  phone: string;
  referral_code: string;
  referred_by: string | null;
  wallet_balance: number | string;
  kyc_status: "unverified" | "pending" | "verified";
  created_at: string;
  updated_at?: string;
}

export interface RulesPayload {
  min_deposit: number | string;
  min_withdrawal: number | string;
  withdrawal_fee_percent: number | string;
  settlement_hour: string;
  lock_at?: string;
  platform_paused: boolean;
  pause_message?: string;
  support_contact?: string;
  /** Referral commission paid to the direct (L1) referrer, percent. */
  referral_commission_percent?: number | string;
  /** Referral commission paid to the 2nd-generation (L2) referrer, percent. */
  referral_commission_l2_percent?: number | string;
  /** One-time welcome bonus (UGX), credited on the member's first sign-in. */
  signup_bonus?: number | string;
  /** Withdrawal request window, wall clock in `timezone`. */
  withdraw_window_from?: string;
  withdraw_window_to?: string;
  timezone?: string;
  /** Server-side answer (Kampala clock), so the desk cannot trust a device clock. */
  withdrawals_open?: boolean;
}

/** app_claim_signup_bonus() — replay-safe, so a second call reports 0. */
export interface SignupBonusResult {
  credited: number | string;
  status: "credited" | "already_claimed" | "disabled";
  wallet_balance: number | string;
}

/** app_dashboard().checkin — the Home tab's daily check-in state. */
export interface CheckinState {
  bonus: number | string;
  claimed_today: boolean;
  streak: number;
}

/** app_checkin() — replay-safe per platform day; a second call credits 0. */
export interface CheckinResult {
  credited: number | string;
  status: "credited" | "already_claimed" | "disabled";
  day: string;
  streak: number;
  wallet_balance: number | string;
}

export interface ProductRow {
  id?: number;
  slug: string;
  name: string;
  min_principal: number | string;
  max_principal: number | string;
  duration_days: number;
  total_rate_pct: number | string;
  early_exit_percent: number | string;
  terms: string | null;
}

export interface AdminProductRow extends ProductRow {
  id: number;
  visible: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type CycleStatus = "open" | "closed" | "exited" | "void";

export interface CycleRow {
  id: number;
  product_id?: number | null;
  principal: number | string;
  total_rate_pct: number | string;
  promised_yield: number | string;
  payout_total: number | string;
  status: CycleStatus;
  opened_at: string;
  matures_at: string;
  closed_at: string | null;
  product_name: string | null;
}

export type DepositStatus = "pending" | "confirmed" | "rejected";

/** Shashura collection trail on a deposit (approval itself stays manual). */
export type DepositGatewayState = "none" | "requested" | "verified" | "failed";

/** Shashura payout trail on a withdrawal; 'paid'/'failed' mirror status. */
export type WithdrawalGatewayState = "none" | "initiated" | "paid" | "failed";

export interface DepositRow {
  id: number;
  amount: number | string;
  channel: "momo" | "bank";
  status: DepositStatus;
  reference: string | null;
  created_at: string;
  settled_at: string | null;
  note?: string | null;
}

export type WithdrawalStatus = "pending" | "paid" | "failed";

/** POST /api/deposits answer: the row plus, when the gateway accepted the
 * automatic MoMo request, the collect flag the UI turns into a hint. */
export interface OpenDepositResult extends DepositRow {
  collect?: { requested: boolean };
}

export interface WithdrawalRow {
  id: number;
  amount: number | string;
  fee_amount: number | string;
  payout_amount: number | string;
  channel: "momo" | "bank";
  destination_account?: string;
  status: WithdrawalStatus;
  created_at: string;
  processed_at: string | null;
  note?: string | null;
}

export interface LedgerRow {
  id: number;
  amount: number | string;
  kind: string;
  balance_after: number | string;
  note: string | null;
  created_at: string;
}

export interface DashboardPayload {
  profile: ProfileRow;
  is_banned: boolean;
  rules: RulesPayload;
  /** Absent on a live DB that predates the daily-check-in migration. */
  checkin?: CheckinState;
  products: ProductRow[];
  cycles: CycleRow[];
  deposits: DepositRow[];
  withdrawals: WithdrawalRow[];
  ledger: LedgerRow[];
}

export interface PublicInfoPayload {
  rules: RulesPayload;
  products: ProductRow[];
}

export interface TeamPayload {
  referral_code: string;
  /** Percent of each referee deposit that lands in this member's wallet (L1). */
  commission_percent: number | string;
  /** Percent of each deposit the members you brought in earn for YOU (L2). */
  commission_l2_percent?: number | string;
  signup_bonus?: number | string;
  members: {
    name: string;
    joined_at: string;
    first_deposit_at: string | null;
    deposited_total?: number | string;
    commission_earned?: number | string;
  }[];
  /** Count of 2nd-generation members (people your referees referred). */
  l2_members?: number;
  referral_credits: number | string;
  /** Commission earned from 2nd-generation deposits. */
  referral_credits_l2?: number | string;
}

export interface AuthResult {
  signed_in: boolean;
  needs_confirmation: boolean;
  profile?: ProfileRow | null;
  /** Welcome bonus outcome, when the sign-in carried the claim. */
  signup_bonus?: SignupBonusResult | null;
}

// ---------- admin desk payloads (mirror app_admin_* in supabase/admin.sql) ----------

export interface AdminMetrics {
  members: number;
  members_today: number;
  wallets_total: number | string;
  open_cycles: number;
  open_principal: number | string;
  open_promised_yield: number | string;
  obligations: number | string;
  pending_deposits: number;
  pending_deposits_total: number | string;
  pending_withdrawals: number;
  pending_withdrawals_total: number | string;
  deposits_total: number | string;
  withdrawals_total: number | string;
  fees_total: number | string;
  bonus_total: number | string;
  referral_commission_total: number | string;
  yield_paid_total: number | string;
}

export interface AdminMemberRow {
  user_id: string;
  display_name: string;
  username: string;
  phone: string;
  referral_code: string;
  wallet_balance: number | string;
  kyc_status: string;
  is_banned: boolean;
  referred_by: string | null;
  created_at: string;
}

export interface AdminRosterRow {
  user_id: string;
  handle: string;
  created_at: string;
  username: string | null;
  display_name: string | null;
}

export interface AdminAuditRow {
  id: number;
  actor_username: string;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
}

export interface AdminDashboardPayload {
  actor: ProfileRow;
  metrics: AdminMetrics;
  members: AdminMemberRow[];
  admins: AdminRosterRow[];
  pending_handles: { handle: string; created_at: string }[];
  settings: Record<string, string>;
  audit: AdminAuditRow[];
}

export interface AdminMemberPayload {
  profile: AdminMemberRow | null;
  referrer: { username: string; display_name: string } | null;
  cycles: CycleRow[];
  ledger: LedgerRow[];
  deposits: DepositRow[];
  withdrawals: WithdrawalRow[];
}

export interface AdminQueueDepositRow extends DepositRow {
  payer_account: string;
  username: string | null;
  display_name: string | null;
  phone: string | null;
  gateway_ref?: string | null;
  gateway_tid?: string | null;
  gateway_state?: DepositGatewayState;
  gateway_detail?: string | null;
}

export interface AdminQueueWithdrawalRow extends WithdrawalRow {
  username: string | null;
  display_name: string | null;
  phone: string | null;
  gateway_ref?: string | null;
  gateway_tid?: string | null;
  gateway_state?: WithdrawalGatewayState;
  gateway_detail?: string | null;
}

export interface AdminSettingSpec {
  key: string;
  kind: "number" | "bool" | "time" | "text";
  label: string;
  hint: string;
}

export interface AdminGrantResult {
  status: "granted" | "queued";
  handle: string;
}
