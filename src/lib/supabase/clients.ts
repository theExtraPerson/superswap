import { createBrowserClient } from "@supabase/ssr";

/** Browser client — cookie-backed session so API routes can reuse the login. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
