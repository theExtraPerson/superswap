"use client";

// VIP tab — the product shelf, structured like the reference: an "active plan"
// card with a real progress bar (term elapsed toward maturity), the catalogue
// with a Start-investing-now CTA on each card, and my plans below. Money
// decisions stay in app_open_vault / app_exit_vault; this is presentation.

import { useMemo, useState } from "react";
import { exitVault, newIdemKey, openVault } from "@/lib/app/api";
import { fmtDate, fmtRate, fmtUGX } from "@/lib/format";
import type { CycleRow, ProductRow } from "@/lib/api/types";
import { Banner, Field, input } from "./parts";
import type { MemberDeskApi } from "./useMemberDesk";

/** Term progress: 0 → just opened, 100 → matured. Clamped, clock-safe. */
function termPct(cycle: CycleRow, now: number): number {
  const from = new Date(cycle.opened_at).getTime();
  const to = new Date(cycle.matures_at).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100));
}

export function VipSection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  // One render-time stamp (not Date.now() per row) for progress + maturity hints.
  const [now] = useState(() => Date.now());
  const [productId, setProductId] = useState<number | null>(null);
  const [principal, setPrincipal] = useState("");

  const openCycles = useMemo(() => d.cycles.filter((c) => c.status === "open"), [d.cycles]);
  const active = openCycles[0];

  const product: ProductRow | undefined = useMemo(
    () => d.products.find((p) => p.id === productId),
    [d.products, productId]
  );
  const amount = Number(principal.replace(/[^0-9.]/g, "")) || 0;
  const yieldPreview = product
    ? Math.round((amount * Number(product.total_rate_pct)) / 100)
    : 0;
  const preview = product ? { yield: yieldPreview, payout: amount + yieldPreview } : null;
  const inRange =
    product && amount >= Number(product.min_principal) && amount <= Number(product.max_principal);

  async function onOpen() {
    if (!product?.id || !inRange) return;
    const okDone = await desk.mutate(() =>
      openVault({ productId: product.id!, principal: amount, idemKey: newIdemKey("open") })
    );
    if (okDone) {
      setProductId(null);
      setPrincipal("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Active plan strip — like the reference's YOUR PLAN header */}
      {active ? (
        <section className="hero-wallet p-5">
          <div className="text-[11px] uppercase tracking-wide text-white/70">Your active plan</div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div className="text-lg font-black text-white leading-tight">
              {active.product_name ?? "Vault"}
              <div className="text-[11px] font-semibold text-white/70 mt-0.5">
                {fmtUGX(active.principal)} · +{fmtRate(active.total_rate_pct)} total
              </div>
            </div>
            <div className="text-right">
              <div className="money-hero !text-2xl text-white">{Math.round(termPct(active, now))}%</div>
              <div className="text-[10px] text-white/70">term elapsed</div>
            </div>
          </div>
          <div className="progress mt-3 !bg-black/25 !border-white/15">
            <span style={{ width: `${termPct(active, now)}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/80">
            <span>Matures {fmtDate(active.matures_at)}</span>
            <span>
              Payout <b className="text-white">{fmtUGX(active.payout_total)}</b>
            </span>
          </div>
          {openCycles.length > 1 && (
            <div className="mt-2 text-[10.5px] text-white/70">
              +{openCycles.length - 1} more open plan{openCycles.length > 2 ? "s" : ""} below.
            </div>
          )}
        </section>
      ) : (
        <section className="card-grad p-4 text-center">
          <div className="text-sm font-bold">No active plan yet</div>
          <p className="text-[11px] text-[#92a0b9] mt-1">
            Pick a term below. Your wallet must hold the principal, and the reserve must already
            cover the promise before the app lets you open it.
          </p>
        </section>
      )}

      {/* Catalogue */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">All plans</h2>
        <div className="space-y-2">
          {d.products.map((p) => (
            <div key={p.slug} className={`card-grad p-4 ${productId === p.id ? "shadow-[0_0_22px_-6px_rgba(43,212,232,0.6)]" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">{p.name}</div>
                  <div className="text-[11px] text-[#c3cfe4] mt-0.5">
                    {p.duration_days} days · {fmtUGX(p.min_principal)}–{fmtUGX(p.max_principal)}
                  </div>
                </div>
                <div className="text-xl font-black text-[#45e9ff]">+{fmtRate(p.total_rate_pct)}</div>
              </div>
              {/* Product progress: this product's open cycle, if any */}
              {(() => {
                const c = openCycles.find((x) => x.product_id === p.id);
                return c ? (
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[10px] text-[#92a0b9] mb-1">
                      <span>cycle in progress</span>
                      <span>{Math.round(termPct(c, now))}% elapsed</span>
                    </div>
                    <div className="progress">
                      <span style={{ width: `${termPct(c, now)}%` }} />
                    </div>
                  </div>
                ) : null;
              })()}
              <button
                onClick={() => setProductId(productId === p.id ? null : p.id ?? null)}
                className="btn-cta mt-3 w-full py-2.5 text-sm"
              >
                Start investing now
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Open form for the selected plan */}
      {product && (
        <section className="card-grad p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm">
              {product.name} · {product.duration_days} days · +{fmtRate(product.total_rate_pct)} total
            </h3>
            <button onClick={() => setProductId(null)} className="text-xs text-[#92a0b9]">
              ✕ close
            </button>
          </div>
          {product.terms && <Banner kind="info">{product.terms}</Banner>}

          <Field title="Principal (UGX)" hint={`Between ${fmtUGX(product.min_principal)} and ${fmtUGX(product.max_principal)}`}>
            <input
              className={input}
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              inputMode="numeric"
              placeholder="100000"
            />
          </Field>

          {amount > 0 && preview && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#0c1626] border border-[#20304a] p-2">
                <div className="text-[10px] text-[#92a0b9] uppercase">Yield</div>
                <div className="text-sm font-bold text-emerald-400">{fmtUGX(preview.yield)}</div>
              </div>
              <div className="rounded-xl bg-[#0c1626] border border-[#20304a] p-2">
                <div className="text-[10px] text-[#92a0b9] uppercase">Payout total</div>
                <div className="text-sm font-bold">{fmtUGX(preview.payout)}</div>
              </div>
              <div className="rounded-xl bg-[#0c1626] border border-[#20304a] p-2">
                <div className="text-[10px] text-[#92a0b9] uppercase">From wallet</div>
                <div className="text-sm font-bold">{fmtUGX(amount)}</div>
              </div>
            </div>
          )}

          <button
            onClick={onOpen}
            disabled={desk.busy || !inRange}
            className="btn-cta w-full py-3.5 text-[15px]"
          >
            {desk.busy ? "Opening…" : "Open plan (rate locks now)"}
          </button>
          <p className="text-[10px] text-[#92a0b9] leading-relaxed">
            Your wallet must hold the principal. The app refuses to open any plan whose promised
            yield is not already covered by the public reserve.
          </p>
        </section>
      )}

      {/* My plans */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">My plans</h2>
        {d.cycles.length === 0 && <p className="text-xs text-[#92a0b9]">No plans yet. Start one above.</p>}
        <div className="space-y-2">
          {d.cycles.map((c) => (
            <CycleCard key={c.id} cycle={c} desk={desk} now={now} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CycleCard({ cycle, desk, now }: { cycle: CycleRow; desk: MemberDeskApi; now: number }) {
  const [exiting, setExiting] = useState(false);
  const open = cycle.status === "open";

  return (
    <div className="card-grad !rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-sm">
          {cycle.product_name ?? "Plan"} · {fmtUGX(cycle.principal)}
        </div>
        <span
          className={`pill ${
            cycle.status === "open"
              ? "bg-amber-500/15 text-amber-300"
              : cycle.status === "closed"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-[#20304a] text-[#c3cfe4]"
          }`}
        >
          {cycle.status}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-[#c3cfe4] grid grid-cols-2 gap-x-3">
        <div>Rate +{fmtRate(cycle.total_rate_pct)} total</div>
        <div>Yield {fmtUGX(cycle.promised_yield)}</div>
        <div>Payout {fmtUGX(cycle.payout_total)}</div>
        <div>Matures {fmtDate(cycle.matures_at)}</div>
      </div>
      {open && (
        <>
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-[#92a0b9] mb-1">
              <span>term progress</span>
              <span>{Math.round(termPct(cycle, now))}%</span>
            </div>
            <div className="progress">
              <span style={{ width: `${termPct(cycle, now)}%` }} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {new Date(cycle.matures_at).getTime() <= now ? (
              <span className="text-[11px] text-emerald-300">
                Matured — payout is credited at today&apos;s settlement hour.
              </span>
            ) : (
              <>
                <button
                  onClick={() => setExiting((v) => !v)}
                  className="text-[11px] text-red-300 border border-red-500/40 rounded-lg px-2 py-1 hover:bg-red-500/10"
                >
                  Early exit…
                </button>
                {exiting && (
                  <button
                    onClick={async () => {
                      if (await desk.mutate(() => exitVault(cycle.id))) setExiting(false);
                    }}
                    disabled={desk.busy}
                    className="text-[11px] bg-red-700 text-white rounded-lg px-2 py-1 disabled:opacity-50"
                  >
                    Confirm: forfeit yield, return disclosed share of principal
                  </button>
                )}
                {exiting && (
                  <button onClick={() => setExiting(false)} className="text-[11px] text-[#92a0b9]">
                    keep
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
