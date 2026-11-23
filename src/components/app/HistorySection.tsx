"use client";

// The member's own append-only ledger rows. Exported as a reusable row so the
// Home tab ("recent activity") and the Wallet tab ("recent transactions")
// render the exact same truth from app_dashboard.ledger.

import { fmtDateTime, fmtUGX } from "@/lib/format";
import type { DashboardPayload, LedgerRow } from "@/lib/api/types";
import type { MemberDeskApi } from "./useMemberDesk";

const KIND_LABEL: Record<string, string> = {
  deposit_credit: "Deposit received",
  withdrawal_debit: "Withdrawal requested",
  withdrawal_reversal: "Withdrawal refunded",
  vault_debit: "Vault opened",
  vault_payout: "Vault payout",
  vault_exit_credit: "Early exit",
  referral_reward: "Referral commission",
  bonus_credit: "Welcome bonus",
  checkin_bonus: "Daily check-in reward",
  adjustment_credit: "Correction (credit)",
  adjustment_debit: "Correction (debit)",
};

export function LedgerRowItem({ row }: { row: LedgerRow }) {
  const positive = Number(row.amount) >= 0;
  return (
    <div className="card-grad !rounded-xl p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-bold truncate">{KIND_LABEL[row.kind] ?? row.kind}</div>
        <div className="text-[10px] text-[#92a0b9] mt-0.5">
          {fmtDateTime(row.created_at)}
          {row.note ? ` · ${row.note}` : ""}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`text-sm font-black ${positive ? "text-emerald-400" : "text-red-300"}`}>
          {positive ? "+" : "−"}
          {fmtUGX(Math.abs(Number(row.amount)))}
        </div>
        <div className="text-[10px] text-[#92a0b9]">bal {fmtUGX(row.balance_after)}</div>
      </div>
    </div>
  );
}

export function HistorySection({ desk }: { desk: MemberDeskApi }) {
  const d: DashboardPayload = desk.data!;
  if (d.ledger.length === 0)
    return <p className="text-xs text-[#92a0b9]">No ledger entries yet.</p>;

  return (
    <div className="space-y-2">
      {d.ledger.map((l) => (
        <LedgerRowItem key={l.id} row={l} />
      ))}
    </div>
  );
}
