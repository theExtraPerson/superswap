import { connection } from "next/server";
import { fail, ok, bearerToken, secretsMatch } from "@/lib/api/respond";
import { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /api/settle — the daily vault settlement run (and the on-demand button).
 *
 * Both verbs run the exact same body:
 *   GET  — how Vercel Cron calls it (vercel.json → crons → path). When the
 *          project has a CRON_SECRET env var, Vercel auto-attaches
 *          `Authorization: Bearer <CRON_SECRET>` to every cron request, so the
 *          bearer guard below authorizes it with no extra config.
 *   POST — the manual/operator trigger (same bearer guard).
 *
 * app_settle_matured() is idempotent per cycle, so a double fire (or a retry
 * after a partial run) can never pay a member twice. The service-role key is
 * the ONLY privileged credential this app uses, and only here.
 */
async function runSettlement(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  if (!CRON_SECRET) return fail(503, "INTERNAL", "Settlement cron is not configured (CRON_SECRET missing).");
  if (!SUPABASE_SERVICE_ROLE_KEY) return fail(503, "INTERNAL", "Settlement cron is not configured (service key missing).");
  const token = bearerToken(req);
  if (!token) return fail(401, "NOT_AUTHENTICATED", "Provide Authorization: Bearer <CRON_SECRET>.");
  if (!secretsMatch(token, CRON_SECRET)) return fail(401, "NOT_AUTHENTICATED", "Bad cron secret.");

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("app_settle_matured");
  if (error) {
    // A silent 500 is how the missed-settlement hid for a day. Log the raw
    // Postgres text (never returned to the caller) so the cause is recoverable.
    console.error(`[settle] app_settle_matured ${error.code ?? "?"} :: ${error.message}`);
    return fail(500, "INTERNAL", "Settlement run failed.");
  }
  console.log(`[settle] ${JSON.stringify(data)}`);
  return ok(data);
}

export async function GET(req: Request) {
  return runSettlement(req);
}

export async function POST(req: Request) {
  return runSettlement(req);
}
