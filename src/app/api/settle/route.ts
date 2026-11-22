import { fail, ok, bearerToken, secretsMatch } from "@/lib/api/respond";
import { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/settle — the settlement cron (Vercel Cron, daily after the
 * settlement hour). Credits every matured vault payout exactly once
 * (app_settle_matured, idempotent per cycle) and returns the summary.
 * Guarded by CRON_SECRET as a bearer token; the service-role key is the ONLY
 * privileged credential this app uses, and only here.
 */
export async function POST(req: Request) {
  if (!CRON_SECRET) return fail(503, "INTERNAL", "Settlement cron is not configured (CRON_SECRET missing).");
  if (!SUPABASE_SERVICE_ROLE_KEY) return fail(503, "INTERNAL", "Settlement cron is not configured (service key missing).");
  const token = bearerToken(req);
  if (!token) return fail(401, "NOT_AUTHENTICATED", "Provide Authorization: Bearer <CRON_SECRET>.");
  if (!secretsMatch(token, CRON_SECRET)) return fail(401, "NOT_AUTHENTICATED", "Bad cron secret.");

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("app_settle_matured");
  if (error) return fail(500, "INTERNAL", "Settlement run failed.");
  return ok(data);
}
