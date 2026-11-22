"use client";

// Vaults tab: catalogue + open form + my cycles (with disclosed early exit).

import { useMemo, useState } from "react";
import { exitVault, newIdemKey, openVault } from "@/lib/app/api";
import { fmtDate, fmtRate, fmtUGX } from "@/lib/format";
import type { CycleRow, ProductRow } from "@/lib/api/types";
import { Banner, Field, input } from "./parts";
import type { MemberDeskApi } from "./useMemberDesk";

export function VaultsSection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  // One render-time stamp (not Date.now() per cycle row) for maturity hints.
  const [now] = useState(() => Date.now());
  const [productId, setProductId] = useState<number | null>(null);
  const [principal, setPrincipal] = useState("");
  const [showOpen, setShowOpen] = useState(false);

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
      setShowOpen(false);
      setPrincipal("");
      setProductId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#6b7fae] mb-2">
          Open a vault
        </h2>
        <div className="space-y-2">
          {d.products.map((p) => (
            <button
              key={p.slug}
              onClick={() => {
                setProductId(p.id ?? null);
                setShowOpen(true);
              }}
              className={`w-full text-left rounded-xl border p-4 flex items-center justify-between gap-3 transition ${
                productId === p.id
                  ? "border-[#f5b301] bg-[#0d1733]"
                  : "border-[#1d2c55] bg-[#0a1430] hover:border-[#2b3f6f]"
              }`}
            >
              <div>
                <div className="font-bold text-sm">{p.name}</div>
                <div className="text-[11px] text-[#9fb3e8] mt-0.5">
                  {p.duration_days} days · {fmtUGX(p.min_principal)}–{fmtUGX(p.max_principal)}
                </div>
              </div>
              <div className="text-xl font-black text-[#f5b301]">+{fmtRate(p.total_rate_pct)}</div>
            </button>
          ))}
        </div>
      </section>

      {showOpen && product && (
        <section className="rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm">
              {product.name} · {product.duration_days} days · +{fmtRate(product.total_rate_pct)} total
            </h3>
            <button onClick={() => setShowOpen(false)} className="text-xs text-[#6b7fae]">
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
              <div className="rounded-xl bg-[#0a1430] border border-[#1d2c55] p-2">
                <div className="text-[10px] text-[#6b7fae] uppercase">Yield</div>
                <div className="text-sm font-bold text-emerald-400">{fmtUGX(preview.yield)}</div>
              </div>
              <div className="rounded-xl bg-[#0a1430] border border-[#1d2c55] p-2">
                <div className="text-[10px] text-[#6b7fae] uppercase">Payout total</div>
                <div className="text-sm font-bold">{fmtUGX(preview.payout)}</div>
              </div>
              <div className="rounded-xl bg-[#0a1430] border border-[#1d2c55] p-2">
                <div className="text-[10px] text-[#6b7fae] uppercase">From wallet</div>
                <div className="text-sm font-bold">{fmtUGX(amount)}</div>
              </div>
            </div>
          )}

          <button
            onClick={onOpen}
            disabled={desk.busy || !inRange}
            className="rounded-xl bg-[#f5b301] text-[#1a1400] font-black py-3 disabled:opacity-40"
          >
            {desk.busy ? "Opening…" : "Open vault (rate locks now)"}
          </button>
          <p className="text-[10px] text-[#6b7fae] leading-relaxed">
            Your wallet must hold the principal. The app refuses to open any vault whose promised
            yield is not already covered by the public reserve.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#6b7fae] mb-2">My vaults</h2>
        {d.cycles.length === 0 && (
          <p className="text-xs text-[#6b7fae]">No vaults yet. Open one above.</p>
        )}
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
  const mature = open && new Date(cycle.matures_at).getTime() <= now;

  return (
    <div className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-sm">
          {cycle.product_name ?? "Vault"} · {fmtUGX(cycle.principal)}
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            cycle.status === "open"
              ? "bg-amber-500/15 text-amber-300"
              : cycle.status === "closed"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-[#1d2c55] text-[#9fb3e8]"
          }`}
        >
          {cycle.status}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-[#9fb3e8] grid grid-cols-2 gap-x-3">
        <div>Rate +{fmtRate(cycle.total_rate_pct)} total</div>
        <div>Yield {fmtUGX(cycle.promised_yield)}</div>
        <div>Payout {fmtUGX(cycle.payout_total)}</div>
        <div>Matures {fmtDate(cycle.matures_at)}</div>
      </div>
      {open && (
        <div className="mt-3 flex items-center gap-2">
          {mature ? (
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
                <button onClick={() => setExiting(false)} className="text-[11px] text-[#6b7fae]">
                  keep
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
