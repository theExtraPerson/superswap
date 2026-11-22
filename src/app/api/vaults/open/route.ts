import { connection } from "next/server";
import { callRpc, fail, idemValue, positiveInt, positiveNumber, readJson, resolveMember } from "@/lib/api/respond";
import type { CycleRow } from "@/lib/api/types";

/**
 * POST /api/vaults/open — { productId, principal, idemKey? }
 * All checks live in app_open_vault: running/window gates, product range,
 * wallet funds — and THE GATE: the promised yield must be covered by the
 * reserve before the vault can exist (INSUFFICIENT_RESERVE otherwise).
 */
export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveMember(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const productId = positiveInt(body.productId);
  const principal = positiveNumber(body.principal);
  if (!productId) return fail(422, "INVALID_REQUEST", "productId is required.");
  if (!principal) return fail(422, "INVALID_AMOUNT", "Enter a valid principal.");

  return callRpc<CycleRow>(client, "app_open_vault", {
    p_product_id: productId,
    p_principal: principal,
    p_idem_key: body.idemKey ? idemValue(body.idemKey) : null,
  });
}
