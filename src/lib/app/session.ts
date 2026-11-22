// Browser session plumbing: the same @supabase/ssr client the auth pages use
// also supplies the bearer token for /api calls (cookie session is the
// server-side fallback — either path resolves auth.uid() in the RPCs).

import { createClient } from "@/lib/supabase/clients";
import type { ApiConfig } from "@/lib/api/client";

export function browserApiConfig(): ApiConfig {
  return {
    getAccessToken: async () => {
      const { data } = await createClient().auth.getSession();
      return data.session?.access_token ?? null;
    },
  };
}

/** Sign out of both the stored session and the cookie session. */
export async function signOutBrowser() {
  const sb = createClient();
  await sb.auth.signOut();
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
}
