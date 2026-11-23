"use client";

// Wallet tab — the account surface, mirroring the reference /assets page:
// total balance vs withdrawable balance up front (total = cash + principal
// locked in open plans), then deposit/withdraw (MoneySection) and the full
// transaction feed. Balances are read from app_dashboard; movement stays in
// the RPCs.

import { useMemo } from "react";
import { fmtUGX } from "@/lib/format";
import { MoneySection } from "./MoneySection";
import { HistorySection } from "./HistorySection";
import type { MemberDeskApi } from "./useMemberDesk";

export function WalletSection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;

  const locked = useMemo(
    () =>
      d.cycles
        .filter((c) => c.status === "open")
        .reduce((sum, c) => sum + Number(c.principal), 0),
    [d.cycles]
  );
  const cash = Number(d.profile.wallet_balance);
  const total = cash + locked;

  return (
    <div className="flex flex-col gap-4">
      <section className="hero-wallet p-5">
        <div className="text-[11px] uppercase tracking-wide text-white/70">Total balance</div>
        <div className="money-hero mt-1 text-white">{fmtUGX(total)}</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/25 border border-white/10 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-white/60">Withdrawable</div>
            <div className="text-base font-black text-white mt-0.5 tabular-nums">{fmtUGX(cash)}</div>
          </div>
          <div className="rounded-xl bg-black/25 border border-white/10 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-white/60">In active plans</div>
            <div className="text-base font-black text-white mt-0.5 tabular-nums">{fmtUGX(locked)}</div>
          </div>
        </div>
        <p className="mt-2.5 text-[10.5px] text-white/70 leading-snug">
          Money locked in a plan is yours — it simply isn&apos;t withdrawable until the plan pays
          out at maturity (or on the disclosed early-exit share).
        </p>
      </section>

      <MoneySection desk={desk} />

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">
          Recent transactions
        </h2>
        <HistorySection desk={desk} />
      </section>
    </div>
  );
}
