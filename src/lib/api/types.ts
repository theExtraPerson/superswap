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
}

export interface TransparencyPayload {
  reserve_balance: number | string;
  obligations: number | string;
  coverage_pct: number | string;
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
  transparency: TransparencyPayload;
  products: ProductRow[];
  cycles: CycleRow[];
  deposits: DepositRow[];
  withdrawals: WithdrawalRow[];
  ledger: LedgerRow[];
}

export interface PublicInfoPayload {
  rules: RulesPayload;
  products: ProductRow[];
  coverage_pct: number | string;
}

export interface TeamPayload {
  referral_code: string;
  reward_amount: number | string;
  members: {
    name: string;
    joined_at: string;
    first_deposit_at: string | null;
  }[];
  referral_credits: number | string;
}

export interface AuthResult {
  signed_in: boolean;
  needs_confirmation: boolean;
  profile?: ProfileRow | null;
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
  reserve_balance: number | string;
  coverage_pct: number | string;
  pending_deposits: number;
  pending_deposits_total: number | string;
  pending_withdrawals: number;
  pending_withdrawals_total: number | string;
  deposits_total: number | string;
  withdrawals_total: number | string;
  fees_total: number | string;
  yield_paid_total: number | string;
  reserve_topped_total: number | string;
  reserve_drawn_total: number | string;
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
}

export interface AdminQueueWithdrawalRow extends WithdrawalRow {
  username: string | null;
  display_name: string | null;
  phone: string | null;
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

export interface AdminReserveResult {
  balance: number | string;
  coverage_pct: number | string;
}
