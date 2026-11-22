import { connection } from "next/server";
import { callRpc, fail, resolveAdmin } from "@/lib/api/respond";
import type { AdminQueueDepositRow, AdminQueueWithdrawalRow } from "@/lib/api/types";

/**
 * GET /api/admin/queue?kind=deposits|withdrawals — pending settlement items
 * with the member identity attached (app_admin_queue; guard inside).
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "deposits" && kind !== "withdrawals")
    return fail(422, "INVALID_REQUEST", "kind must be deposits or withdrawals.");

  return callRpc<(AdminQueueDepositRow | AdminQueueWithdrawalRow)[]>(client, "app_admin_queue", {
    p_kind: kind,
  });
}
