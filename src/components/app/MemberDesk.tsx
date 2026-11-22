"use client";

// The member desk shell: header, live transparency strip, tabbed sections.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";
import { fmtPct, fmtUGX } from "@/lib/format";
import { signOutBrowser } from "@/lib/app/session";
import { useMemberDesk } from "./useMemberDesk";
import { Banner } from "./parts";
import { VaultsSection } from "./VaultsSection";
import { MoneySection } from "./MoneySection";
import { HistorySection } from "./HistorySection";
import { TeamSection } from "./TeamSection";

const TABS = [
  { id: "vaults", label: "Vaults" },
  { id: "money", label: "Money in/out" },
  { id: "history", label: "History" },
  { id: "team", label: "Refer" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function MemberDesk() {
  const desk = useMemberDesk();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("vaults");

  if (desk.loading && !desk.data) {
    return (
      <main className="min-h-dvh bg-[#060b1f] text-[#e8eefc]">
        <div className="mx-auto max-w-md px-5 py-16 text-center text-[#6b7fae]">Loading your desk…</div>
      </main>
    );
  }

  const d = desk.data;
  const coverageOk = d ? Number(d.transparency.coverage_pct) >= 100 : true;

  return (
    <main className="min-h-dvh bg-[#060b1f] text-[#e8eefc] pb-16">
      <div className="mx-auto max-w-md px-5 py-6 flex flex-col gap-5">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-xl font-black tracking-tight">
              Super<span className="text-[#f5b301]">Swap</span>
            </div>
            {d && <div className="text-xs text-[#6b7fae]">Hi, {d.profile.display_name} (@{d.profile.username})</div>}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-[10px] text-[#42527c] hover:text-[#9fb3e8]">
              ops
            </Link>
            <button
              onClick={async () => {
                await signOutBrowser();
                router.replace("/login");
              }}
              className="text-xs text-[#9fb3e8] border border-[#2b3f6f] rounded-lg px-3 py-1.5 hover:bg-[#0d1733]"
            >
              Sign out
            </button>
          </div>
        </header>

        {d && (
          <section className="rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-5">
            <div className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Wallet balance</div>
            <div className="text-3xl font-black text-[#f5b301]">{fmtUGX(d.profile.wallet_balance)}</div>
            <button
              onClick={() => void desk.reload()}
              className="mt-1 text-[11px] text-[#6b7fae] hover:text-[#9fb3e8]"
            >
              ↻ refresh
            </button>
            <div
              className={`mt-3 rounded-xl px-3 py-2 text-[11px] border ${
                coverageOk
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
              }`}
            >
              Reserve coverage {fmtPct(d.transparency.coverage_pct)} — every promised payout
              {coverageOk ? " is fully funded in advance." : " is NOT fully funded (operations are blocked)."}
            </div>
          </section>
        )}

        {d?.rules.platform_paused && (
          <Banner kind="error">
            {d.rules.pause_message || "Money movement is paused for maintenance. Existing vaults keep their terms."}
          </Banner>
        )}
        {desk.error && <Banner kind="error">{desk.error}</Banner>}

        <nav className="grid grid-cols-4 gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-2 py-2 text-xs font-bold transition ${
                tab === t.id
                  ? "bg-[#f5b301] text-[#1a1400]"
                  : "border border-[#2b3f6f] text-[#9fb3e8] hover:bg-[#0d1733]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {d && tab === "vaults" && <VaultsSection desk={desk} />}
        {d && tab === "money" && <MoneySection desk={desk} />}
        {d && tab === "history" && <HistorySection desk={desk} />}
        {d && tab === "team" && <TeamSection desk={desk} />}

        <footer className="text-center text-[10px] text-[#42527c] leading-relaxed pt-2">
          {brand.complianceNote}
          {d?.rules.support_contact ? ` Support: ${d.rules.support_contact}` : ""}
        </footer>
      </div>
    </main>
  );
}
