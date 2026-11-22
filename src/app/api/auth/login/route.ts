import { connection } from "next/server";
import { anonClient, fail, ok, readJson } from "@/lib/api/respond";
import { createRequestClient } from "@/lib/supabase/server";
import { USERNAME_RE } from "@/lib/supabase/config";
import type { AuthResult } from "@/lib/api/types";

/**
 * POST /api/auth/login — { username, password }
 * The DB maps the username to its synthetic email (app_auth_email), then the
 * cookie-backed SSR client signs in and sets session cookies on the response.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const body = await readJson(req);
  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!USERNAME_RE.test(username))
    return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");
  if (!password) return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");

  const { data: email } = await anonClient().rpc("app_auth_email", { p_username: username });
  if (!email) return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");

  const sb = await createRequestClient(req);
  const { data, error } = await sb.auth.signInWithPassword({ email: String(email), password });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid login credentials"))
      return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");
    if (msg.includes("email not confirmed"))
      return fail(403, "NOT_AUTHENTICATED", "Confirm your email first — check your inbox.");
    if (msg.includes("too many"))
      return fail(429, "INVALID_REQUEST", "Too many attempts. Wait a minute and try again.");
    return fail(500, "INTERNAL", "Sign-in failed. Please try again.");
  }

  const result: AuthResult = { signed_in: Boolean(data.session), needs_confirmation: false, profile: null };
  return ok(result);
}
