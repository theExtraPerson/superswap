import { connection } from "next/server";
import { callRpc, fail, ok, positiveInt, readJson, resolveAdmin } from "@/lib/api/respond";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SHASHURA_ENV,
  ShashuraError,
  disburse,
  enquiry,
  normalizeMsisdn,
  requestToPay,
  shashuraConfigured,
} from "@/lib/shashura/client";

/**
 * POST /api/admin/shashura — the gateway half of the settlement desk.
 * Deposits are automatic (member-opened momo rows fire their own PIN
 * prompt from /api/deposits); this desk tooling covers the human cases:
 *   { action: "collect_deposit", id }    (re)push a MoMo PIN prompt via
 *       /requestToPay for bank-era retries or failed collections. When the
 *       webhook confirms, the deposit credits ITSELF through the shared
 *       core — Confirm stays the override for mismatches, not the gate.
 *   { action: "pay_withdrawal", id }     WITHDRAWALS are the admin's call:
 *       disburse via Shashura. Airtel settles instantly (recorded as paid
 *       through the same core as manual payment); MTN stays 'initiated'
 *       until the callback finalizes it.
 *   { action: "refresh", kind, id }      pull the final state by enquiry —
 *       the fallback when the webhook never arrives (local dev, firewalled).
 *   { action: "reconcile", kind }        the same enquiry sweep over every
 *       pending row that already has a gateway reference, so one click
 *       clears a webhook backlog (or a webhook that is simply not coming).
 *
 * Identity stays with the operator's own session (admin RPCs); the
 * service-role client is used READ-ONLY here to fetch the row the gateway call
 * must be built from — the client's numbers are never trusted. Writes go back
 * through app_admin_shashura_* / app_hook_shashura.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;
  if (!shashuraConfigured()) {
    return fail(503, "GATEWAY_NOT_CONFIGURED", "Shashura payments are not configured on this server.");
  }

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  // The sweep is the only action without a row id.
  if (body.action === "reconcile") {
    try {
      return await reconcile(createAdminClient(), String(body.kind ?? "deposits"));
    } catch (e) {
      return gatewayFail(e);
    }
  }

  const id = positiveInt(body.id);
  if (!id) return fail(422, "INVALID_REQUEST", "id is required.");

  const sb = createAdminClient();

  try {
    switch (body.action) {
      case "collect_deposit":
        return await collectDeposit(sb, client, id);
      case "pay_withdrawal":
        return await payWithdrawal(sb, client, id);
      case "refresh":
        return await refresh(sb, String(body.kind ?? ""), id);
      default:
        return fail(422, "INVALID_REQUEST", "Unknown shashura action.");
    }
  } catch (e) {
    return gatewayFail(e);
  }
}

const sb0 = () => createAdminClient();

type Session = Parameters<typeof callRpc>[0];

async function collectDeposit(sb: ReturnType<typeof createAdminClient>, client: Session, id: number) {
  const { data: dep, error } = await sb
    .from("deposits")
    .select("id, amount, channel, payer_account, status, gateway_state")
    .eq("id", id)
    .maybeSingle();
  if (error || !dep) return fail(404, "NOT_FOUND", "Deposit not found.");
  if (dep.status !== "pending") return fail(422, "INVALID_REQUEST", "Only pending deposits can be collected.");
  if (dep.channel !== "momo") return fail(422, "INVALID_CHANNEL", "Shashura collects mobile money only.");
  if (!["none", "failed"].includes(dep.gateway_state)) {
    return fail(422, "INVALID_REQUEST", "A collection is already in flight for this deposit.");
  }

  const msisdn = normalizeMsisdn(dep.payer_account);
  if (!msisdn) return fail(422, "INVALID_PHONE", "The payer number is not a usable Ugandan mobile number.");

  // Unique per attempt so a retried (previously failed) collection is not
  // shadowed by Shashura's DUPLICATE_REFERENCE guard.
  const reference = `DEP-${dep.id}-${Date.now()}`;
  const pushed = await requestToPay({ msisdn, amount: Number(dep.amount), reference });
  return callRpc(client, "app_admin_shashura_collect", {
    p_deposit_id: dep.id,
    p_gateway_ref: reference,
    p_gateway_tid: pushed.tid || null,
  });
}

async function payWithdrawal(sb: ReturnType<typeof createAdminClient>, client: Session, id: number) {
  const { data: wd, error } = await sb
    .from("withdrawals")
    .select("id, payout_amount, destination_account, status, channel, gateway_state")
    .eq("id", id)
    .maybeSingle();
  if (error || !wd) return fail(404, "NOT_FOUND", "Withdrawal not found.");
  if (wd.status !== "pending") return fail(422, "INVALID_REQUEST", "Only pending withdrawals can be paid.");
  if (wd.channel !== "momo") return fail(422, "INVALID_CHANNEL", "Shashura pays mobile money only.");
  if (!["none", "failed"].includes(wd.gateway_state)) {
    return fail(422, "INVALID_REQUEST", "A gateway payout is already in flight for this withdrawal.");
  }

  const msisdn = normalizeMsisdn(wd.destination_account);
  if (!msisdn) return fail(422, "INVALID_PHONE", "The destination number is not a usable Ugandan mobile number.");

  // WD-<id> is deterministic: replaying the click hits DUPLICATE_REFERENCE at
  // Shashura instead of double-paying, and the RPC's state check stops it here.
  const reference = `WD-${wd.id}`;
  const result = await disburse({
    msisdn,
    amount: Number(wd.payout_amount),
    reference,
    remarks: `SuperSwap payout #${wd.id}`,
  });
  return callRpc(client, "app_admin_shashura_disburse", {
    p_withdrawal_id: wd.id,
    p_gateway_ref: reference,
    p_gateway_tid: result.tid || null,
    // "TS" = already settled (Airtel); anything else waits for the callback.
    p_immediate: result.status === "TS" ? "paid" : "initiated",
  });
}

/** Enquiry fallback: synthesize the finalized event and run it through the
 * same webhook funnel, so there is exactly one settlement code path. */
async function refresh(sb: ReturnType<typeof createAdminClient>, kindRaw: string, id: number) {
  const kind = kindRaw === "deposits" || kindRaw === "withdrawals" ? kindRaw : null;
  if (!kind) {
    return fail(422, "INVALID_REQUEST", "kind must be deposits or withdrawals.");
  }
  const { data: row, error } = await sb
    .from(kind)
    .select("id, gateway_ref, gateway_tid, gateway_state")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return fail(404, "NOT_FOUND", "Record not found.");
  const identifier = row.gateway_ref ?? row.gateway_tid;
  if (!identifier) return fail(422, "INVALID_REQUEST", "This record has no Shashura transaction to check.");

  const q = await enquiry(String(identifier));
  if (q.state === "PENDING") return ok({ state: "PENDING", enquiry: q });
  const applied = await applyFinalized(sb, kind, row, q);
  if (applied.error) return applied.error;
  return ok({ state: q.state, applied: applied.data });
}

/**
 * Backlog clear: one enquiry per pending row that already has a gateway
 * reference, each final result pushed through app_hook_shashura — the same
 * funnel the signed callback uses, so a webhook that is late (or never coming,
 * as when the callback URL is not registered at Shashura) settles identically
 * and still pays L1/L2 referral commission. Bounded and sequential: the gateway
 * is a third party and each row costs one HTTP call. Already-final rows are
 * skipped, so re-running the sweep is cheap.
 */
async function reconcile(sb: ReturnType<typeof createAdminClient>, kindRaw: string) {
  const kind = kindRaw === "deposits" || kindRaw === "withdrawals" ? kindRaw : null;
  if (!kind) {
    return fail(422, "INVALID_REQUEST", "kind must be deposits or withdrawals.");
  }
  const { data: rows, error } = await sb
    .from(kind)
    .select("id, gateway_ref, gateway_tid, gateway_state")
    .eq("status", "pending")
    .not("gateway_ref", "is", null)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) {
    console.error(`[shashura-reconcile] read ${kind}: ${error.message}`);
    return fail(500, "INTERNAL", "Pending queue could not be read.");
  }

  const results: { id: number; state: string; note?: string }[] = [];
  let settled = 0;
  let failed = 0;
  let waiting = 0;

  for (const row of rows ?? []) {
    const identifier = row.gateway_ref ?? row.gateway_tid;
    if (!identifier) continue;
    try {
      const q = await enquiry(String(identifier));
      if (q.state === "PENDING") {
        waiting += 1;
        results.push({ id: row.id, state: "PENDING" });
        continue;
      }
      const applied = await applyFinalized(sb, kind, row, q);
      if (applied.error) {
        results.push({ id: row.id, state: q.state, note: "not applied" });
        continue;
      }
      if (q.state === "TS") settled += 1;
      else failed += 1;
      results.push({ id: row.id, state: q.state });
    } catch (e) {
      // A single bad reference must not abort the sweep.
      const why = e instanceof ShashuraError ? e.code : "TRANSPORT";
      console.error(`[shashura-reconcile] ${kind} #${row.id} ${String(e)}`);
      results.push({ id: row.id, state: "ERROR", note: why });
    }
  }

  return ok({
    checked: results.length,
    settled,
    failed,
    waiting,
    results,
  });
}

/** One enquiry result → one finalized event through the webhook funnel. */
async function applyFinalized(
  sb: ReturnType<typeof createAdminClient>,
  kind: "deposits" | "withdrawals",
  row: { id: number; gateway_ref?: string | null },
  q: Awaited<ReturnType<typeof enquiry>>
): Promise<{ data: unknown; error?: never } | { data?: never; error: Response }> {
  const payload = {
    event: "transaction.finalized",
    environment: SHASHURA_ENV,
    tid: q.tid,
    external_ref: q.externalRef ?? row.gateway_ref,
    type: kind === "deposits" ? "COLLECTION" : "DISBURSEMENT",
    status: q.state === "TS" ? "SUCCESSFUL" : "FAILED",
    amount: q.amount,
    ...(q.state === "TF" && q.failure ? { failure: q.failure } : {}),
  };
  const { data, error } = await sb.rpc("app_hook_shashura", { p_payload: payload });
  if (error) {
    console.error(`[shashura-refresh] ${kind} #${row.id} ${error.message}`);
    return { error: fail(500, "INTERNAL", "Gateway status could not be applied.") };
  }
  return { data };
}

/** Shashura faults become the app envelope; codes match the docs' glossary. */
function gatewayFail(e: unknown) {
  if (e instanceof ShashuraError) {
    console.error(`[shashura] ${e.code} ${e.httpStatus} :: ${e.message}`);
    if (e.code === "DUPLICATE_REFERENCE") {
      return fail(409, "GATEWAY_DUPLICATE", "Shashura already recorded that reference — use Check status instead.");
    }
    if (e.code === "INSUFFICIENT_FUNDS") {
      return fail(422, "GATEWAY_SHORT_FUNDS", "Your Shashura merchant balance cannot cover this payout — top it up first.");
    }
    if (e.code === "UNAUTHORIZED" || e.code === "EXPIRED_TOKEN" || e.code === "INVALID_SECRET" || e.code === "INVALID_APP") {
      return fail(502, "GATEWAY_AUTH", "Shashura rejected our API credentials. Check the server configuration.");
    }
    if (e.code === "IP_NOT_WHITELISTED") {
      return fail(502, "GATEWAY_IP", "This server's IP is not whitelisted in the Shashura app settings.");
    }
    return fail(502, "GATEWAY_ERROR", `Shashura declined the request: ${e.message}`);
  }
  console.error(`[shashura] transport failure :: ${String(e)}`);
  return fail(502, "GATEWAY_UNAVAILABLE", "Could not reach the Shashura gateway. Try again shortly.");
}
