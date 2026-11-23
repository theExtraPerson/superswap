import { connection } from "next/server";
import { callRpc, fail, idemValue, positiveNumber, readJson, resolveMember } from "@/lib/api/respond";
import type { WithdrawalRow } from "@/lib/api/types";

// Mobile money only (Airtel Money + MTN MoMo) — must be an array, not a string.
const CHANNELS = new Set(["momo"]);

/**
 * POST /api/withdrawals — { amount, channel, destinationAccount, idemKey? }
 * Debits the wallet at request time (funds become reserved) and queues the
 * payout for operator settlement. Fee + minimums enforced inside
 * app_open_withdrawal — and the RPC refuses while reserve coverage is short.
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const amount = positiveNumber(body.amount);
  const channel = String(body.channel ?? "");
  const destinationAccount = String(body.destinationAccount ?? "").trim();
  if (!amount) return fail(422, "INVALID_AMOUNT", "Enter a valid amount.");
  if (!CHANNELS.has(channel)) return fail(422, "INVALID_CHANNEL", "Mobile money only — Airtel Money or MTN MoMo.");
  if (!destinationAccount) return fail(422, "MISSING_ACCOUNT", "Provide the number/account to pay out to.");

  return callRpc<WithdrawalRow>(client, "app_open_withdrawal", {
    p_amount: amount,
    p_channel: channel,
    p_destination_account: destinationAccount,
    p_idem_key: body.idemKey ? idemValue(body.idemKey) : null,
  });
}
