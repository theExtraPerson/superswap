"use client";

// Money in/out tab: queued deposits and withdrawals with references.
// Nothing here touches the balance directly — an operator confirms the real
// money movement, and the ledger follows (see admin.sql settlement).

import { useState } from "react";
import { newIdemKey, openDeposit, openWithdrawal } from "@/lib/app/api";
import { fmtDateTime, fmtRate, fmtUGX } from "@/lib/format";
import type { DepositRow, WithdrawalRow } from "@/lib/api/types";
import { Banner, Field, input } from "./parts";
import type { MemberDeskApi } from "./useMemberDesk";

type Channel = "momo" | "bank";

export function MoneySection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");

  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<Channel>("momo");
  const [account, setAccount] = useState("");
  const [reference, setReference] = useState("");

  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const feePct = Number(d.rules.withdrawal_fee_percent);
  const fee = mode === "withdraw" ? Math.round((value * feePct) / 100 * 100) / 100 : 0;
  const min = mode === "deposit" ? Number(d.rules.min_deposit) : Number(d.rules.min_withdrawal);

  async function submit() {
    if (!value || !account.trim()) return;
    const okDone =
      mode === "deposit"
        ? await desk.mutate(() =>
            openDeposit({
              amount: value,
              channel,
              payerAccount: account.trim(),
              reference: reference.trim() || undefined,
              idemKey: newIdemKey("dep"),
            })
          )
        : await desk.mutate(() =>
            openWithdrawal({
              amount: value,
              channel,
              destinationAccount: account.trim(),
              idemKey: newIdemKey("wd"),
            })
          );
    if (okDone) {
      setAmount("");
      setReference("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {(["deposit", "withdraw"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-2 text-xs font-bold ${
              mode === m ? "bg-[#f5b301] text-[#1a1400]" : "border border-[#2b3f6f] text-[#9fb3e8]"
            }`}
          >
            {m === "deposit" ? "Deposit (money in)" : "Withdraw (money out)"}
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-4 flex flex-col gap-3">
        <Field title="Amount (UGX)" hint={`Minimum ${fmtUGX(min)}`}>
          <input className={input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="100000" />
        </Field>

        <Field title="Channel">
          <div className="grid grid-cols-2 gap-2">
            {(["momo", "bank"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`rounded-xl py-2 text-xs font-bold ${
                  channel === c ? "bg-[#1e3a8a] text-white" : "border border-[#2b3f6f] text-[#9fb3e8]"
                }`}
              >
                {c === "momo" ? "Mobile money" : "Bank transfer"}
              </button>
            ))}
          </div>
        </Field>

        <Field
          title={mode === "deposit" ? "Sending from (your number/account)" : "Pay out to (your number/account)"}
        >
          <input
            className={input}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={channel === "momo" ? "0772123456" : "Account number / name"}
          />
        </Field>

        {mode === "deposit" && (
          <Field title="Transfer reference (optional)" hint="e.g. the MoMo transaction ID after you send.">
            <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="S123ABC456" />
          </Field>
        )}

        {mode === "withdraw" && value > 0 && (
          <div className="text-xs text-[#9fb3e8]">
            Fee {fmtRate(feePct)} = {fmtUGX(fee)} · you receive {fmtUGX(value - fee)}
          </div>
        )}

        <Banner kind="info">
          {mode === "deposit"
            ? "Send the money to the SuperSwap merchant line (support tells you where), open this request with the reference, and an operator confirms the arrival. Your balance moves only when real money arrives."
            : "Withdrawals are queued and paid by an operator to the number/account above. Your balance is reserved the moment you request."}
        </Banner>

        <button
          onClick={submit}
          disabled={desk.busy || !value || !account.trim() || value < min}
          className="rounded-xl bg-[#f5b301] text-[#1a1400] font-black py-3 disabled:opacity-40"
        >
          {desk.busy ? "Working…" : mode === "deposit" ? "Record deposit" : "Request withdrawal"}
        </button>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#6b7fae] mb-2">Deposits</h2>
        {d.deposits.length === 0 && <p className="text-xs text-[#6b7fae]">None yet.</p>}
        <div className="space-y-2">
          {d.deposits.map((x) => (
            <Row key={`d${x.id}`} kind="deposit" row={x} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#6b7fae] mb-2">Withdrawals</h2>
        {d.withdrawals.length === 0 && <p className="text-xs text-[#6b7fae]">None yet.</p>}
        <div className="space-y-2">
          {d.withdrawals.map((x) => (
            <Row key={`w${x.id}`} kind="withdrawal" row={x} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Row({ kind, row }: { kind: "deposit" | "withdrawal"; row: DepositRow | WithdrawalRow }) {
  const status = row.status;
  const tone =
    status === "pending"
      ? "bg-amber-500/15 text-amber-300"
      : status === "confirmed" || status === "paid"
        ? "bg-emerald-500/15 text-emerald-300"
        : "bg-[#1d2c55] text-[#9fb3e8]";
  return (
    <div className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-3 flex items-center justify-between gap-2">
      <div className="text-xs">
        <div className="font-bold">{fmtUGX(row.amount)}</div>
        <div className="text-[#6b7fae] mt-0.5">
          {kind === "withdrawal" && "fee "}{kind === "withdrawal" ? fmtUGX((row as WithdrawalRow).fee_amount) : row.channel} · {fmtDateTime(row.created_at)}
        </div>
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tone}`}>{status}</span>
    </div>
  );
}
