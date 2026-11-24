import { connection } from "next/server";
import { callRpc, fail, positiveInt, readJson, resolveAdmin } from "@/lib/api/respond";

/**
 * POST /api/admin/settle — one endpoint, four settlement actions; every one
 * is idempotent and audited inside admin.sql, settling against the external
 * Shashura account:
 *   { action: "confirm_deposit", id, note? }
 *   { action: "reject_deposit", id, reason }
 *   { action: "pay_withdrawal", id, reference? }
 *   { action: "fail_withdrawal", id, reason }
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const id = positiveInt(body.id);
  if (!id) return fail(422, "INVALID_REQUEST", "id is required.");
  const reason = String(body.reason ?? "").trim();
  const note = String(body.note ?? "").trim();
  const reference = String(body.reference ?? "").trim();

  switch (body.action) {
    case "confirm_deposit":
      return callRpc(client, "app_admin_confirm_deposit", { p_deposit_id: id, p_note: note || null });
    case "reject_deposit":
      if (!reason) return fail(422, "INVALID_REQUEST", "A rejection reason is required.");
      return callRpc(client, "app_admin_reject_deposit", { p_deposit_id: id, p_reason: reason });
    case "pay_withdrawal":
      return callRpc(client, "app_admin_pay_withdrawal", { p_withdrawal_id: id, p_reference: reference || null });
    case "fail_withdrawal":
      if (!reason) return fail(422, "INVALID_REQUEST", "A failure reason is required.");
      return callRpc(client, "app_admin_fail_withdrawal", { p_withdrawal_id: id, p_reason: reason });
    default:
      return fail(422, "INVALID_REQUEST", "Unknown settle action.");
  }
}
