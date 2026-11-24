import { connection } from "next/server";
import { callRpc, resolveAdmin } from "@/lib/api/respond";
import type { AdminDashboardPayload } from "@/lib/api/types";

/**
 * GET /api/admin/dashboard?q= — the whole desk in one round-trip
 * (metrics, member search, roster, settings, audit).
 * Authorization is app_admin_guard() inside the RPC → 403 for non-admins.
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? null;
  return callRpc<AdminDashboardPayload>(client, "app_admin_dashboard", { p_member_query: q });
}
