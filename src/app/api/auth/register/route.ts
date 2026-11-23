import { connection } from "next/server";
import { anonClient, claimSignupBonus, fail, logAuthFailure, ok, readJson } from "@/lib/api/respond";
import { mapRpcError } from "@/lib/api/errors";
import { createRequestClient } from "@/lib/supabase/server";
import { PHONE_RE, SITE_URL, USERNAME_RE } from "@/lib/supabase/config";
import type { AuthResult } from "@/lib/api/types";

/**
 * POST /api/auth/register — { fullName, username, phone, password, referralCode? }
 * Usernames are the login handle; Supabase needs an email, so the DB-owned
 * app_auth_email() maps `username` -> `username@auth_email_domain` (synthetic,
 * never displayed). The auth.users insert trigger creates the profile and
 * validates name/phone/referral atomically — this route only pre-checks for
 * friendly errors and carries the cookie session on success. When sign-up
 * returns a session (email confirmation off), the welcome bonus is claimed in
 * the same round-trip; otherwise it waits for the first sign-in.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const fullName = String(body.fullName ?? "").trim();
  const username = String(body.username ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const password = String(body.password ?? "");
  const referralCode = String(body.referralCode ?? "").trim().toUpperCase();

  if (fullName.length < 2 || fullName.length > 60)
    return fail(422, "INVALID_NAME", "Please provide your real name (2-60 characters).");
  if (!USERNAME_RE.test(username))
    return fail(422, "INVALID_USERNAME", "Username must be 3-20 characters: lowercase letters, numbers or underscore.");
  if (!PHONE_RE.test(phone))
    return fail(422, "INVALID_PHONE", "Provide a valid Ugandan mobile number, e.g. 0772123456.");
  if (password.length < 8 || password.length > 72)
    return fail(422, "INVALID_REQUEST", "Password must be at least 8 characters.");
  if (referralCode && !/^[A-Z0-9]{4,10}$/.test(referralCode))
    return fail(422, "BAD_REFERRAL", "That referral code is not valid.");

  const anon = anonClient();

  if (referralCode) {
    const { data: valid } = await anon.rpc("app_referral_valid", { p_code: referralCode });
    if (!valid) return fail(422, "BAD_REFERRAL", "That referral code does not exist.");
  }
  const { data: taken, error: takenErr } = await anon.rpc("app_username_taken", { p_username: username });
  if (takenErr) return failWith(takenErr.message);
  if (taken) return fail(422, "USERNAME_TAKEN", "That username is already taken.");

  const { data: emailData, error: emailErr } = await anon.rpc("app_auth_email", { p_username: username });
  if (emailErr) return failWith(emailErr.message);
  // NULL means auth_email_domain is unset or not a public hostname. Operator
  // misconfiguration — say so rather than letting GoTrue reject the address.
  if (!emailData)
    return fail(503, "AUTH_NOT_CONFIGURED", "Registration is not configured yet. Please try again shortly.");

  // Cookie-backed client: on success @supabase/ssr sets the session cookies,
  // so the browser is signed in without the token ever crossing the JSON body.
  const sb = await createRequestClient(req);
  const { data, error } = await sb.auth.signUp({
    email: String(emailData),
    password,
    options: {
      data: { username, full_name: fullName, phone, referral_code: referralCode || null },
      emailRedirectTo: `${SITE_URL}/api/auth/callback`,
    },
  });

  if (error) {
    logAuthFailure("signUp", error);
    const msg = error.message.toLowerCase();
    // GoTrue-side configuration faults — never the member's fault, so answer 503
    // with the cause named in the log rather than a mystery 500:
    //  "Email address ... is invalid"  -> auth_email_domain is unset/unusable
    //  "Email signups are disabled"    -> Email provider off in the dashboard
    // Tested first because these messages embed the would-be address, and a
    // handle like "username123" must not fall into the taken-username branch.
    if (
      (msg.includes("email address") && msg.includes("invalid")) ||
      msg.includes("are disabled") ||
      msg.includes("is disabled")
    )
      return fail(503, "AUTH_NOT_CONFIGURED", "Registration is not configured yet. Please try again shortly.");
    if (msg.includes("already registered") || msg.includes("username"))
      return fail(422, "USERNAME_TAKEN", "That username is already taken.");
    if (msg.includes("password"))
      return fail(422, "INVALID_REQUEST", "That password was rejected. Use at least 8 characters.");
    // A raise inside app_handle_new_user() (or a profile constraint) reaches us
    // as an opaque 500 from GoTrue; it is always an input problem, so answer 422.
    if (msg.includes("database error saving new user") || msg.includes("constraint") || msg.includes("trigger"))
      return fail(
        422,
        "SIGNUP_REJECTED",
        "We could not create that account — please re-check your name, username and phone number, then try again."
      );
    if (msg.includes("not allowed"))
      return fail(503, "PLATFORM_PAUSED", "Registration is temporarily closed. Please check back soon.");
    if (msg.includes("too many") || msg.includes("rate limit"))
      return fail(429, "INVALID_REQUEST", "Too many attempts. Wait a minute and try again.");
    return fail(500, "INTERNAL", "Could not create your account right now. Please try again.");
  }

  const result: AuthResult = {
    signed_in: Boolean(data.session),
    needs_confirmation: !data.session,
    profile: null,
    signup_bonus: data.session ? await claimSignupBonus(sb) : null,
  };
  return ok(result, { status: 201 });
}

function failWith(raw: string) {
  const f = mapRpcError(raw);
  return fail(f.status, f.code, f.message);
}
