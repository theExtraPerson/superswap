import { connection } from "next/server";
import { anonClient, claimSignupBonus, fail, logAuthFailure, ok, readJson } from "@/lib/api/respond";
import { createRequestClient } from "@/lib/supabase/server";
import { USERNAME_RE } from "@/lib/supabase/config";
import type { AuthResult } from "@/lib/api/types";

/**
 * POST /api/auth/login — { username, password }
 * The DB maps the username to its synthetic email (app_auth_email), then the
 * cookie-backed SSR client signs in and sets session cookies on the response.
 * A successful sign-in also carries the one-time welcome bonus claim (replay
 * safe in SQL — see app_claim_signup_bonus).
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const body = await readJson(req);
  const username = String(body?.username ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!USERNAME_RE.test(username))
    return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");
  if (!password) return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");

  const { data: email, error: emailErr } = await anonClient().rpc("app_auth_email", { p_username: username });
  if (emailErr) {
    // Missing/broken mapping RPC is a server fault, not wrong credentials —
    // answering 401 here would send members chasing a bad password.
    logAuthFailure("app_auth_email", emailErr);
    return fail(500, "INTERNAL", "Sign-in is unavailable right now. Please try again.");
  }
  if (!email)
    // app_auth_email() maps ANY handle, so NULL can only mean the login host is
    // unset or unusable — a configuration fault, never a wrong password.
    return fail(503, "AUTH_NOT_CONFIGURED", "Sign-in is not fully configured yet. Please try again shortly.");

  const sb = await createRequestClient(req);
  const { data, error } = await sb.auth.signInWithPassword({ email: String(email), password });
  if (error) {
    logAuthFailure("signInWithPassword", error);
    const msg = error.message.toLowerCase();
    // "Email logins are disabled" = provider switched off in the dashboard, which
    // would otherwise look like a server fault to every member, forever.
    if (msg.includes("are disabled") || msg.includes("is disabled"))
      return fail(503, "AUTH_NOT_CONFIGURED", "Sign-in is not fully configured yet. Please try again shortly.");
    if (msg.includes("invalid login credentials") || msg.includes("user not found"))
      return fail(401, "NOT_AUTHENTICATED", "Wrong username or password.");
    if (msg.includes("email not confirmed"))
      return fail(403, "NOT_AUTHENTICATED", "Confirm your email first — check your inbox.");
    if (msg.includes("too many") || msg.includes("rate limit"))
      return fail(429, "INVALID_REQUEST", "Too many attempts. Wait a minute and try again.");
    return fail(500, "INTERNAL", "Sign-in failed. Please try again.");
  }

  const result: AuthResult = {
    signed_in: Boolean(data.session),
    needs_confirmation: false,
    profile: null,
    signup_bonus: await claimSignupBonus(sb),
  };
  return ok(result);
}
