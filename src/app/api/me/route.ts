import { connection } from "next/server";
import { fail, ok, resolveMember } from "@/lib/api/respond";
import { mapRpcError } from "@/lib/api/errors";
import type { ProfileRow } from "@/lib/api/types";

/**
 * GET /api/me — the caller's own profile (also the "am I signed in?" probe).
 * app_profile() raises ACCOUNT_RESTRICTED for banned members: answered as
 * 200 + restricted flag so the desk can show "account restricted" cleanly.
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;

  const { data, error: rpcErr } = await client.rpc("app_profile");
  if (rpcErr) {
    const f = mapRpcError(rpcErr.message);
    if (f.code === "ACCOUNT_RESTRICTED")
      return ok<{ profile: ProfileRow | null; restricted: boolean }>({ profile: null, restricted: true });
    return fail(f.status, f.code, f.message);
  }
  return ok({ profile: data as ProfileRow, restricted: false });
}
