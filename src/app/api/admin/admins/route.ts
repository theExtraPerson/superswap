import { connection } from "next/server";
import { callRpc, fail, readJson, resolveAdmin, uuidValue } from "@/lib/api/respond";
import type { AdminGrantResult } from "@/lib/api/types";

/**
 * POST /api/admin/admins — one endpoint, two actions (audited in SQL):
 *   { username }                 -> app_admin_grant (queues unknown usernames;
 *                                   the bind trigger attaches them at sign-up)
 *   { action: "revoke", userId } -> app_admin_revoke (never self, never the
 *                                   last admin)
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  if (body.action === "revoke") {
    const userId = uuidValue(body.userId);
    if (!userId) return fail(422, "INVALID_REQUEST", "userId is required.");
    return callRpc(client, "app_admin_revoke", { p_user_id: userId });
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  if (!username) return fail(422, "INVALID_REQUEST", "username is required.");
  return callRpc<AdminGrantResult>(client, "app_admin_grant", { p_username: username });
}
