import { connection } from "next/server";
import { callRpc, resolveMember } from "@/lib/api/respond";
import type { CheckinResult } from "@/lib/api/types";

/**
 * POST /api/checkin — claim today's daily check-in reward (app_checkin).
 * Replay-safe inside Postgres via the (user_id, day) primary key on
 * checkin_log, so retries and refreshes can never double-credit. The reward
 * amount is the platform_settings.checkin_bonus authority, a plain wallet
 * credit like the welcome bonus; pause/daily-lock apply.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;
  return callRpc<CheckinResult>(client, "app_checkin");
}
