"use client";

// The member desk shell, following the superswca.com information architecture:
// sticky blurred header with a circular profile avatar, four bottom tabs
// (Home · VIP · League · Wallet) and Profile as the avatar surface. Structure
// only — every number, rule and action still comes from useMemberDesk / the
// app_* RPCs unchanged.

import { useState } from "react";
import { useMemberDesk } from "./useMemberDesk";
import { Banner, IconHome, IconTeam, IconVault, IconWallet, type DeskTab } from "./parts";
import { HomeSection } from "./HomeSection";
import { VipSection } from "./VipSection";
import { LeagueSection } from "./LeagueSection";
import { WalletSection } from "./WalletSection";
import { ProfileSection } from "./ProfileSection";

const TABS = [
  { id: "home", label: "Home", icon: IconHome },
  { id: "vip", label: "VIP", icon: IconVault },
  { id: "league", label: "League", icon: IconTeam },
  { id: "wallet", label: "Wallet", icon: IconWallet },
] as const;

export function MemberDesk() {
  const desk = useMemberDesk();
  const [tab, setTab] = useState<DeskTab>("home");
  const go = (next: DeskTab) => setTab(next);

  if (desk.loading && !desk.data) {
    return (
      <main className="min-h-dvh text-[#f6f8ff]">
        <div className="mx-auto max-w-md px-5 py-16 text-center text-[#92a0b9]">Loading your desk…</div>
      </main>
    );
  }

  const d = desk.data;
  const initial = d
    ? (d.profile.display_name.trim()[0] ?? d.profile.username[0] ?? "?").toUpperCase()
    : "…";

  return (
    <main className="min-h-dvh flex flex-col text-[#f6f8ff]">
      {/* Header — sticky, translucent blur; the avatar opens the Profile sheet */}
      <header className="sticky top-0 z-20 border-b border-[#17233a] bg-[#080d19]/90 backdrop-blur-md">
        <div className="mx-auto max-w-md px-5 py-3 flex items-center justify-between">
          <button onClick={() => setTab("home")} className="flex flex-col text-left">
            <span className="text-[15px] font-extrabold tracking-tight">
              SUPER<span className="text-[#45e9ff]">SWAP</span>
            </span>
            {d && (
              <span className="text-[10px] text-[#92a0b9]">
                @{d.profile.username}
                {tab === "profile" ? " · profile" : ""}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab(tab === "profile" ? "home" : "profile")}
            className={`avatar-btn ${tab === "profile" ? "ring-2 ring-[#45e9ff]/70" : ""}`}
            aria-label="Open profile"
          >
            {initial}
          </button>
        </div>
      </header>

      {/* Scrollable content area */}
      <div className="flex-1 w-full">
        <div className="mx-auto max-w-md px-3 py-4 flex flex-col gap-4">
          {d?.rules.platform_paused && (
            <Banner kind="error">
              {d.rules.pause_message || "Money movement is paused for maintenance. Existing vaults keep their terms."}
            </Banner>
          )}
          {desk.error && <Banner kind="error">{desk.error}</Banner>}

          {d && tab === "home" && <HomeSection desk={desk} go={go} />}
          {d && tab === "vip" && <VipSection desk={desk} />}
          {d && tab === "league" && <LeagueSection desk={desk} />}
          {d && tab === "wallet" && <WalletSection desk={desk} />}
          {d && tab === "profile" && <ProfileSection desk={desk} go={go} />}

        </div>
      </div>

      {/* Bottom tab bar — pinned like the reference app-tabs */}
      <nav className="tab-bar sticky bottom-0 z-20">
        <div className="mx-auto max-w-md grid grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab-btn ${tab === t.id ? "tab-btn-active" : ""}`}
            >
              <t.icon />
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
