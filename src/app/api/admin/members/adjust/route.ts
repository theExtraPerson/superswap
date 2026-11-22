import { connection } from "next/server";
import { callRpc, fail, readJson, resolveAdmin, signedNumber, uuidValue } from "@/lib/api/respond";

/**
 * POST /api/admin/members/adjust — { userId, delta, reason }
 * Signed wallet correction with a mandatory written reason. Positive deltas
 * must be reserve-covered (app_assert_solvent inside) — even gifts are
 * funded before they are given. Audited in SQL.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const userId = uuidValue(body.userId);
  const delta = signedNumber(body.delta);
  const reason = String(body.reason ?? "").trim();
  if (!userId) return fail(422, "INVALID_REQUEST", "userId is required.");
  if (delta === null) return fail(422, "INVALID_AMOUNT", "delta must be a non-zero number.");
  if (reason.length < 3) return fail(422, "INVALID_REQUEST", "A written reason is required.");

  return callRpc(client, "app_admin_adjust_wallet", {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason,
  });
}
