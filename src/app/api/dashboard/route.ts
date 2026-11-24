import { connection } from "next/server";
import { callRpc, resolveMember } from "@/lib/api/respond";
import type { DashboardPayload } from "@/lib/api/types";

/**
 * GET /api/dashboard — the whole member desk in one round-trip:
 * profile, rules, vault catalogue, my cycles,
 * my deposit/withdrawal queues, my ledger (app_dashboard).
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;
  return callRpc<DashboardPayload>(client, "app_dashboard");
}
