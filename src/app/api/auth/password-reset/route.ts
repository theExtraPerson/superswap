import { connection } from "next/server";
import { anonClient, fail, logAuthFailure, ok, readJson } from "@/lib/api/respond";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHONE_RE, USERNAME_RE } from "@/lib/supabase/config";

/**
 * POST /api/auth/password-reset — { username, phone, password }
 * Self-service reset for members who cannot sign in. There is no mail server
 * (usernames sign in as <name>@<synthetic host>), so identity is proven the
 * way the account was created: username + the phone it registered with,
 * checked together inside app_password_reset_verify (banned accounts fail
 * closed). The new password never enters Postgres — GoTrue is updated with
 * the service-role key. Sessions already open elsewhere stay signed in until
 * their next token refresh; the new secret is what every future login needs.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const username = String(body.username ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const password = String(body.password ?? "");

  if (!USERNAME_RE.test(username) || !PHONE_RE.test(phone))
    return fail(422, "INVALID_REQUEST", "Enter your username and the phone you signed up with.");
  if (password.length < 8 || password.length > 72)
    return fail(422, "INVALID_REQUEST", "Password must be at least 8 characters.");

  const { data: userId, error } = await anonClient().rpc("app_password_reset_verify", {
    p_username: username,
    p_phone: phone,
  });
  if (error) {
    logAuthFailure("app_password_reset_verify", error);
    return fail(500, "INTERNAL", "Password reset is unavailable right now. Please try again.");
  }
  // One generic sentence for every miss — no hint whether the username, the
  // phone or both were wrong (and the RPC returns no row either way).
  if (!userId)
    return fail(401, "NOT_AUTHENTICATED", "Those details do not match an active account.");

  // Same service-role client the settle and gateway routes use; it throws a
  // loud server fault if the key is missing, never a partial reset.
  const admin = createAdminClient();
  const { error: updateErr } = await admin.auth.admin.updateUserById(String(userId), {
    password,
  });
  if (updateErr) {
    logAuthFailure("adminResetPassword", updateErr);
    return fail(500, "INTERNAL", "Could not reset the password right now. Please try again.");
  }
  return ok({ reset: true });
}
