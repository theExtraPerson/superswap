import { connection } from "next/server";
import { callRpc, resolveMember } from "@/lib/api/respond";

/**
 * GET /api/admin/self — { is_admin, profile }. Deliberately does NOT use the
 * guard: the desk UI needs to tell 401 (sign in) apart from 403 (no access)
 * without forged-allowed states. Actual authorization stays in SQL.
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;
  return callRpc<{ is_admin: boolean; profile: unknown | null }>(client, "app_admin_self");
}
