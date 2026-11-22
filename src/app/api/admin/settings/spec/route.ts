import { connection } from "next/server";
import { callRpc, resolveAdmin } from "@/lib/api/respond";
import type { AdminSettingSpec } from "@/lib/api/types";

/**
 * GET /api/admin/settings/spec — the manageable settings whitelist with
 * kinds/labels/hints, straight from Postgres (app_admin_setting_spec). The
 * desk renders its form from THIS, so UI and DB can never drift.
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;
  return callRpc<AdminSettingSpec[]>(client, "app_admin_setting_spec");
}
