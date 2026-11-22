"use client";

// Refer tab: own referral code + attributed members + earned rewards.
// Attribution only, one level, flat operator-funded reward — no chain
// commissions, ever.

import { useEffect, useState } from "react";
import { fmtDate, fmtUGX } from "@/lib/format";
import { getTeam } from "@/lib/app/api";
import { browserApiConfig } from "@/lib/app/session";
import type { TeamPayload } from "@/lib/api/types";
import type { MemberDeskApi } from "./useMemberDesk";

export function TeamSection({ desk }: { desk: MemberDeskApi }) {
  const d = desk.data!;
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
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

  const link =
    typeof window !== "undefined" && d
      ? `${window.location.origin}/register?code=${d.profile.referral_code}`
      : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const reward = Number(team?.reward_amount ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-4">
        <div className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Your referral code</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <code className="text-2xl font-black tracking-widest text-[#f5b301]">
            {d.profile.referral_code}
          </code>
          <button
            onClick={copy}
            className="text-xs border border-[#2b3f6f] rounded-lg px-3 py-2 text-[#9fb3e8] hover:bg-[#12204a]"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
        <p className="text-[11px] text-[#6b7fae] mt-2 leading-relaxed">
          Friends join with your code in their link — it is auto-filled at sign-up.
          {reward > 0
            ? ` You earn ${fmtUGX(reward)} once, when their first deposit is confirmed.`
            : " Referring earns recognition, not recruitment commissions."}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#6b7fae] mb-2">
          Members you brought
        </h2>
        {!team || team.members.length === 0 ? (
          <p className="text-xs text-[#6b7fae]">Nobody yet.</p>
        ) : (
          <div className="space-y-2">
            {team.members.map((m) => (
              <div
                key={m.name + m.joined_at}
                className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-3 flex items-center justify-between text-xs"
              >
                <div className="font-bold">{m.name}</div>
                <div className="text-[#6b7fae]">
                  joined {fmtDate(m.joined_at)}
                  {m.first_deposit_at ? ` · first deposit ${fmtDate(m.first_deposit_at)}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        {team && Number(team.referral_credits) > 0 && (
          <div className="mt-2 text-xs text-emerald-300">
            Rewards earned: {fmtUGX(team.referral_credits)}
          </div>
        )}
      </section>
    </div>
  );
}
