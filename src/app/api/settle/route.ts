import { connection } from "next/server";
import { fail, ok, bearerToken, secretsMatch } from "@/lib/api/respond";
import { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /api/settle — the manual/operator settlement trigger (fallback runner).
 *
 * The PRIMARY schedule now lives in the database: a pg_cron job
 * ('vault-daily-credits', see migrations/2026-11-26-daily-vault-credits.sql)
 * calls app_settle_matured() daily at 22:05 EAT without an HTTP hop. This
 * route stays as the on-demand fallback (operator button, curl, or a bridge
 * until pg_cron is confirmed on the project):
 *   GET  — kept for Vercel Cron compatibility (if a cron entry is ever
 *          re-added, Vercel auto-attaches `Authorization: Bearer <CRON_SECRET>`).
 *   POST — the manual/operator trigger (same bearer guard).
 *
 * app_settle_matured() credits one idempotent ledger row per cycle-day
 * ('vault_earn:<cycle>:<day>'), so a double fire (or a retry after a partial
 * run) can never pay a member twice. The service-role key is the ONLY
 * privileged credential this app uses, and only here.
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
