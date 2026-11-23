import { connection } from "next/server";
import { callRpc, resolveMember } from "@/lib/api/respond";
import type { TeamPayload } from "@/lib/api/types";

/**
 * GET /api/team — own referral code, attributed members and earned rewards
 * (app_team). Two generations: L1 on direct referees' deposits, L2 on their
 * referees' deposits. Attribution only — commissions are never re-commissioned.
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;
  return callRpc<TeamPayload>(client, "app_team");
}
