import { connection } from "next/server";
import { callRpc, fail, readJson, resolveAdmin } from "@/lib/api/respond";

/**
 * POST /api/admin/settings — { key, value }
 * Whitelist + typed validation live in app_admin_set_setting (mirrored by
 * app_admin_setting_spec, which the desk renders from). Audited in SQL.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const key = String(body.key ?? "").trim();
  const value = String(body.value ?? "");
  if (!key || key.length > 60) return fail(422, "INVALID_REQUEST", "key is required.");

  return callRpc(client, "app_admin_set_setting", { p_key: key, p_value: value });
}
