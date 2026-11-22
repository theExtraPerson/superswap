import { connection } from "next/server";
import { callRpc, resolveAdmin } from "@/lib/api/respond";
import type { AdminAuditRow } from "@/lib/api/types";

/**
 * GET /api/admin/audit?limit= — the append-only operator trail
 * (app_admin_audit; guard inside; capped at 500 rows server-side).
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(500, Math.trunc(raw))) : 200;
  return callRpc<AdminAuditRow[]>(client, "app_admin_audit", { p_limit: limit });
}
