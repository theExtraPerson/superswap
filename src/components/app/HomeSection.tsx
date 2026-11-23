"use client";

// Home tab — the desk's front page, structured like the reference app:
// wallet hero with live coverage, a sliding highlights carousel, the daily
// check-in strip (app_checkin, overlay-funded), quick-action orbs and a
// recent-activity feed. Every number still comes from app_dashboard; the
// claim rides /api/checkin → Postgres. Nothing here decides money.

import { useEffect, useRef, useState, type JSX } from "react";
import { dailyCheckin } from "@/lib/app/api";
import { browserApiConfig } from "@/lib/app/session";
import { fmtPct, fmtUGX, fmtWindow } from "@/lib/format";
import {
  IconGift,
  IconLife,
  IconMoney,
  IconPayout,
  IconTeam,
  IconVault,
  type DeskTab,
} from "./parts";
import { LedgerRowItem } from "./HistorySection";
import type { MemberDeskApi } from "./useMemberDesk";

export function HomeSection({ desk, go }: { desk: MemberDeskApi; go: (tab: DeskTab) => void }) {
  const d = desk.data!;
  const coverageOk = Number(d.transparency.coverage_pct) >= 100;

  return (
    <div className="flex flex-col gap-4">
      {/* Wallet hero — balance + the coverage promise, one glance */}
      <section className="hero-wallet p-5">
        <div className="text-[11px] uppercase tracking-wide text-white/70">Wallet balance</div>
        <div className="money-hero mt-1 text-white">{fmtUGX(d.profile.wallet_balance)}</div>
        <button onClick={() => void desk.reload()} className="mt-2 text-[11px] text-white/70 hover:text-white">
          ↻ refresh
        </button>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-white/80">
            <span>Reserve coverage</span>
            <span className="font-bold">{fmtPct(d.transparency.coverage_pct)}</span>
          </div>
          <div className="progress mt-1.5 !bg-black/25 !border-white/15">
            <span style={{ width: `${Math.min(100, Number(d.transparency.coverage_pct) || 0)}%` }} />
          </div>
          <div className="mt-1.5 text-[10.5px] text-white/70 leading-snug">
            {coverageOk
              ? "Every promised payout is fully funded in advance."
              : "Coverage is short — money movement is blocked until the reserve is topped up."}
          </div>
        </div>
      </section>

      <Highlights desk={desk} />
      <CheckIn desk={desk} />

      {/* Quick actions */}
      <nav className="grid grid-cols-4 justify-items-center gap-0.5">
        <Orb tone="orb-cyan" label="Deposit" Icon={IconMoney} onClick={() => go("wallet")} />
        <Orb tone="orb-rose" label="Withdraw" Icon={IconPayout} onClick={() => go("wallet")} />
        <Orb tone="orb-violet" label="Vaults" Icon={IconVault} onClick={() => go("vip")} />
        <Orb tone="orb-emerald" label="Refer" Icon={IconTeam} onClick={() => go("league")} />
      </nav>

      {/* Recent activity — same ledger rows the Wallet tab shows in full */}
      <section className="card-grad p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9]">Recent activity</h2>
          <button onClick={() => go("wallet")} className="text-[11px] text-[#45e9ff] font-semibold">
            See all
          </button>
        </div>
        {d.ledger.length === 0 ? (
          <p className="text-xs text-[#92a0b9]">Nothing yet — your first deposit or bonus will appear here.</p>
        ) : (
          <div className="space-y-2">
            {d.ledger.slice(0, 5).map((l) => (
              <LedgerRowItem key={l.id} row={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- carousel */

function Highlights({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  const [idx, setIdx] = useState(0);
  const touchX = useRef<number | null>(null);

  const slides: { title: string; body: string; Icon: () => JSX.Element }[] = [];
  const bonus = Number(d.rules.signup_bonus ?? 0);
  if (bonus > 0)
    slides.push({
      title: `Welcome bonus ${fmtUGX(bonus)}`,
      body: `Credited once at first sign-in. Minimum deposit ${fmtUGX(d.rules.min_deposit)} · minimum withdrawal ${fmtUGX(d.rules.min_withdrawal)}.`,
      Icon: IconGift,
    });
  const pct = Number(d.rules.referral_commission_percent ?? 0);
  const pctL2 = Number(d.rules.referral_commission_l2_percent ?? 0);
  if (pct > 0)
    slides.push({
      title: `Invite and earn ${fmtPct(pct)}${pctL2 > 0 ? ` + ${fmtPct(pctL2)}` : ""}`,
      body:
        pctL2 > 0
          ? `Two generations: you earn ${fmtPct(pct)} on every deposit your invites make, plus ${fmtPct(pctL2)} on every deposit the people they invite make — credited when a deposit is confirmed.`
          : `You earn ${fmtPct(pct)} on every deposit the members you brought in make, credited when it is confirmed.`,
      Icon: IconTeam,
    });
  slides.push({
    title: `Reserve coverage ${fmtPct(d.transparency.coverage_pct)}`,
    body: `Real reserve ${fmtUGX(d.transparency.reserve_balance)} against ${fmtUGX(d.transparency.obligations)} of promises. Watch it live — it never drops below 100%.`,
    Icon: IconVault,
  });
  const windowLabel = fmtWindow(d.rules.withdraw_window_from, d.rules.withdraw_window_to, d.rules.timezone);
  slides.push({
    title: "Withdrawals open daily",
    body: windowLabel ? `Requests are taken ${windowLabel} on the platform clock. Payouts are queued and paid by an operator.` : "Withdrawal requests are queued and paid by an operator.",
    Icon: IconLife,
  });

  // Autoplay. State updates land inside the interval callback (async), never
  // during the effect body — restarting only when the slide count changes is
  // intentional; contents refreshing with the payload is noise. [eslint: the
  // exhaustive-deps rule stays silent because slides.length is a primitive.]
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 5000);
    return () => clearInterval(t);
  }, [slides.length]);

  const n = slides.length;
  const at = (i: number) => ((i % n) + n) % n;

  return (
    <section aria-label="Highlights" className="overflow-hidden">
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${idx * 100}%)` }}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (start === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (dx < -40) setIdx((i) => at(i + 1));
          else if (dx > 40) setIdx((i) => at(i - 1));
        }}
      >
        {slides.map((s) => (
          <div key={s.title} className="w-full shrink-0">
            <div className="card-grad p-4 flex items-start gap-3">
              <span className="orb orb-cyan shrink-0 !w-11 !h-11">
                <s.Icon />
              </span>
              <div>
                <div className="text-sm font-bold">{s.title}</div>
                <div className="text-[11px] text-[#c3cfe4] mt-1 leading-relaxed">{s.body}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {slides.map((s, i) => (
            <button
              key={s.title}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-[#45e9ff]" : "w-1.5 bg-[#2b3d5c]"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- check-in */

function CheckIn({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  const ci = d.checkin;
  if (!ci || Number(ci.bonus) <= 0) return null; // feature off (or live DB not migrated yet)

  const bonus = Number(ci.bonus);
  const streak = Number(ci.streak ?? 0);
  // Position inside the rolling 7-day strip.
  const weekDone = ci.claimed_today ? ((Math.max(streak, 1) - 1) % 7) + 1 : streak % 7;

  async function claim() {
    await desk.mutate(() => dailyCheckin(browserApiConfig()));
  }

  return (
    <section className="card-grad p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9]">Daily check-in</h2>
        <span className="text-[10.5px] text-[#5d6f93]">Resets at midnight</span>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, k) => {
          const day = k + 1;
          const done = day <= weekDone;
          const isNext = !ci.claimed_today && day === weekDone + 1;
          return (
            <div
              key={day}
              className={`rounded-xl px-1 py-2 text-center border ${
                done
                  ? "border-[#0bcee5]/60 bg-[#45e9ff]/10 text-[#45e9ff]"
                  : isNext
                    ? "border-[#b03dff]/70 bg-[#8b5cff]/10 text-[#d9c8ff]"
                    : "border-[#20304a] bg-[#0c1626] text-[#5d6f93]"
              }`}
            >
              <div className="text-[9px] uppercase font-bold">Day {day}</div>
              <div className="text-[10px] font-black mt-0.5 tabular-nums">
                {done ? "✓" : `+${bonus >= 1000 ? `${Math.round(bonus / 1000)}k` : bonus}`}
              </div>
              <div className="text-[8px] leading-none">{done ? "claimed" : "UGX"}</div>
            </div>
          );
        })}
      </div>

      <button
        onClick={claim}
        disabled={desk.busy || ci.claimed_today}
        className={`mt-3 w-full py-3 rounded-xl text-sm ${ci.claimed_today ? "btn-ghost-grad font-semibold" : "btn-cta"}`}
      >
        {ci.claimed_today
          ? `Checked in ✓ (+${fmtUGX(bonus)})`
          : desk.busy
            ? "Working…"
            : `Check in · +${fmtUGX(bonus)}`}
      </button>
      <p className="text-[10.5px] text-[#92a0b9] mt-2 text-center">
        {streak > 0
          ? `${streak}-day streak — come back every day. Reward is operator-funded and follows the same rules as the welcome bonus.`
          : "One tap a day, one small reward a day. Miss a day and the streak restarts."}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------- orb */

function Orb({
  tone,
  label,
  Icon,
  onClick,
}: {
  tone: string;
  label: string;
  Icon: () => JSX.Element;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 py-1">
      <span className={`orb ${tone}`}>
        <Icon />
      </span>
      <span className="text-[10.5px] font-semibold text-[#c3cfe4]">{label}</span>
    </button>
  );
}
