import { connection } from "next/server";
import { callRpc, fail, positiveInt, readJson, resolveMember } from "@/lib/api/respond";
import type { CycleRow } from "@/lib/api/types";

/**
 * POST /api/vaults/exit — { cycleId }
 * Disclosed early exit: principal x early_exit_percent returns, the unearned
 * yield is forfeited. Rules live in app_exit_vault.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;

  const body = await readJson(req);
  const cycleId = positiveInt(body?.cycleId);
  if (!cycleId) return fail(422, "INVALID_REQUEST", "cycleId is required.");

  return callRpc<CycleRow>(client, "app_exit_vault", { p_cycle_id: cycleId });
}
