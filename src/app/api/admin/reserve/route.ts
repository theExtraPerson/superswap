import { connection } from "next/server";
import { callRpc, fail, positiveNumber, readJson, resolveAdmin } from "@/lib/api/respond";
import type { AdminReserveResult } from "@/lib/api/types";

/**
 * POST /api/admin/reserve — { action: "topup" | "draw", amount, reference, note? }
 * Declares operator float in/out against a real bank/momo reference. Draws
 * are refused if they would push coverage below 100% — the operator can only
 * take what is provably NOT promised to members. Audited in SQL.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const amount = positiveNumber(body.amount);
  const reference = String(body.reference ?? "").trim();
  const note = String(body.note ?? "").trim();
  if (!amount) return fail(422, "INVALID_AMOUNT", "amount must be positive.");
  if (!reference) return fail(422, "INVALID_REQUEST", "A bank/momo reference is required.");

  if (body.action === "topup")
    return callRpc<AdminReserveResult>(client, "app_admin_topup_reserve", {
      p_amount: amount,
      p_reference: reference,
      p_note: note || null,
    });
  if (body.action === "draw")
    return callRpc<AdminReserveResult>(client, "app_admin_draw_reserve", {
      p_amount: amount,
      p_reference: reference,
    });
  return fail(422, "INVALID_REQUEST", "action must be topup or draw.");
}
