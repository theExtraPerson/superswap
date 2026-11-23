"use client";

// Queues — the settlement workbench. Deposits ride the API: momo rows
// request themselves (PIN prompt at open time) and auto-credit when the
// signed Shashura callback lands — this queue keeps only the human cases
// (bank transfers, dead attempts, amount mismatches) as Confirm/Reject
// overrides. Withdrawals are ALWAYS approved here: settle manually ("Mark
// paid") or via the API ("Pay via Shashura" — Airtel settles on the spot,
// MTN settles when the webhook fires). Both settlement paths run the same
// SQL cores, so the ledger can't drift between them.

import { useCallback, useEffect, useState } from "react";
import { Btn, Card } from "@/components/ui";
import { adminQueue, adminSettle, adminShashura } from "@/lib/app/adminApi";
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

  /** Gateway work: push a collection, fire an API payout, or pull the final
   * state by enquiry when the webhook has not (yet) landed. */
  const gateway = async (
    action: "collect_deposit" | "pay_withdrawal" | "refresh",
    id: number
  ) => {
    setBusyId(`${action}:${id}`);
    const payload = action === "refresh" ? { action, kind, id } : { action, id };
    const done = await desk.mutate(action, (cfg) => adminShashura(payload, cfg));
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
              kind === k ? "bg-[#2fd4f2] text-[#04202b]" : "border border-[#2b3d5c] text-[#c3cfe4]"
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
          title="Deposits needing attention"
          hint="Healthy MoMo deposits settle themselves and never wait here. What you see is a dead/failed gateway attempt or a flagged amount — Confirm credits (and fires the L1 + L2 referral commission), Reject closes with a reason."
        >
          {!deposits || deposits.length === 0 ? (
            <p className="text-sm text-[#92a0b9]">Queue is clear.</p>
          ) : (
            <ul className="space-y-3">
              {deposits.map((d) => {
                const state = d.gateway_state ?? "none";
                const momo = d.channel === "momo";
                return (
                  <li key={d.id} className="rounded-xl border border-[#20304a] bg-[#0c1626] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <div>
                        <span className="font-black tabular-nums">{fmtUGX(d.amount)}</span>
                        <span className="ml-2 font-bold">{d.username ?? d.display_name ?? "member"}</span>
                        <span className="ml-2 text-[#92a0b9]">
                          {d.phone ? ` · ${d.phone}` : ""}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#92a0b9]">
                        {d.channel} from {d.payer_account} · {fmtDateTime(d.created_at)}
                        {d.reference ? ` · ref ${d.reference}` : ""}
                      </span>
                    </div>
                    <GatewayPill state={state} detail={d.gateway_detail} tid={d.gateway_tid} />
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
                        {state === "verified" ? "Confirm (amount differs — verify first)" : "Confirm"}
                      </Btn>
                      <Btn
                        variant="danger"
                        disabled={busyId === `reject_deposit:${d.id}` || note(d.id).trim().length < 3}
                        onClick={() => act("reject_deposit", d.id)}
                      >
                        Reject
                      </Btn>
                    </div>
                    {momo && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(state === "none" || state === "failed") && (
                          <Btn
                            variant="ghost"
                            disabled={busyId === `collect_deposit:${d.id}`}
                            onClick={() => gateway("collect_deposit", d.id)}
                          >
                            {state === "failed" ? "Resend MoMo request (Shashura)" : "Request MoMo (Shashura)"}
                          </Btn>
                        )}
                        {(state === "requested" || state === "verified") && (
                          <Btn
                            variant="ghost"
                            disabled={busyId === `refresh:${d.id}`}
                            onClick={() => gateway("refresh", d.id)}
                          >
                            Check status
                          </Btn>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {kind === "withdrawals" && (
        <Card
          title="Pending withdrawals"
          hint="Settle how you like: send the money yourself then Mark paid (manual), or Pay via Shashura — the API settles it automatically when the network confirms. Fail refunds the member; both paths move the reserve in lockstep."
        >
          {!withdrawals || withdrawals.length === 0 ? (
            <p className="text-sm text-[#92a0b9]">Queue is clear.</p>
          ) : (
            <ul className="space-y-3">
              {withdrawals.map((w) => {
                const state = w.gateway_state ?? "none";
                const momo = w.channel === "momo";
                return (
                  <li key={w.id} className="rounded-xl border border-[#20304a] bg-[#0c1626] p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <div>
                        <span className="font-black tabular-nums">{fmtUGX(w.payout_amount)}</span>
                        <span className="ml-2 text-[11px] text-[#92a0b9]">
                          (request {fmtUGX(w.amount)} − fee {fmtUGX(w.fee_amount)})
                        </span>
                        <span className="ml-2 font-bold">{w.username}</span>
                        <span className="ml-2 text-[#92a0b9]">{w.phone ?? ""}</span>
                      </div>
                      <span className="text-[11px] text-[#92a0b9]">
                        {w.channel} to {w.destination_account} · {fmtDateTime(w.created_at)}
                      </span>
                    </div>
                    <GatewayPill state={state} detail={w.gateway_detail} tid={w.gateway_tid} />
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
                        Mark paid (manual)
                      </Btn>
                      <Btn
                        variant="danger"
                        disabled={busyId === `fail_withdrawal:${w.id}` || note(w.id).trim().length < 3}
                        onClick={() => act("fail_withdrawal", w.id)}
                      >
                        Fail (refund)
                      </Btn>
                    </div>
                    {momo && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(state === "none" || state === "failed") && (
                          <Btn
                            variant="ghost"
                            disabled={busyId === `pay_withdrawal_api:${w.id}`}
                            onClick={() => gateway("pay_withdrawal", w.id)}
                          >
                            Pay via Shashura (API)
                          </Btn>
                        )}
                        {state === "initiated" && (
                          <Btn
                            variant="ghost"
                            disabled={busyId === `refresh:${w.id}`}
                            onClick={() => gateway("refresh", w.id)}
                          >
                            Check status
                          </Btn>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/** One pill translating the Shashura trail into operator English. */
function GatewayPill({
  state,
  detail,
  tid,
}: {
  state: string;
  detail?: string | null;
  tid?: string | null;
}) {
  if (state === "none") return null;
  const tone: Record<string, string> = {
    requested: "bg-amber-500/15 text-amber-300",
    verified: "bg-emerald-500/15 text-emerald-300",
    initiated: "bg-amber-500/15 text-amber-300",
    failed: "bg-red-500/15 text-red-300",
  };
  const label: Record<string, string> = {
    requested: "MoMo request sent — auto-credits when the member approves",
    verified: "Gateway money differs from the request — verify before Confirming",
    initiated: "Shashura payout in flight — settles on confirmation",
    failed: "Shashura attempt failed",
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <span className={`rounded-full px-2.5 py-1 font-semibold ${tone[state] ?? "bg-white/10 text-[#c3cfe4]"}`}>
        {label[state] ?? `Gateway: ${state}`}
        {detail ? ` · ${detail}` : ""}
      </span>
      {tid ? <span className="text-[#92a0b9]">tid {tid}</span> : null}
    </div>
  );
}
