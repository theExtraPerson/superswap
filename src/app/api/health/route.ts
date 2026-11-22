import { connection } from "next/server";
import { anonClient, ok, fail } from "@/lib/api/respond";

/**
 * GET /api/health — liveness + DB reachability probe (public).
 */
export async function GET() {
  await connection(); // per-request under cacheComponents; never prerendered
  const { data, error } = await anonClient().rpc("app_coverage");
  if (error) return fail(500, "INTERNAL", "Database unreachable.");
  return ok({ ok: true, coverage_pct: data });
}
