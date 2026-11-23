"use client";

// Profile — opened from the circular avatar in the header (the reference's
// /profile surface): identity block, quick-jump buttons (wallet / referrals /
// team / reward history) and the settings pack: install app, change password,
// about SuperSwap, ops desk and sign out. Password change goes through
// GoTrue via /api/auth/password with the member's own session.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { brand } from "@/lib/brand";
import { fmtDate, fmtUGX } from "@/lib/format";
import { changePassword } from "@/lib/app/api";
import { browserApiConfig, signOutBrowser } from "@/lib/app/session";
import { InstallTile } from "@/components/InstallTile";
import { Banner, Field, IconChevron, input, type DeskTab } from "./parts";
import type { MemberDeskApi } from "./useMemberDesk";

export function ProfileSection({ desk, go }: { desk: MemberDeskApi; go: (tab: DeskTab) => void }) {
  const d = desk.data!;
  const router = useRouter();
  const [open, setOpen] = useState<null | "password" | "about">(null);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const initial = (d.profile.display_name.trim()[0] ?? d.profile.username[0] ?? "?").toUpperCase();
  const openCount = d.cycles.filter((c) => c.status === "open").length;

  async function onSubmitPassword() {
    setPwMsg(null);
    if (pw1.length < 8) {
      setPwMsg({ kind: "error", text: "Password must be at least 8 characters." });
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg({ kind: "error", text: "The two passwords do not match." });
      return;
    }
    setPwBusy(true);
    try {
      await changePassword({ password: pw1 }, browserApiConfig());
      setPwMsg({ kind: "ok", text: "Password changed." });
      setPw1("");
      setPw2("");
    } catch (e) {
      setPwMsg({
        kind: "error",
        text: e instanceof Error && e.message ? e.message : "Could not change your password. Try again.",
      });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Identity */}
      <section className="hero-wallet p-5 flex items-center gap-4">
        <span className="avatar-btn !w-14 !h-14 !text-2xl shrink-0">{initial}</span>
        <div className="min-w-0">
          <div className="text-lg font-black text-white leading-tight truncate">
            {d.profile.display_name}
          </div>
          <div className="text-[11px] text-white/70">@{d.profile.username}</div>
          <div className="text-[10.5px] text-white/60 mt-0.5">Member since {fmtDate(d.profile.created_at)}</div>
        </div>
      </section>

      {/* Money snapshot */}
      <section className="card-grad p-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-sm font-black tabular-nums">{fmtUGX(d.profile.wallet_balance)}</div>
          <div className="text-[9.5px] uppercase tracking-wide text-[#92a0b9] mt-0.5">Cash</div>
        </div>
        <div>
          <div className="text-sm font-black tabular-nums">{openCount}</div>
          <div className="text-[9.5px] uppercase tracking-wide text-[#92a0b9] mt-0.5">Open plans</div>
        </div>
        <div>
          <div className="text-sm font-black tabular-nums">{d.profile.referral_code}</div>
          <div className="text-[9.5px] uppercase tracking-wide text-[#92a0b9] mt-0.5">Your code</div>
        </div>
      </section>

      {/* Quick jumps — reference profile buttons */}
      <nav className="card-grad p-4 grid grid-cols-4 gap-2">
        <Quick icon={<IconTabWallet />} label="Wallet" onClick={() => go("wallet")} />
        <Quick icon={<IconTabGift />} label="Referrals" onClick={() => go("league")} />
        <Quick icon={<IconTabTeam />} label="Team" onClick={() => go("league")} />
        <Quick icon={<IconTabList />} label="Rewards" onClick={() => go("wallet")} />
      </nav>

      {/* Settings pack — install first (tile hides itself once installed) */}
      <InstallTile />

      <section className="card-grad px-4 py-1">
        <button className="settings-row" onClick={() => setOpen(open === "password" ? null : "password")}>
          <div>
            <div className="text-sm font-bold">Change password</div>
            <div className="text-[10.5px] text-[#92a0b9]">Update the secret for @{d.profile.username}</div>
          </div>
          <IconChevron />
        </button>
        {open === "password" && (
          <div className="pb-4 flex flex-col gap-3">
            {pwMsg && <Banner kind={pwMsg.kind}>{pwMsg.text}</Banner>}
            <Field title="New password" hint="At least 8 characters.">
              <input className={input} type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field title="Confirm new password">
              <input className={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </Field>
            <button onClick={onSubmitPassword} disabled={pwBusy || !pw1} className="btn-cta w-full py-3 text-sm">
              {pwBusy ? "Updating…" : "Change password"}
            </button>
          </div>
        )}

        <button className="settings-row" onClick={() => setOpen(open === "about" ? null : "about")}>
          <div>
            <div className="text-sm font-bold">About {brand.name}</div>
            <div className="text-[10.5px] text-[#92a0b9]">{brand.tagline}</div>
          </div>
          <IconChevron />
        </button>
        {open === "about" && (
          <div className="pb-4 text-[11.5px] text-[#c3cfe4] leading-relaxed">
            <p>{brand.promise}</p>
            <p className="mt-2">Rails: {brand.rails} · Currency: {brand.currency} · Market: {brand.market}.</p>
            {d.rules.support_contact && (
              <p className="mt-2">
                Support: <span className="text-[#45e9ff] font-semibold">{d.rules.support_contact}</span>
              </p>
            )}
          </div>
        )}

        <Link href="/admin" className="settings-row no-underline text-inherit">
          <div>
            <div className="text-sm font-bold">Ops desk</div>
            <div className="text-[10.5px] text-[#92a0b9]">Admin console</div>
          </div>
          <IconChevron />
        </Link>
      </section>

      <button
        onClick={async () => {
          await signOutBrowser();
          router.replace("/login");
        }}
        className="btn-ghost-grad w-full py-3.5 text-sm font-bold !text-red-300"
      >
        Sign out
      </button>
    </div>
  );
}

function Quick({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 py-1">
      <span className="orb orb-cyan !w-11 !h-11 text-[#45e9ff]">{icon}</span>
      <span className="text-[10.5px] font-semibold text-[#c3cfe4]">{label}</span>
    </button>
  );
}

/* Small filled-style profile icons (16-18px) distinct from the tab outline set. */
function IconTabWallet() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <rect x="3" y="7.5" width="18" height="11.5" rx="2.5" />
      <circle cx="16.5" cy="13.25" r="1.2" />
    </svg>
  );
}
function IconTabGift() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="9" width="16" height="11" rx="1.8" />
      <path d="M4 13h16M12 9v11" />
      <path d="M12 9c-2.5 0-4.5-.6-4.5-2.5A2 2 0 0 1 9.5 4.5C11 4.8 12 6.5 12 9Zm0 0c2.5 0 4.5-.6 4.5-2.5A2 2 0 0 0 14.5 4.5C13 4.8 12 6.5 12 9Z" />
    </svg>
  );
}
function IconTabTeam() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.2c2.4.2 4.2 1.6 4.9 3.8" />
    </svg>
  );
}
function IconTabList() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}
