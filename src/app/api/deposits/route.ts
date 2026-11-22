import { connection } from "next/server";
import { callRpc, fail, idemValue, positiveNumber, readJson, resolveMember } from "@/lib/api/respond";
import type { DepositRow } from "@/lib/api/types";

const CHANNELS = new Set(["momo", "bank"]);

/**
 * POST /api/deposits — { amount, channel, payerAccount, reference?, idemKey? }
 * Opens a PENDING deposit with the member's transfer reference. The ledger
 * only moves when an operator confirms the actual money arrived
 * (app_admin_confirm_deposit) — declared cash enters the reserve at the same
 * instant, so coverage can't drift. Rules live in app_open_deposit.
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
  if (!CHANNELS.has(channel)) return fail(422, "INVALID_CHANNEL", "Choose momo or bank.");
  if (!payerAccount) return fail(422, "MISSING_ACCOUNT", "Provide the number/account you are sending from.");

  return callRpc<DepositRow>(client, "app_open_deposit", {
    p_amount: amount,
    p_channel: channel,
    p_payer_account: payerAccount,
    p_reference: String(body.reference ?? "").trim() || null,
    p_idem_key: body.idemKey ? idemValue(body.idemKey) : null,
  });
}
