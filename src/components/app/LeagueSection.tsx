"use client";

// League tab — the invite & team page, laid out like the reference: a league
// header with rank-style stats (invited / level 2 / active / commission), the
// code + share card, and BOTH league rosters with what each person earned:
// level 1 (members you invited) and level 2 (members they invited).
// Two generations: you earn a percent of every deposit your direct invites (L1)
// make, and a smaller percent of every deposit their invites (L2) make.

import { useEffect, useState } from "react";
import { fmtDate, fmtRate, fmtUGX } from "@/lib/format";
import { getTeam } from "@/lib/app/api";
import { browserApiConfig } from "@/lib/app/session";
import { brand } from "@/lib/brand";
import type { TeamPayload } from "@/lib/api/types";
import type { MemberDeskApi } from "./useMemberDesk";

export function LeagueSection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    // Data arrives asynchronously, so the setState lands in the .then callback.
    getTeam(browserApiConfig())
      .then((t) => {
        if (alive) setTeam(t);
      })
      .catch(() => {
        /* the dashboard already carries the code; team list is bonus */
      });
    return () => {
      alive = false;
    };
  }, [d.profile.referral_code]);

  // Built on demand, never during render: the origin only exists in the browser,
  // and the code is read straight from the profile so the link, the card and the
  // value POST /api/auth/register validates are the same string.
  const inviteLink = () => `${window.location.origin}/register?code=${d.profile.referral_code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  /**
   * Native share sheet where the device has one (Android/iOS: WhatsApp, SMS, …).
   * Only the URL travels — the preview card, and therefore the code inside it,
   * is rendered by /register's Open Graph tags on the receiving end.
   */
  async function share() {
    const url = inviteLink();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `Join me on ${brand.name}`,
          text: `My ${brand.name} invite code is ${d.profile.referral_code} — ${brand.tagline}`,
          url,
        });
        return;
      } catch (err) {
        // Sheet dismissed: leave it at that, don't overwrite the clipboard.
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    await copy();
  }

  const commissionPct = Number(team?.commission_percent ?? d.rules.referral_commission_percent ?? 0);
  const commissionL2Pct = Number(team?.commission_l2_percent ?? d.rules.referral_commission_l2_percent ?? 0);
  const bonus = Number(team?.signup_bonus ?? d.rules.signup_bonus ?? 0);
  const members = team?.members ?? [];
  const activeCount = members.filter((m) => m.first_deposit_at).length;
  const credits = Number(team?.referral_credits ?? 0);
  const creditsL2 = Number(team?.referral_credits_l2 ?? 0);
  const l2Members = Number(team?.l2_members ?? 0);
  // The full second-generation roster once the DB ships it; the count stays a
  // fallback for a live database that has not run the league migration yet.
  const l2Team = team?.team_l2 ?? [];
  const l2Count = l2Team.length > 0 ? l2Team.length : l2Members;

  return (
    <div className="flex flex-col gap-4">
      {/* League header — rank-style, built from real referral numbers only */}
      <section className="hero-wallet p-5">
        <div className="text-[11px] uppercase tracking-wide text-white/70">Your league</div>
        <div className="mt-1 text-lg font-black text-white">
          {activeCount > 0 ? "Team builder" : "Rookie"}
          <span className="text-[11px] font-semibold text-white/70 block mt-0.5">
            {commissionPct > 0
            ? commissionL2Pct > 0
              ? `Earning ${fmtRate(commissionPct)} on your invites' deposits · ${fmtRate(commissionL2Pct)} on their invites' deposits`
              : `Earning ${fmtRate(commissionPct)} on every deposit your invites make`
            : "Referring earns recognition, not recruitment commissions"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-black/25 border border-white/10 px-1 py-2">
            <div className="text-base font-black text-white tabular-nums">{members.length}</div>
            <div className="text-[9.5px] uppercase tracking-wide text-white/60">Invited</div>
          </div>
          <div className="rounded-xl bg-black/25 border border-white/10 px-1 py-2">
            <div className="text-base font-black text-white tabular-nums">{l2Count}</div>
            <div className="text-[9.5px] uppercase tracking-wide text-white/60">Level 2</div>
          </div>
          <div className="rounded-xl bg-black/25 border border-white/10 px-1 py-2">
            <div className="text-base font-black text-white tabular-nums">{activeCount}</div>
            <div className="text-[9.5px] uppercase tracking-wide text-white/60">Active</div>
          </div>
          <div className="rounded-xl bg-black/25 border border-white/10 px-1 py-2">
            <div className="text-sm font-black text-white tabular-nums">{fmtUGX(credits + creditsL2)}</div>
            <div className="text-[9.5px] uppercase tracking-wide text-white/60">Commission</div>
          </div>
        </div>
      </section>

      {/* Invite card */}
      <section className="card-grad p-4">
        <div className="text-[11px] uppercase tracking-wide text-[#92a0b9]">Your referral code</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <code className="text-2xl font-black tracking-widest text-[#45e9ff]">
            {d.profile.referral_code}
          </code>
          <div className="flex items-center gap-2">
            <button onClick={share} className="btn-cta text-xs rounded-xl px-4 py-2.5">
              Share
            </button>
            <button onClick={copy} className="btn-ghost-grad text-xs rounded-xl px-4 py-2.5 font-semibold">
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-[#92a0b9] mt-2 leading-relaxed">
          Friends join with your code in their link — it is auto-filled at sign-up.
          {commissionPct > 0 ? ` You earn ${fmtRate(commissionPct)} of every deposit they make` : ""}
          {commissionL2Pct > 0 ? `, plus ${fmtRate(commissionL2Pct)} of every deposit the people they invite make.` : "."}
          {bonus > 0 ? ` New members also start with a ${fmtUGX(bonus)} welcome bonus.` : ""}
        </p>
      </section>

      {/* Invited members table — level 1, then the level-2 league below */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">
          Level 1 · members you invited
        </h2>
        {members.length === 0 ? (
          <p className="text-xs text-[#92a0b9]">
            Nobody yet. Share your code — invited members show up here with what they&apos;ve earned you.
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.name + m.joined_at}
                className="card-grad !rounded-xl p-3 flex items-center justify-between gap-2 text-xs"
              >
                <div className="font-bold">{m.name}</div>
                <div className="text-right text-[#92a0b9]">
                  <div>
                    joined {fmtDate(m.joined_at)}
                    {m.first_deposit_at ? ` · first deposit ${fmtDate(m.first_deposit_at)}` : ""}
                  </div>
                  {Number(m.deposited_total ?? 0) > 0 && (
                    <div className="mt-0.5">
                      deposited {fmtUGX(m.deposited_total ?? 0)}
                      {Number(m.commission_earned ?? 0) > 0 && (
                        <span className="text-emerald-300"> · you earned {fmtUGX(m.commission_earned ?? 0)}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {l2Team.length > 0 && (
          <>
            <h2 className="mt-4 text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">
              Level 2 · brought in by your invites
            </h2>
            <div className="space-y-2">
              {l2Team.map((m) => (
                <div
                  key={m.name + m.joined_at}
                  className="card-grad !rounded-xl p-3 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold">{m.name}</div>
                    {m.invited_by && (
                      <div className="text-[10px] text-[#92a0b9]">via {m.invited_by}</div>
                    )}
                  </div>
                  <div className="text-right text-[#92a0b9]">
                    <div>
                      joined {fmtDate(m.joined_at)}
                      {m.first_deposit_at ? ` · first deposit ${fmtDate(m.first_deposit_at)}` : ""}
                    </div>
                    {Number(m.deposited_total ?? 0) > 0 && (
                      <div className="mt-0.5">
                        deposited {fmtUGX(m.deposited_total ?? 0)}
                        {Number(m.commission_earned ?? 0) > 0 && (
                          <span className="text-emerald-300"> · you earned {fmtUGX(m.commission_earned ?? 0)}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {team && (credits > 0 || creditsL2 > 0 || l2Members > 0) && (
          <div className="mt-2 text-xs text-emerald-300 space-y-0.5">
            <div>1st-generation commission earned: {fmtUGX(credits)}</div>
            {creditsL2 > 0 && <div>2nd-generation commission earned: {fmtUGX(creditsL2)}</div>}
            {l2Members > 0 && (
              <div className="text-[#92a0b9]">
                {l2Members} second-generation member{l2Members === 1 ? "" : "s"} in your network.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
