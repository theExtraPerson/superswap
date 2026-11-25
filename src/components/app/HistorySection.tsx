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
  vault_earning: "Daily earning",
  vault_payout: "Principal returned",
  vault_exit_credit: "Early exit",
  referral_reward: "Referral commission",
  referral_reward_l2: "Referral commission (L2)",
  bonus_credit: "Welcome bonus",
  checkin_bonus: "Daily check-in reward",
  adjustment_credit: "Correction (credit)",
  adjustment_debit: "Correction (debit)",
};

export function LedgerRowItem({ row }: { row: LedgerRow }) {
  const positive = Number(row.amount) >= 0;
  // Admin corrections: the operator's written reason IS what the member needs
  // to see, so surface it as the entry label instead of the generic "Correction"
  // kind. Direction still reads from the +/- amount, so nothing is lost.
  const isCorrection = row.kind === "adjustment_credit" || row.kind === "adjustment_debit";
  const reasonAsLabel = isCorrection && !!row.note;
  const title = reasonAsLabel ? row.note : (KIND_LABEL[row.kind] ?? row.kind);
  return (
    <div className="card-grad !rounded-xl p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-bold truncate">{title}</div>
        <div className="text-[10px] text-[#92a0b9] mt-0.5">
          {fmtDateTime(row.created_at)}
          {row.note && !reasonAsLabel ? ` · ${row.note}` : ""}
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
