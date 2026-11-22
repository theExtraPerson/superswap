"use client";

// Reserve — the real-money account behind every promise. Top-ups record
// money the operator has actually moved into the float account; draws are
// refused by SQL if coverage would drop below 100% (the reserve belongs to
// members' obligations first). Every entry lands in reserve_entries + audit.

import { useState } from "react";
import { Btn, Card, Stat } from "@/components/ui";
import { adminReserve } from "@/lib/app/adminApi";
import { fmtPct, fmtUGX } from "@/lib/format";
import { Field, inputCls } from "./parts";
import type { DeskApi } from "./useDesk";

export function ReserveSection({ desk }: { desk: DeskApi }) {
  const m = desk.dash?.metrics;
  const [action, setAction] = useState<"topup" | "draw">("topup");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!m) return null;
  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const coverage = Number(m.coverage_pct);
  const drawHeadroom = Math.max(0, Number(m.reserve_balance) - Number(m.obligations));

  const submit = async () => {
    if (!value || reference.trim().length < 3) return;
    setBusy(true);
    const okDone = await desk.mutate(action === "topup" ? "Reserve top-up" : "Reserve draw", (cfg) =>
      adminReserve(
        { action, amount: value, reference: reference.trim(), note: note.trim() || undefined },
        cfg
      )
    );
    if (okDone) {
      setAmount("");
      setReference("");
      setNote("");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <Card title="Position" hint="Coverage = reserve ÷ (member wallets + promised vault payouts). Members see this same number.">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Reserve" value={fmtUGX(m.reserve_balance)} tone={coverage >= 100 ? "good" : "bad"} />
          <Stat label="Obligations" value={fmtUGX(m.obligations)} />
          <Stat label="Coverage" value={fmtPct(coverage)} tone={coverage >= 100 ? "good" : "bad"} sub="floor: 100%" />
        </div>
      </Card>

      <Card
        title="Move reserve money"
        hint={
          action === "topup"
            ? "Record money you have physically received into the reserve account. Reference is required and audited."
            : `Only surplus above obligations can be drawn — headroom right now is ${fmtUGX(drawHeadroom)}. SQL refuses anything more.`
        }
      >
        <div className="grid grid-cols-2 gap-2 mb-3">
          {(["topup", "draw"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`rounded-xl py-2 text-xs font-bold ${
                action === a ? "bg-[#f5b301] text-[#1a1400]" : "border border-[#2b3f6f] text-[#9fb3e8]"
              }`}
            >
              {a === "topup" ? "Top up (money in)" : "Draw (money out)"}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Amount (UGX)">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={action === "draw" ? String(drawHeadroom) : "500000"} />
          </Field>
          <Field label="Bank / MoMo reference (required)">
            <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="TRX-2026-000123" />
          </Field>
          <Field label="Note (optional)">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this movement" />
          </Field>
          <Btn
            variant={action === "topup" ? "solid" : "danger"}
            disabled={busy || !value || reference.trim().length < 3 || (action === "draw" && value > drawHeadroom)}
            onClick={submit}
          >
            {busy ? "Working…" : action === "topup" ? "Record top-up" : "Record draw"}
          </Btn>
        </div>
      </Card>

      <Card title="All-time flows" hint="From reserve_entries — the appendix to the ledger that only the reserve writes into.">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Topped up" value={fmtUGX(m.reserve_topped_total)} tone="good" />
          <Stat label="Drawn" value={fmtUGX(m.reserve_drawn_total)} tone="warn" />
        </div>
      </Card>
    </div>
  );
}
