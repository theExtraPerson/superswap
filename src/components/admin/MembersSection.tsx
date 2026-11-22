"use client";

import { useState } from "react";
import { Btn, Card } from "@/components/ui";
import { adminMember, adminAdjustWallet, adminSetBan } from "@/lib/app/adminApi";
import type { AdminMemberPayload } from "@/lib/api/types";
import { fmtDateTime, fmtUGX } from "@/lib/format";
import type { DeskApi } from "./useDesk";
import { inputCls, shortId, when } from "./parts";

/** Members — searchable list; detail with wallet correction + ban/unban.
 *  Positive corrections are reserve-gated in SQL: no minting from thin air. */
export function MembersSection({ desk }: { desk: DeskApi }) {
  const [q, setQ] = useState(desk.search);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminMemberPayload | null>(null);

  const open = async (userId: string) => {
    setOpenId(userId);
    setDetail(null);
    try {
      setDetail(await adminMember(userId, desk.cfg));
    } catch (e) {
      desk.setErrorMsg(`Member detail: ${(e as Error).message}`);
      setOpenId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Members" hint="Search by username, name, phone, referral code or user id.">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            desk.setSearch(q.trim());
          }}
        >
          <input
            className={inputCls}
            placeholder="Search members…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Btn variant="solid" onClick={() => desk.setSearch(q.trim())}>
            Search
          </Btn>
        </form>
        <ul className="mt-3 divide-y divide-[#1d2c55]">
          {(desk.dash?.members ?? []).map((p) => (
            <li key={p.user_id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <button className="text-left" onClick={() => open(p.user_id)}>
                <span className="font-bold text-[#f5b301]">@{p.username}</span>
                <span className="ml-2 text-[#9fb3e8]">{p.display_name}</span>
                <span className="ml-2 text-[#6b7fae]">{p.phone} · joined {when(p.created_at)}</span>
                {p.is_banned && <span className="ml-2 rounded bg-red-900 px-1.5 text-[10px] font-bold text-red-200">BANNED</span>}
              </button>
              <span className="tabular-nums text-[#9fb3e8]">{fmtUGX(p.wallet_balance)}</span>
            </li>
          ))}
          {desk.dash && desk.dash.members.length === 0 && (
            <li className="py-3 text-sm text-[#6b7fae]">No members match “{desk.search}”.</li>
          )}
        </ul>
      </Card>

      {openId && detail && (
        <MemberDetail desk={desk} detail={detail} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function MemberDetail({
  desk,
  detail,
  onClose,
}: {
  desk: DeskApi;
  detail: AdminMemberPayload;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const p = detail.profile;
  if (!p)
    return (
      <Card title="Member">
        <p className="text-sm text-[#6b7fae]">Profile not found — closed from the list.</p>
        <Btn className="mt-2" variant="ghost" onClick={onClose}>Close</Btn>
      </Card>
    );

  const adjust = async (sign: 1 | -1) => {
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0) {
      desk.setErrorMsg("Adjustment: enter a non-zero amount.");
      return;
    }
    const done = await desk.mutate("Adjust wallet", (cfg) =>
      adminAdjustWallet(p.user_id, sign * Math.abs(value), reason, cfg)
    );
    if (done) {
      setDelta("");
      setReason("");
      onClose();
    }
  };

  const toggleBan = async () => {
    const done = await desk.mutate(p.is_banned ? "Unban" : "Ban", (cfg) =>
      adminSetBan(p.user_id, !p.is_banned, reason.trim() || "Desk action", cfg)
    );
    if (done) onClose();
  };

  return (
    <Card
      title={`Member @${p.username}`}
      hint={`${p.display_name} · ${p.phone} · code ${p.referral_code} · ${shortId(p.user_id)}`}
      className="border-[#3b5bb5]"
    >
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><span className="text-[#6b7fae]">Wallet</span><div className="font-bold tabular-nums">{fmtUGX(p.wallet_balance)}</div></div>
        <div><span className="text-[#6b7fae]">Open vaults</span><div className="font-bold tabular-nums">{detail.cycles.filter((c) => c.status === "open").length}</div></div>
        <div><span className="text-[#6b7fae]">Referred by</span><div className="font-bold">{detail.referrer ? `@${detail.referrer.username}` : "—"}</div></div>
        <div><span className="text-[#6b7fae]">Joined</span><div className="font-bold">{when(p.created_at)}</div></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input className={`${inputCls} !w-32`} placeholder="Amount" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} />
        <input className={`${inputCls} flex-1 min-w-40`} placeholder="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Btn variant="solid" onClick={() => adjust(1)} disabled={reason.trim().length < 3}>+ Credit</Btn>
        <Btn variant="danger" onClick={() => adjust(-1)} disabled={reason.trim().length < 3}>− Debit</Btn>
        <Btn variant="ghost" onClick={toggleBan}>{p.is_banned ? "Unban" : "Ban"}</Btn>
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
      <p className="mt-1 text-[11px] text-[#42557f]">
        Credits are refused if the reserve would stop covering all obligations — fund the reserve first.
      </p>

      {detail.cycles.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Vault cycles</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {detail.cycles.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span>
                  {c.product_name ?? "vault"} · {fmtUGX(c.principal)} → {fmtUGX(c.payout_total)}
                </span>
                <span className={c.status === "open" ? "text-emerald-400" : "text-[#6b7fae]"}>
                  {c.status} · matures {when(c.matures_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(detail.deposits.length > 0 || detail.withdrawals.length > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Deposits</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {detail.deposits.slice(0, 10).map((x) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <span>{fmtUGX(x.amount)}</span>
                  <span className="text-[#6b7fae]">{x.status} · {when(x.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Withdrawals</h4>
            <ul className="mt-1 space-y-1 text-sm">
              {detail.withdrawals.slice(0, 10).map((x) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <span>{fmtUGX(x.payout_amount)}</span>
                  <span className="text-[#6b7fae]">{x.status} · {when(x.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-4">
        <h4 className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Ledger (latest)</h4>
        <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-sm">
          {detail.ledger.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="text-[#9fb3e8]">{l.kind} · {l.note ?? ""} · {fmtDateTime(l.created_at)}</span>
              <span className={`tabular-nums ${Number(l.amount) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {Number(l.amount) >= 0 ? "+" : ""}{fmtUGX(l.amount)}
              </span>
            </li>
          ))}
          {detail.ledger.length === 0 && <li className="text-[#6b7fae]">Empty.</li>}
        </ul>
      </div>
    </Card>
  );
}
