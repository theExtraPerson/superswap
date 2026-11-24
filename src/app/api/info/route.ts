import { connection } from "next/server";
import { anonClient, callRpc } from "@/lib/api/respond";
import type { PublicInfoPayload } from "@/lib/api/types";

/**
 * GET /api/info — public marketing read: current rules and the vault
 * catalogue. No session required (app_public_info).
 */
export async function GET() {
  await connection(); // per-request under cacheComponents; never prerendered
  return callRpc<PublicInfoPayload>(anonClient(), "app_public_info");
}
