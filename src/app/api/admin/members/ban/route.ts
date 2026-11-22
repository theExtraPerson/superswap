import { connection } from "next/server";
import { callRpc, fail, readJson, resolveAdmin, uuidValue } from "@/lib/api/respond";

/**
 * POST /api/admin/members/ban — { userId, banned, reason }
 * Never self; reason required; audited in SQL (app_admin_set_ban).
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const userId = uuidValue(body.userId);
  const banned = body.banned === true;
  const reason = String(body.reason ?? "").trim();
  if (!userId) return fail(422, "INVALID_REQUEST", "userId is required.");
  if (reason.length < 3) return fail(422, "INVALID_REQUEST", "A written reason is required.");

  return callRpc(client, "app_admin_set_ban", { p_user_id: userId, p_banned: banned, p_reason: reason });
}
