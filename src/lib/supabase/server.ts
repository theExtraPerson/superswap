import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

/**
 * Route-handler client carrying the CALLER's session: prefers the
 * `Authorization: Bearer <jwt>` header (the API contract), falls back to
 * cookies for same-origin server renders. Because the request runs with the
 * member's own token, `auth.uid()` inside the SECURITY DEFINER RPCs resolves
 * correctly — the route never handles user ids itself.
 */
export async function createRequestClient(req: Request) {
  const cookieStore = await cookies();
  const bearer = req.headers.get("authorization");

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: bearer
      ? { headers: { Authorization: bearer, "x-supabase-api-version": "2024-01-01" } }
      : undefined,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // Cookies can only be mutated in Server Actions/Route Handlers on
        // responses that haven't been sent yet; reads are fine everywhere.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /* called from a context where setting cookies is impossible */
        }
      },
    },
  });
}
