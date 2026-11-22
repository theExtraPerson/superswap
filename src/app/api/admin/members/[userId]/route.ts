import { connection } from "next/server";
import { callRpc, fail, resolveAdmin, uuidValue } from "@/lib/api/respond";
import type { AdminMemberPayload } from "@/lib/api/types";

/**
 * GET /api/admin/members/[userId] — full member dossier: profile, referrer,
 * cycles, ledger, deposit/withdrawal history (app_admin_member; guard inside).
 */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const userId = uuidValue((await params).userId);
  if (!userId) return fail(422, "INVALID_REQUEST", "Expected a user id.");

  return callRpc<AdminMemberPayload>(client, "app_admin_member", { p_user_id: userId });
}
