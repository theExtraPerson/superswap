"use client";

// Money in/out tab. SuperSwap runs on mobile money only — Airtel Money and MTN
// MoMo. There are no bank transfers. Deposits are AUTOMATIC: opening one pushes
// a Shashura payment request to the number you entered, and your balance credits
// itself the moment you approve the PIN prompt. Anything the gateway can't take
// waits for an operator confirmation. Withdrawals always need the operator's
// settle decision. The window is a server rule on the Kampala clock; this tab
// mirrors it so members are not surprised by a refusal, while
// app_open_withdrawal stays the authority.

import { useState } from "react";
import { newIdemKey, openDeposit, openWithdrawal } from "@/lib/app/api";
import { fmtDateTime, fmtRate, fmtUGX, fmtWindow } from "@/lib/format";
import type { DepositRow, WithdrawalRow } from "@/lib/api/types";
import { Banner, Field, input } from "./parts";
import type { MemberDeskApi } from "./useMemberDesk";

// The only supported rail. Kept as a literal so the API's momo-only channel
// check and the gateway collect path stay aligned.
const CHANNEL = "momo" as const;

export function MoneySection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");

  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [collectHint, setCollectHint] = useState<string | null>(null);

  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const feePct = Number(d.rules.withdrawal_fee_percent);
  const fee = mode === "withdraw" ? Math.round((value * feePct) / 100 * 100) / 100 : 0;
  const min = mode === "deposit" ? Number(d.rules.min_deposit) : Number(d.rules.min_withdrawal);
  const windowLabel = fmtWindow(d.rules.withdraw_window_from, d.rules.withdraw_window_to, d.rules.timezone);
  const windowClosed = mode === "withdraw" && d.rules.withdrawals_open === false;

  async function submit() {
    if (!value || !account.trim()) return;
    setCollectHint(null);
    let requested = false;
    const okDone =
      mode === "deposit"
        ? await desk.mutate(async () => {
            const res = await openDeposit({
              amount: value,
              channel: CHANNEL,
              payerAccount: account.trim(),
              idemKey: newIdemKey("dep"),
            });
            requested = Boolean(res?.collect?.requested);
          })
        : await desk.mutate(() =>
            openWithdrawal({
              amount: value,
              channel: CHANNEL,
              destinationAccount: account.trim(),
              idemKey: newIdemKey("wd"),
            })
          );
    if (okDone) {
      setAmount("");
      if (mode === "deposit" && requested) {
        setCollectHint(`A payment request is on its way to ${account.trim()} — approve the PIN prompt and the deposit credits itself automatically.`);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="seg grid-cols-2">
        {(["deposit", "withdraw"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={mode === m ? (m === "deposit" ? "seg-on-a" : "seg-on-b") : ""}
          >
            {m === "deposit" ? "Deposit (money in)" : "Withdraw (money out)"}
          </button>
        ))}
      </div>

      <section className="card-grad p-4 flex flex-col gap-3">
        <Field title="Amount (UGX)" hint={`Minimum ${fmtUGX(min)}${mode === "withdraw" ? ` · fee ${fmtRate(feePct)}` : ""}`}>
          <input className={input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="100000" />
        </Field>

        <Field title="Payment method" hint="Mobile money only — Airtel Money and MTN MoMo. No bank transfers.">
          <div className="rounded-xl bg-[#0c1626] border border-[#20304a] px-3 py-2.5 text-sm font-semibold text-[#c3cfe4]">
            Airtel Money · MTN MoMo
          </div>
        </Field>

        <Field title={mode === "deposit" ? "Your mobile money number" : "Pay out to (your mobile money number)"}>
          <input
            className={input}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            inputMode="tel"
            placeholder="0772123456"
          />
        </Field>

        {mode === "withdraw" && value > 0 && (
          <div className="text-xs text-[#c3cfe4]">
            Fee {fmtRate(feePct)} = {fmtUGX(fee)} · you receive {fmtUGX(value - fee)}
          </div>
        )}

        {mode === "withdraw" && (
          <Banner kind={windowClosed ? "warn" : "info"}>
            {windowClosed
              ? `Withdrawals are closed right now — they open ${windowLabel}, daily. Deposits and vaults stay available.`
              : `Withdrawals are accepted ${windowLabel}, every day.`}
          </Banner>
        )}

        {collectHint && <Banner kind="ok">{collectHint}</Banner>}

        <Banner kind="info">
          {mode === "deposit"
            ? "Mobile money deposits settle automatically: we send a payment request to the number above, you approve the PIN, and the balance updates within seconds. If the request can't go out, an operator finishes it manually."
            : "Withdrawals are queued and paid by an operator to your mobile money number. Your balance is reserved the moment you request."}
        </Banner>

        <button
          onClick={submit}
          disabled={desk.busy || !value || !account.trim() || value < min || windowClosed}
          className="btn-cta w-full py-3.5 text-[15px]"
        >
          {desk.busy
            ? "Working…"
            : windowClosed
              ? "Closed outside withdrawal hours"
              : mode === "deposit"
                ? "Pay with Mobile Money"
                : "Request withdrawal"}
        </button>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">Deposits</h2>
        {d.deposits.length === 0 && <p className="text-xs text-[#92a0b9]">None yet.</p>}
        <div className="space-y-2">
          {d.deposits.map((x) => (
            <Row key={`d${x.id}`} kind="deposit" row={x} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">Withdrawals</h2>
        {d.withdrawals.length === 0 && <p className="text-xs text-[#92a0b9]">None yet.</p>}
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
        : "bg-[#20304a] text-[#c3cfe4]";
  return (
    <div className="card-grad !rounded-xl p-3 flex items-center justify-between gap-2">
      <div className="text-xs">
        <div className="font-bold">{fmtUGX(row.amount)}</div>
        <div className="text-[#92a0b9] mt-0.5">
          {kind === "withdrawal" && "fee "}{kind === "withdrawal" ? fmtUGX((row as WithdrawalRow).fee_amount) : row.channel} · {fmtDateTime(row.created_at)}
        </div>
      </div>
      <span className={`pill ${tone}`}>{status}</span>
    </div>
  );
}
