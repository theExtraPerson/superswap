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

// Fetch core (envelope unwrap + one 401 refresh retry). Cookie sessions also
// work: without a token the routes fall back to the ssr cookie session.
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

  const res = await fetch(`${cfg.baseUrl ?? "/api"}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

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
