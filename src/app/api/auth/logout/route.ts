import { connection } from "next/server";
import { ok } from "@/lib/api/respond";
import { createRequestClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/logout — clears the cookie session (the browser client
 * clears its own localStorage copy separately).
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const sb = await createRequestClient(req);
  await sb.auth.signOut();
  return ok({ done: true });
}
