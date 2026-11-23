"use client";

import { Card, Stat } from "@/components/ui";
import { fmtPct, fmtUGX } from "@/lib/format";
import type { DeskApi } from "./useDesk";

/** Metrics — the solvency truth an operator watches. Coverage is ALSO
 *  published to members (app_dashboard); there is no second set of books. */
export function OverviewSection({ desk }: { desk: DeskApi }) {
  const m = desk.dash?.metrics;
  if (!m) return null;
  const coverage = Number(m.coverage_pct);
  const paused = desk.dash?.settings?.platform_paused === "true";
  return (
    <div className="space-y-4">
      <Card title="Platform" hint="Everything below is aggregated in one app_admin_dashboard() round-trip.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat
            label="Reserve coverage"
            value={fmtPct(coverage)}
            tone={coverage >= 100 ? "good" : "bad"}
            sub="must stay ≥ 100%"
          />
          <Stat label="Reserve" value={fmtUGX(m.reserve_balance)} sub="operator float + promo overlay" />
          <Stat label="Obligations" value={fmtUGX(m.obligations)} sub="wallets + promised payouts" />
          <Stat label="Wallets" value={fmtUGX(m.wallets_total)} />
          <Stat
            label="Open vaults"
            value={String(m.open_cycles)}
            sub={`${fmtUGX(m.open_principal)} in · ${fmtUGX(m.open_promised_yield)} promised`}
          />
          <Stat label="Members" value={String(m.members)} sub={`+${m.members_today} today`} />
          <Stat
            label="Pending deposits"
            value={String(m.pending_deposits)}
            sub={fmtUGX(m.pending_deposits_total)}
            tone={m.pending_deposits > 0 ? "warn" : "default"}
          />
          <Stat
            label="Pending withdrawals"
            value={String(m.pending_withdrawals)}
            sub={fmtUGX(m.pending_withdrawals_total)}
            tone={m.pending_withdrawals > 0 ? "warn" : "default"}
          />
          <Stat label="Deposits (all-time)" value={fmtUGX(m.deposits_total)} />
          <Stat label="Withdrawals (all-time)" value={fmtUGX(m.withdrawals_total)} />
          <Stat label="Yield paid (closed)" value={fmtUGX(m.yield_paid_total)} />
          <Stat
            label="Promo spend"
            value={fmtUGX(Number(m.bonus_total ?? 0) + Number(m.referral_commission_total ?? 0))}
            sub={`welcome bonus ${fmtUGX(m.bonus_total ?? 0)} · L1 commission ${fmtUGX(m.referral_commission_total ?? 0)}`}
          />
          <Stat
            label="Reserve overlay"
            value={fmtUGX(m.promo_overlay_total ?? 0)}
            sub="non-cash promo funding — never drawable"
          />
          <Stat label="Fee income" value={fmtUGX(m.fees_total)} tone="gold" />
          <Stat label="Reserve topped up" value={fmtUGX(m.reserve_topped_total)} />
          <Stat label="Reserve drawn" value={fmtUGX(m.reserve_drawn_total)} />
        </div>
      </Card>
      <Card title="Platform switch" hint="platform_paused blocks every money movement RPC; reads keep working. Edit on the Settings tab.">
        <div className="flex items-center gap-3 text-sm">
          <span
            className={`rounded-full px-3 py-1 font-bold ${
              paused ? "bg-red-700 text-white" : "bg-emerald-900 text-emerald-300"
            }`}
          >
            {paused ? "PAUSED" : "RUNNING"}
          </span>
          <span className="text-[#c3cfe4]">{desk.dash?.settings?.pause_message ?? ""}</span>
        </div>
      </Card>
    </div>
  );
}
