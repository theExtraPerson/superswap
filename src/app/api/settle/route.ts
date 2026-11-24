import { fail, ok, bearerToken, secretsMatch } from "@/lib/api/respond";
import { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/settle — manual/external settlement run. The daily release of
 * matured payouts now lives inside the database: Supabase pg_cron fires
 * app_settle_matured() every day at 22:05 EAT (see
 * supabase/migrations/2026-11-24-referral-league-and-eat-settlement.sql);
 * Vercel Cron is deprecated. This route stays as the on-demand fallback —
 * it credits every matured vault payout exactly once (idempotent per cycle).
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
