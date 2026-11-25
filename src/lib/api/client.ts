// Shared browser fetch core for the /api routes.
// Envelope: { data } | { error: { code, message } } (see src/lib/api/types.ts).

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiConfig {
  /** Override for tests/SSR; defaults to same-origin /api. */
  baseUrl?: string;
  /** Provide the caller's Supabase access token (sent as Authorization: Bearer). */
  getAccessToken?: () => Promise<string | null> | string | null;
}

// A phone switching Wi-Fi ↔ data, a laptop waking, or VPN re-routing kills an
// in-flight request with ERR_NETWORK_CHANGED / ERR_INCOMPLETE_CHUNKED_ENCODING.
// fetch() then rejects before any HTTP answer exists, so NOTHING reached the
// server and no money moved — reads may therefore be retried once, safely.
// Mutations never are: the desk shows a retry affordance instead.
const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 60_000; // a gateway round-trip (requestToPay) is not instant
const RETRY_DELAY_MS = 700;
const OFFLINE_TEXT = "The connection dropped before the server answered. Check your network and retry.";

const isRead = (init: RequestInit) => {
  const m = (init.method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOnce(url: string, init: RequestInit, headers: Headers, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "AbortError")), timeoutMs);
  try {
    return await fetch(url, { ...init, headers, credentials: "include", signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sendResilient(
  url: string,
  init: RequestInit,
  headers: Headers,
  reads: boolean
): Promise<Response> {
  try {
    return await sendOnce(url, init, headers, reads ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  } catch {
    if (!reads) throw new ApiError("NETWORK", OFFLINE_TEXT, 503);
    await sleep(RETRY_DELAY_MS);
    try {
      return await sendOnce(url, init, headers, READ_TIMEOUT_MS);
    } catch {
      throw new ApiError("NETWORK", OFFLINE_TEXT, 503);
    }
  }
}

// Fetch core (envelope unwrap + one 401 refresh retry + one retry on network loss).
// Cookie sessions also work: without a token the routes fall back to the ssr
// cookie session.
export async function apiRequest<T>(
  path: string,
  init: RequestInit,
  cfg: ApiConfig,
  retryOn401 = true
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");

  const token = (await cfg.getAccessToken?.()) ?? null;
  if (token) headers.set("authorization", `Bearer ${token}`);

  const url = `${cfg.baseUrl ?? "/api"}${path}`;
  const res = await sendResilient(url, init, headers, isRead(init));

  if (res.status === 401 && token && retryOn401 && cfg.getAccessToken) {
    // One refresh attempt — the provider may now hand back a fresh session.
    return apiRequest<T>(path, init, cfg, false);
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string } }
    | null;

  if (!res.ok || body?.error) {
    throw new ApiError(
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status
    );
  }
  return body!.data as T;
}

export const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
