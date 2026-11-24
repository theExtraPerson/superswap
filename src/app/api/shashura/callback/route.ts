import { fail, ok } from "@/lib/api/respond";
import { createAdminClient } from "@/lib/supabase/admin";
import { shashuraWebhookConfigured, verifyWebhookSignature } from "@/lib/shashura/client";

/**
 * POST /api/shashura/callback — Shashura's transaction.finalized webhook
 * (set the URL under Settings → Apps). There is no session here, so the
 * signature IS the authentication: HMAC-SHA256 of the RAW body keyed with
 * the app's webhook secret, compared before the payload is even parsed.
 *
 * The payload then runs through app_hook_shashura (service-role):
 *   COLLECTION success  -> deposit CREDITS ITSELF (wallet at the amount
 *                          received) through the same core as the admin Confirm;
 *                          only an amount mismatch is held back for review.
 *   DISBURSEMENT success-> withdrawal settled automatically (the "api"
 *                          option the admin chose on the desk).
 *   FAILED              -> collection: member/admin can resend; payout:
 *                          member refunded.
 * Anything recognized answers 200 so Shashura stops retrying; forgeries and
 * unconfigured secrets answer 401/503.
 */
export async function POST(req: Request) {
  if (!shashuraWebhookConfigured()) {
    return fail(503, "GATEWAY_NOT_CONFIGURED", "Shashura webhook secret is not configured.");
  }
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-shashura-signature"))) {
    return fail(401, "NOT_AUTHENTICATED", "Bad webhook signature.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(422, "INVALID_REQUEST", "Webhook body is not JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail(422, "INVALID_REQUEST", "Webhook body is not a JSON object.");
  }

  const sb = createAdminClient();
  const { data, error } = await sb.rpc("app_hook_shashura", { p_payload: payload });
  if (error) {
    // Log, but still acknowledge: a rejected/unmatched event is recorded in
    // the audit trail by the RPC itself; retrying cannot fix a raise.
    console.error(`[shashura-webhook] ${error.message}`);
    return fail(500, "INTERNAL", "Webhook could not be processed.");
  }
  return ok(data ?? { received: true });
}
