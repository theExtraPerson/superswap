import { connection } from "next/server";
import { callRpc, resolveMember } from "@/lib/api/respond";
import type { SignupBonusResult } from "@/lib/api/types";

/**
 * POST /api/bonus/welcome — claim the caller's one-time welcome bonus
 * (app_claim_signup_bonus). Idempotent inside Postgres: the first call credits
 * the setting amount, every later call reports already_claimed with no money
 * movement. The auth routes already claim on sign-in; this exists so a session
 * that predates the promo can collect without signing out first.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;
  return callRpc<SignupBonusResult>(client, "app_claim_signup_bonus");
}
