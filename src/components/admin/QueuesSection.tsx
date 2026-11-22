"use client";

// Queues — the manual settlement workbench (admin-confirmed transfers
// first; a PSP webhook can drive the same RPCs later). Confirm/reject/
// pay/fail all go through app_admin_settle_* in admin.sql, which move the
// wallet AND the reserve in lockstep and are replay-guarded by their
// status transition under a row lock.

import { useCallback, useEffect, useState } from "react";
import { Btn, Card } from "@/components/ui";
import { adminQueue, adminSettle } from "@/lib/app/adminApi";
import { fmtDateTime, fmtUGX } from "@/lib/format";
import type {
  AdminQueueDepositRow,
  AdminQueueWithdrawalRow,
} from "@/lib/api/types";
import { inputCls } from "./parts";
import type { DeskApi } from "./useDesk";

type Kind = "deposits" | "withdrawals";

export function QueuesSection({ desk }: { desk: DeskApi }) {
  const [kind, setKind] = useState<Kind>("deposits");
  const [deposits, setDeposits] = useState<AdminQueueDepositRow[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminQueueWithdrawalRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (kind === "deposits") setDeposits((await adminQueue("deposits", desk.cfg)) as AdminQueueDepositRow[]);
      else setWithdrawals((await adminQueue("withdrawals", desk.cfg)) as AdminQueueWithdrawalRow[]);
    } catch (e) {
      desk.setErrorMsg(`Queue: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.cfg, kind]);

  useEffect(() => {
    // Intentional fetch-on-mount / on-tab switch; setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const note = (id: number) => notes[`${kind}:${id}`] ?? "";
  const setNote = (id: number, v: string) =>
    setNotes((n) => ({ ...n, [`${kind}:${id}`]: v }));

  const act = async (
    action: "confirm_deposit" | "reject_deposit" | "pay_withdrawal" | "fail_withdrawal",
    id: number
  ) => {
    setBusyId(`${action}:${id}`);
    const payload =
      action === "confirm_deposit"
        ? { action, id, note: note(id) || undefined }
        : action === "pay_withdrawal"
          ? { action, id, reference: note(id) || undefined }
          : { action, id, reason: note(id) };
    const done = await desk.mutate(action, (cfg) => adminSettle(payload, cfg), () => {
      setNotes((n) => {
        const next = { ...n };
        delete next[`${kind}:${id}`];
        return next;
      });
    });
    if (done) await load();
    setBusyId(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {(["deposits", "withdrawals"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-xl py-2 text-xs font-bold ${
              kind === k ? "bg-[#f5b301] text-[#1a1400]" : "border border-[#2b3f6f] text-[#9fb3e8]"
            }`}
          >
            {k === "deposits" ? "Money in (deposits)" : "Money out (withdrawals)"}
            <span className="ml-1.5 text-[10px] opacity-70">
              {k === "deposits" ? deposits?.length ?? "…" : withdrawals?.length ?? "…"}
            </span>
          </button>
        ))}
      </div>

      {kind === "deposits" && (
        <Card
          title="Pending deposits"
          hint="Verify the money actually arrived (MoMo/bank statement) BEFORE confirming — confirmation credits the wallet and funds the reserve in the same transaction."
        >
          {!deposits || deposits.length === 0 ? (
            <p className="text-sm text-[#6b7fae]">Queue is clear.</p>
          ) : (
            <ul className="space-y-3">
              {deposits.map((d) => (
                <li key={d.id} className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <div>
                      <span className="font-black tabular-nums">{fmtUGX(d.amount)}</span>
                      <span className="ml-2 font-bold">{d.username ?? d.display_name ?? "member"}</span>
                      <span className="ml-2 text-[#6b7fae]">
                        {d.phone ? ` · ${d.phone}` : ""}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#6b7fae]">
                      {d.channel} from {d.payer_account} · {fmtDateTime(d.created_at)}
                      {d.reference ? ` · ref ${d.reference}` : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      className={`${inputCls} flex-1 min-w-40`}
                      placeholder="Note / txn id (audited)"
                      value={note(d.id)}
                      onChange={(e) => setNote(d.id, e.target.value)}
                    />
                    <Btn
                      variant="solid"
                      disabled={busyId === `confirm_deposit:${d.id}`}
                      onClick={() => act("confirm_deposit", d.id)}
                    >
                      Confirm
                    </Btn>
                    <Btn
                      variant="danger"
                      disabled={busyId === `reject_deposit:${d.id}` || note(d.id).trim().length < 3}
                      onClick={() => act("reject_deposit", d.id)}
                    >
                      Reject
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {kind === "withdrawals" && (
        <Card
          title="Pending withdrawals"
          hint="Pay out of the reserve first, then mark paid — paying deducts the reserve, and failing refunds the member's wallet. Reject with a reason if the payout bounced."
        >
          {!withdrawals || withdrawals.length === 0 ? (
            <p className="text-sm text-[#6b7fae]">Queue is clear.</p>
          ) : (
            <ul className="space-y-3">
              {withdrawals.map((w) => (
                <li key={w.id} className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <div>
                      <span className="font-black tabular-nums">{fmtUGX(w.payout_amount)}</span>
                      <span className="ml-2 text-[11px] text-[#6b7fae]">
                        (request {fmtUGX(w.amount)} − fee {fmtUGX(w.fee_amount)})
                      </span>
                      <span className="ml-2 font-bold">{w.username}</span>
                      <span className="ml-2 text-[#6b7fae]">{w.phone ?? ""}</span>
                    </div>
                    <span className="text-[11px] text-[#6b7fae]">
                      {w.channel} to {w.destination_account} · {fmtDateTime(w.created_at)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      className={`${inputCls} flex-1 min-w-40`}
                      placeholder="Payout reference / reason (audited)"
                      value={note(w.id)}
                      onChange={(e) => setNote(w.id, e.target.value)}
                    />
                    <Btn
                      variant="solid"
                      disabled={busyId === `pay_withdrawal:${w.id}`}
                      onClick={() => act("pay_withdrawal", w.id)}
                    >
                      Mark paid
                    </Btn>
                    <Btn
                      variant="danger"
                      disabled={busyId === `fail_withdrawal:${w.id}` || note(w.id).trim().length < 3}
                      onClick={() => act("fail_withdrawal", w.id)}
                    >
                      Fail (refund)
                    </Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
