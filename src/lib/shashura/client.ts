import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shashura Gateway API client (https://shashura.com/developers) — server only.
 * Mobile Money collections (requestToPay), payouts (disburse) and status
 * enquiry (GET /enquiry/{ref-or-tid}). Credentials are environment-only, never
 * stored in the DB; the webhook secret signs the transaction.finalized
 * callbacks that Shashura POSTs to /api/shashura/callback.
 *
 * Money rule for this app: collections NEVER credit a wallet by themselves —
 * the admin still approves every deposit (app_admin_confirm_deposit). Only
 * payouts may settle automatically, driven by the gateway result.
 */

const env = process.env;

const BASE_URL = (env.SHASHURA_BASE_URL ?? "https://shashura.com/api/v1").replace(/\/+$/, "");
const CLIENT_ID = env.SHASHURA_CLIENT_ID ?? "";
const CLIENT_SECRET = env.SHASHURA_CLIENT_SECRET ?? "";
const WEBHOOK_SECRET = env.SHASHURA_WEBHOOK_SECRET ?? "";

/** sandbox | production — picked by the X-Target-Environment header. */
export const SHASHURA_ENV: "sandbox" | "production" =
  env.SHASHURA_TARGET_ENV === "production" ? "production" : "sandbox";

export function shashuraConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function shashuraWebhookConfigured(): boolean {
  return Boolean(WEBHOOK_SECRET);
}

/** Gateway fault with Shashura's own code (INVALID_INPUT, DUPLICATE_REFERENCE, …). */
export class ShashuraError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message || code);
    this.name = "ShashuraError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Ugandan mobile money msisdn in Shashura's international form (2567XXXXXXX).
 * Accepts 07XXXXXXXX, +2567XXXXXXXX and 2567XXXXXXXX; anything else is null
 * (bank rows and junk entries simply never get a gateway button).
 */
export function normalizeMsisdn(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `256${digits.slice(1)}`;
  if (/^256[17]\d{8}$/.test(digits)) return digits;
  return null;
}

// ---------------------------------------------------------------------------
// Auth — short-lived Bearer token. Shashura hands back the SAME token when it
// has not expired, so re-requesting is cheap; we still cache per server
// instance to skip the extra round trip.
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(force = false): Promise<string> {
  if (!shashuraConfigured()) {
    throw new ShashuraError("GATEWAY_NOT_CONFIGURED", "Shashura API credentials are not configured.", 503);
  }
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${BASE_URL}/auth`, {
    method: "POST",
    headers: headersFor({ json: true, token: false }),
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const body = await readJsonBody(res);
  const token = (body.data as Record<string, unknown> | undefined)?.access_token;
  const expiresIn = Number((body.data as Record<string, unknown> | undefined)?.expires_in ?? 3600);
  if (!res.ok || typeof token !== "string" || !token) {
    throw new ShashuraError(
      String(body.code ?? body.status ?? `HTTP_${res.status}`),
      messageOf(body) ?? "Shashura authentication failed.",
      res.status
    );
  }
  cachedToken = { token, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 };
  return token;
}

function headersFor(opts: { json?: boolean; token?: string | false } = {}): Record<string, string> {
  const h: Record<string, string> = {
    "X-CLIENT-ID": CLIENT_ID,
    "X-Target-Environment": SHASHURA_ENV,
    "X-COUNTRY": "UG",
  };
  if (opts.json) h["Content-Type"] = "application/json";
  if (opts.token) h["Authorization"] = `Bearer ${opts.token}`;
  return h;
}

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function messageOf(body: Record<string, unknown>): string | null {
  const data = body.data as Record<string, unknown> | undefined;
  const fromData = typeof data?.message === "string" ? data.message : null;
  return fromData ?? (typeof body.message === "string" ? body.message : null);
}

/** One call with automatic re-auth on an expired token (docs say 401 → re-/auth). */
async function call(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let token = await getToken();
  let res = await send(method, path, token, body);
  if (res.status === 401) {
    token = await getToken(true);
    res = await send(method, path, token, body);
  }
  const parsed = await readJsonBody(res);
  if (!res.ok || parsed.status === "error") {
    throw new ShashuraError(
      String(parsed.code ?? `HTTP_${res.status}`),
      messageOf(parsed) ?? `Shashura ${path} failed.`,
      res.status
    );
  }
  return parsed;
}

async function send(
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: headersFor({ json: body !== undefined, token }),
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export interface ShashuraPush {
  tid: string;
  message: string | null;
}

/**
 * POST /requestToPay — pushes the USSD PIN prompt to the payer's phone.
 * 202 only means "prompt sent"; the money is final when the webhook (or an
 * enquiry) reports state TS. reference must be unique per app — the caller
 * builds DEP-<id>-<ts> style refs and an admin approval still follows.
 */
export async function requestToPay(input: {
  msisdn: string;
  amount: number;
  reference: string;
}): Promise<ShashuraPush> {
  const body = await call("POST", "/requestToPay", input);
  return pushOf(body);
}

export interface ShashuraDisbursement extends ShashuraPush {
  /** "TS" = settled instantly (Airtel); "PENDING" = awaiting the callback (MTN). */
  status: string;
  charge: number | null;
}

/**
 * POST /disburse — payout to a mobile wallet, protected by an atomic lien on
 * the merchant balance. A re-used reference returns 409 DUPLICATE_REFERENCE,
 * which is exactly the replay guard this app relies on (ref WD-<id>).
 */
export async function disburse(input: {
  msisdn: string;
  amount: number;
  reference: string;
  remarks?: string;
}): Promise<ShashuraDisbursement> {
  const body = await call("POST", "/disburse", input);
  const push = pushOf(body);
  const data = (body.data ?? {}) as Record<string, unknown>;
  return { ...push, status: String(data.status ?? "PENDING"), charge: numOrNull(data.charge) };
}

export type ShashuraState = "PENDING" | "TS" | "TF";

export interface ShashuraEnquiry {
  tid: string | null;
  externalRef: string | null;
  amount: number | null;
  state: ShashuraState;
  networkRef: string | null;
  failure: { code: string; message: string } | null;
}

/** GET /enquiry/{identifier} — identifier is our reference or their tid. */
export async function enquiry(identifier: string): Promise<ShashuraEnquiry> {
  const body = await call("GET", `/enquiry/${encodeURIComponent(identifier)}`);
  const data = (body.data ?? {}) as Record<string, unknown>;
  const rawState = String(data.state ?? "PENDING");
  const state: ShashuraState =
    rawState === "TS" || rawState === "TF" ? (rawState as ShashuraState) : "PENDING";
  const failure = data.failure as Record<string, unknown> | undefined;
  return {
    tid: typeof data.tid === "string" ? data.tid : null,
    externalRef: typeof data.external_ref === "string" ? data.external_ref : null,
    amount: numOrNull(data.amount),
    state,
    networkRef: typeof data.network_ref === "string" ? data.network_ref : null,
    failure: failure
      ? { code: String(failure.code ?? "UNKNOWN"), message: String(failure.message ?? "") }
      : null,
  };
}

function pushOf(body: Record<string, unknown>): ShashuraPush {
  const data = (body.data ?? {}) as Record<string, unknown>;
  return {
    tid: typeof data.tid === "string" ? data.tid : "",
    message: typeof data.message === "string" ? data.message : null,
  };
}

function numOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Webhook signature — X-Shashura-Signature is HMAC-SHA256(rawBody, secret).
// Verify over the RAW body before parsing; never trust an unsigned payload.
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!shashuraWebhookConfigured() || !signature) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
