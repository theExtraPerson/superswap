import { NextResponse, type NextRequest } from "next/server";
import { createRequestClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/supabase/config";

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/login", SITE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

/**
 * GET /api/auth/callback — Supabase email-confirmation landing.
 * Exchanges the one-time PKCE `code` for a session (cookies get set by the
 * SSR client), then returns to the sign-in page. Auth-only: no money tables
 * touched.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back(req, { auth: "error", reason: "missing_code" });

  const sb = await createRequestClient(req);
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return back(req, { auth: "error", reason: "invalid_code" });

  return back(req, { auth: "confirmed" });
}
