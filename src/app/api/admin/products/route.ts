import { connection } from "next/server";
import { callRpc, fail, positiveInt, positiveNumber, readJson, resolveAdmin } from "@/lib/api/respond";
import type { AdminProductRow } from "@/lib/api/types";

const SLUG_RE = /^[a-z][a-z0-9_-]{1,30}$/;

/**
 * GET /api/admin/products — the FULL catalogue including retired rows
 * (app_admin_list_products). POST /api/admin/products — create/update a vault
 * product. The 0-100 total-rate bound is validated here for a friendly 422
 * and re-enforced by the table CHECK inside Postgres.
 */
export async function GET(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;
  return callRpc<AdminProductRow[]>(client, "app_admin_list_products");
}

export async function POST(req: Request) {
  await connection(); // per-request under cacheComponents; never prerendered
  const { client, error } = await resolveAdmin(req);
  if (error) return error;

  const body = await readJson(req);
  if (!body) return fail(422, "INVALID_REQUEST", "Send a JSON body.");

  const slug = String(body.slug ?? "").trim();
  const name = String(body.name ?? "").trim();
  const minPrincipal = positiveNumber(body.min_principal);
  const maxPrincipal = positiveNumber(body.max_principal);
  const durationDays = positiveInt(body.duration_days);
  const totalRate = typeof body.total_rate_pct === "string" ? Number(body.total_rate_pct) : (body.total_rate_pct as number);
  const earlyExit = typeof body.early_exit_percent === "string" ? Number(body.early_exit_percent) : (body.early_exit_percent as number ?? 90);

  if (!SLUG_RE.test(slug)) return fail(422, "INVALID_REQUEST", "slug must be lowercase, 2-31 chars [a-z0-9_-].");
  if (name.length < 2 || name.length > 60) return fail(422, "INVALID_REQUEST", "name must be 2-60 characters.");
  if (!minPrincipal || !maxPrincipal || maxPrincipal < minPrincipal)
    return fail(422, "INVALID_REQUEST", "Principal range is invalid.");
  if (!durationDays || durationDays < 7 || durationDays > 730)
    return fail(422, "INVALID_REQUEST", "duration_days must be 7-730.");
  if (!Number.isFinite(totalRate) || totalRate < 0 || totalRate > 100)
    return fail(422, "INVALID_REQUEST", "total_rate_pct must be 0-100 (TOTAL over the term).");
  if (!Number.isFinite(earlyExit) || earlyExit < 0 || earlyExit > 100)
    return fail(422, "INVALID_REQUEST", "early_exit_percent must be 0-100.");

  return callRpc<AdminProductRow>(client, "app_admin_upsert_product", {
    p_json: {
      id: positiveInt(body.id) ?? null,
      slug,
      name,
      min_principal: minPrincipal,
      max_principal: maxPrincipal,
      duration_days: durationDays,
      total_rate_pct: totalRate,
      early_exit_percent: earlyExit,
      terms: String(body.terms ?? "").trim() || null,
      visible: body.visible !== false,
      active: body.active !== false,
    },
  });
}
