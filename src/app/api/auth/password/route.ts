import { connection } from "next/server";
import { fail, logAuthFailure, ok, readJson, resolveMember } from "@/lib/api/respond";

/**
 * POST /api/auth/password — { password }
 * Change the signed-in member's password through GoTrue using their own
 * session (cookie or bearer — resolveMember enforces one). No money rules are
 * involved, so no RPC is needed; the min length mirrors /api/auth/register so
 * a member cannot lock themselves out of future logins with a weaker secret.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const password = String(body.password ?? "");
  if (password.length < 8 || password.length > 72)
    return fail(422, "INVALID_REQUEST", "Password must be at least 8 characters.");

  const { client, error } = await resolveMember(req);
  if (error) return error;

  const { error: updateErr } = await client.auth.updateUser({ password });
  if (updateErr) {
    logAuthFailure("updatePassword", updateErr);
    const msg = updateErr.message.toLowerCase();
    if (msg.includes("password"))
      return fail(422, "INVALID_REQUEST", "That password was rejected. Use at least 8 characters.");
    if (updateErr.status === 401)
      return fail(401, "NOT_AUTHENTICATED", "Your session expired. Sign in again and retry.");
    return fail(500, "INTERNAL", "Could not change your password right now. Please try again.");
  }
  return ok({ updated: true });
}
