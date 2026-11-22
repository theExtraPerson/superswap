"use client";

// History tab: the member's own append-only ledger rows.

import { fmtDateTime, fmtUGX } from "@/lib/format";
import type { MemberDeskApi } from "./useMemberDesk";

const KIND_LABEL: Record<string, string> = {
  deposit_credit: "Deposit received",
  withdrawal_debit: "Withdrawal requested",
  withdrawal_reversal: "Withdrawal refunded",
  vault_debit: "Vault opened",
  vault_payout: "Vault payout",
  vault_exit_credit: "Early exit",
  referral_reward: "Referral reward",
  bonus_credit: "Bonus",
  adjustment_credit: "Correction (credit)",
  adjustment_debit: "Correction (debit)",
};

export function HistorySection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  if (d.ledger.length === 0)
    return <p className="text-xs text-[#6b7fae]">No ledger entries yet.</p>;

  return (
    <div className="space-y-2">
      {d.ledger.map((l) => {
        const positive = Number(l.amount) >= 0;
        return (
          <div
            key={l.id}
            className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-3 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="text-xs font-bold truncate">
                {KIND_LABEL[l.kind] ?? l.kind}
              </div>
              <div className="text-[10px] text-[#6b7fae] mt-0.5">
                {fmtDateTime(l.created_at)}
                {l.note ? ` · ${l.note}` : ""}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-sm font-black ${positive ? "text-emerald-400" : "text-red-300"}`}>
                {positive ? "+" : "−"}
                {fmtUGX(Math.abs(Number(l.amount)))}
              </div>
              <div className="text-[10px] text-[#6b7fae]">bal {fmtUGX(l.balance_after)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
