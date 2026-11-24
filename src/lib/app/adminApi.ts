// Typed admin-desk client — mirrors the /api/admin/* routes, which are thin
// pass-throughs onto app_admin_* RPCs (guard + audit live in Postgres).

import { apiRequest, post, type ApiConfig } from "@/lib/api/client";
import type {
  AdminAuditRow,
  AdminDashboardPayload,
  AdminGrantResult,
  AdminMemberPayload,
  AdminProductRow,
  AdminQueueDepositRow,
  AdminQueueWithdrawalRow,
  AdminSettingSpec,
} from "@/lib/api/types";

export const adminSelf = (cfg: ApiConfig = {}) =>
  apiRequest<{ is_admin: boolean; profile: unknown | null }>("/admin/self", { method: "GET" }, cfg);

export const adminDashboard = (memberQuery?: string, cfg: ApiConfig = {}) =>
  apiRequest<AdminDashboardPayload>(
    `/admin/dashboard${memberQuery ? `?q=${encodeURIComponent(memberQuery)}` : ""}`,
    { method: "GET" },
    cfg
  );

export const adminQueue = (
  kind: "deposits" | "withdrawals",
  cfg: ApiConfig = {}
) =>
  apiRequest<(AdminQueueDepositRow | AdminQueueWithdrawalRow)[]>(
    `/admin/queue?kind=${kind}`,
    { method: "GET" },
    cfg
  );

export const adminSettle = (
  input:
    | { action: "confirm_deposit"; id: number; note?: string }
    | { action: "reject_deposit"; id: number; reason: string }
    | { action: "pay_withdrawal"; id: number; reference?: string }
    | { action: "fail_withdrawal"; id: number; reason: string },
  cfg: ApiConfig = {}
) => apiRequest<Record<string, unknown>>("/admin/settle", post(input), cfg);

/** Shashura gateway actions — collect a deposit, pay via API, or pull the
 * final state by enquiry when the webhook hasn't landed. */
export const adminShashura = (
  input:
    | { action: "collect_deposit"; id: number }
    | { action: "pay_withdrawal"; id: number }
    | { action: "refresh"; kind: "deposits" | "withdrawals"; id: number },
  cfg: ApiConfig = {}
) => apiRequest<Record<string, unknown>>("/admin/shashura", post(input), cfg);

export const adminMember = (userId: string, cfg: ApiConfig = {}) =>
  apiRequest<AdminMemberPayload>(`/admin/members/${userId}`, { method: "GET" }, cfg);

export const adminAdjustWallet = (userId: string, delta: number, reason: string, cfg: ApiConfig = {}) =>
  apiRequest("/admin/members/adjust", post({ userId, delta, reason }), cfg);

export const adminSetBan = (userId: string, banned: boolean, reason: string, cfg: ApiConfig = {}) =>
  apiRequest("/admin/members/ban", post({ userId, banned, reason }), cfg);

export const adminListProducts = (cfg: ApiConfig = {}) =>
  apiRequest<AdminProductRow[]>("/admin/products", { method: "GET" }, cfg);

export const adminUpsertProduct = (product: Partial<AdminProductRow> & { slug: string }, cfg: ApiConfig = {}) =>
  apiRequest<AdminProductRow>("/admin/products", post(product), cfg);

export const adminSettingsSpec = (cfg: ApiConfig = {}) =>
  apiRequest<AdminSettingSpec[]>("/admin/settings/spec", { method: "GET" }, cfg);

export const adminSetSetting = (key: string, value: string, cfg: ApiConfig = {}) =>
  apiRequest("/admin/settings", post({ key, value }), cfg);

export const adminGrant = (username: string, cfg: ApiConfig = {}) =>
  apiRequest<AdminGrantResult>("/admin/admins", post({ username }), cfg);

export const adminRevoke = (userId: string, cfg: ApiConfig = {}) =>
  apiRequest("/admin/admins", post({ action: "revoke", userId }), cfg);

export const adminAudit = (limit = 200, cfg: ApiConfig = {}) =>
  apiRequest<AdminAuditRow[]>(`/admin/audit?limit=${limit}`, { method: "GET" }, cfg);
