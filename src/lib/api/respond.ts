// Route-handler response helpers — every /api route answers through these so
// the envelope ({ data } | { error }) and headers stay uniform.

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";
import { createRequestClient } from "@/lib/supabase/server";
import { mapRpcError } from "./errors";
import type { ApiError, SignupBonusResult } from "./types";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, { ...init, status: init?.status ?? 200 });
}

export function fail(status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return NextResponse.json(body, { status });
}

export function failWith(failure: ReturnType<typeof mapRpcError>) {
  return fail(failure.status, failure.code, failure.message);
}

/** Bearer token of the caller (their Supabase JWT), or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function requireBearer(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return { error: fail(401, "NOT_AUTHENTICATED", "Provide your session token as Authorization: Bearer <jwt>.") };
  }
  return { token };
}

/**
 * Invoke an app_* RPC and unwrap it: throws-shaped errors become the mapped
 * envelope, success becomes { data }. The client already carries the caller's
 * session — the route itself never passes a user id (blueprint rule).
 */
export async function callRpc<T>(
  sb: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>
) {
  const { data, error } = await sb.rpc(fn, args ?? {});
  if (error) {
    // Postgres text is worded for operators and, when it is not a named
    // 'CODE: detail', mapRpcError collapses it to a causeless 500. Keep the raw
    // message in the server log so the real fault is recoverable (same [tag]
    // convention as logAuthFailure); the client still gets the safe envelope.
    const failure = mapRpcError(error.message);
    console.error(`[rpc-fail] ${fn} ${failure.code}/${failure.status} :: ${error.message}`);
    return fail(failure.status, failure.code, failure.message);
  }
  return ok<T>(data as T);
}

/** Anonymous client for public reads (info, health probe, auth plumbing). */
export function anonClient(): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Member client pinned to a caller's bearer JWT (their Supabase session). */
export function memberClient(token: string): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Resolve the caller's session for a member route: prefers the
 * `Authorization: Bearer <jwt>` header (the API contract), falls back to the
 * cookie session for same-origin browser calls. Returns either a client that
 * runs RPCs AS the member (auth.uid() works in the SECURITY DEFINER functions)
 * or a ready-to-return 401.
 */
export async function resolveMember(
  req: Request
): Promise<{ client: SupabaseClient; error?: never } | { client?: never; error: NextResponse }> {
  const token = bearerToken(req);
  if (token) return { client: memberClient(token) };

  const sb = await createRequestClient(req);
  const { data } = await sb.auth.getUser();
  if (!data.user) return { error: fail(401, "NOT_AUTHENTICATED", "Sign in to use this endpoint.") };
  return { client: sb };
}

/** Parse a JSON body defensively; returns null instead of throwing on bad input. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * GoTrue failures are worded for operators, not members, and a raise inside the
 * profile-bootstrap trigger arrives wrapped ("Database error saving new user")
 * with the real reason stripped. Log the raw text under the same [tag] convention
 * as callRpc so the cause is recoverable from the dev/prod log, then let the
 * caller pick a friendly envelope.
 */
export function logAuthFailure(op: string, error: { message: string; status?: number } | null | undefined) {
  console.error(`[auth-fail] ${op} ${error?.status ?? ""} ${error?.message ?? ""}`.trim());
}

/**
 * The welcome bonus rides a successful sign-in: app_claim_signup_bonus() is
 * replay-safe in SQL, so calling it on every login is a cheap no-op after the
 * first credit. It must never fail or delay the auth response, so the result
 * is best-effort (null on any error).
 */
export async function claimSignupBonus(sb: SupabaseClient): Promise<SignupBonusResult | null> {
  try {
    const { data, error } = await sb.rpc("app_claim_signup_bonus");
    if (error || !data) return null;
    return data as unknown as SignupBonusResult;
  } catch {
    return null;
  }
}

/** Positive finite number from unknown input, else null. */
export function positiveNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Positive safe integer from unknown input, else null. */
export function positiveInt(value: unknown): number | null {
  const n = positiveNumber(value);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID from unknown input, else null. */
export function uuidValue(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/** Non-zero finite number (signed) from unknown input, else null. */
export function signedNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) && n !== 0 ? n : null;
}

/** Client idempotency key (safe charset, bounded length), else null. */
export function idemValue(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s && s.length <= 120 && /^[A-Za-z0-9:_.-]+$/.test(s) ? s : null;
}

/**
 * Admin routes stay dumb on purpose: membership-in-table is the authorization
 * model, checked by app_admin_guard() INSIDE every RPC. The route only needs
 * a genuine member session — FORBIDDEN from the guard maps to 403 upstream.
 */
export async function resolveAdmin(req: Request) {
  return resolveMember(req);
}

/** Constant-time-ish compare for the cron bearer (length is not secret). */
export function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
