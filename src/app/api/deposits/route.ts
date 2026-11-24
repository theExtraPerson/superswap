import { connection } from "next/server";
import { callRpc, fail, idemValue, ok, positiveNumber, readJson, resolveMember } from "@/lib/api/respond";
import type { DepositRow } from "@/lib/api/types";
import { ShashuraError, normalizeMsisdn, requestToPay, shashuraConfigured } from "@/lib/shashura/client";

// Mobile money only (Airtel Money + MTN MoMo). Bank transfers are not a
// supported rail. NOTE: this must be an ARRAY — `new Set("momo")` would build a
// set of characters {'m','o'} and reject every real deposit.
const CHANNELS = new Set(["momo"]);

/**
 * POST /api/deposits — { amount, channel, payerAccount, reference?, idemKey? }
 * Opens a deposit and makes it AUTOMATIC: the same call pushes a Shashura
 * requestToPay PIN prompt to the payer number, and the signed webhook credits
 * the wallet through the shared deposit core (app_hook_shashura). The
 * member never waits on an operator. When the gateway is down/unconfigured the
 * row stays pending for the admin desk fallback. Rules live in app_open_deposit;
 * the collection is only recorded under the member's identity via
 * app_member_shashura_collect after the gateway accepted it.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const amount = positiveNumber(body.amount);
  const channel = String(body.channel ?? "");
  const payerAccount = String(body.payerAccount ?? "").trim();
  if (!amount) return fail(422, "INVALID_AMOUNT", "Enter a valid amount.");
  if (!CHANNELS.has(channel)) return fail(422, "INVALID_CHANNEL", "Mobile money only — Airtel Money or MTN MoMo.");
  if (!payerAccount) return fail(422, "MISSING_ACCOUNT", "Provide the number/account you are sending from.");

  const opened = await callRpc<DepositRow>(client, "app_open_deposit", {
    p_amount: amount,
    p_channel: channel,
    p_payer_account: payerAccount,
    p_reference: String(body.reference ?? "").trim() || null,
    p_idem_key: body.idemKey ? idemValue(body.idemKey) : null,
  });

  // The deposit is real from here on; a collection failure only means it
  // waits on the desk instead of settling itself. Never block or reverse.
  if (opened.status !== 200 || channel !== "momo" || !shashuraConfigured()) return opened;
  try {
    const { data: dep } = (await opened.json()) as { data: DepositRow };
    const msisdn = normalizeMsisdn(payerAccount);
    if (msisdn && dep?.id) {
      const reference = `DEP-${dep.id}-${Date.now()}`;
      const pushed = await requestToPay({ msisdn, amount: Number(dep.amount), reference });
      const { error: recError } = await client.rpc("app_member_shashura_collect", {
        p_deposit_id: dep.id,
        p_gateway_ref: reference,
        p_gateway_tid: pushed.tid || null,
      });
      if (!recError) return ok({ ...dep, collect: { requested: true } });
      console.error(`[deposits] collect record failed for ${dep.id}: ${recError.message}`);
    }
  } catch (e) {
    if (!(e instanceof ShashuraError)) console.error(`[deposits] unexpected collect fault: ${String(e)}`);
    else console.error(`[deposits] gateway refused collect: ${e.code} ${e.message}`);
  }
  return opened;
}
