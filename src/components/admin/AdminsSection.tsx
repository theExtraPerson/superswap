"use client";

import { useState } from "react";
import { Btn, Card } from "@/components/ui";
import { adminGrant, adminRevoke } from "@/lib/app/adminApi";
import type { DeskApi } from "./useDesk";
import { inputCls, shortId, when } from "./parts";

/**
 * Admins — membership in the admins table IS admin. Grant by USERNAME
 * (unknown usernames become pending handles and bind automatically at
 * sign-up via app_bind_admin_handle). The SQL refuses self-revoke and
 * removing the last admin; the UI mirrors the rule but the RPC stays the
 * authority.
 */
export function AdminsSection({ desk }: { desk: DeskApi }) {
  const [username, setUsername] = useState("");
  const dash = desk.dash;
  const selfId = dash?.actor?.user_id ?? null;
  const canRevoke = (dash?.admins.length ?? 0) > 1;

  const grant = async () => {
    const value = username.trim().toLowerCase();
    if (!value) return;
    const done = await desk.mutate("Grant admin", (cfg) => adminGrant(value, cfg), () =>
      setUsername("")
    );
    if (done) desk.reload();
  };

  const revoke = async (userId: string) => {
    await desk.mutate("Revoke admin", (cfg) => adminRevoke(userId, cfg));
  };

  return (
    <div className="space-y-4">
      <Card title="Roster" hint="Every admin action you take here is logged in the audit trail with YOUR username.">
        <ul className="divide-y divide-[#1d2c55] text-sm">
          {(dash?.admins ?? []).map((a) => (
            <li key={a.user_id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <span className="font-bold">{a.username ?? a.handle}</span>
                {a.display_name && <span className="ml-2 text-[#9fb3e8]">{a.display_name}</span>}
                <span className="ml-2 text-[#6b7fae]">
                  {shortId(a.user_id)} · since {when(a.created_at)}
                  {a.user_id === selfId && " · you"}
                </span>
              </div>
              {a.user_id !== selfId && (
                <Btn variant="danger" disabled={!canRevoke} onClick={() => revoke(a.user_id)}>
                  Revoke
                </Btn>
              )}
            </li>
          ))}
        </ul>
        {!canRevoke && (dash?.admins.length ?? 0) <= 1 && (
          <p className="mt-2 text-[12px] text-amber-400">
            Only one admin remains — revocation is blocked in SQL until another is granted.
          </p>
        )}
      </Card>

      {(dash?.pending_handles.length ?? 0) > 0 && (
        <Card title="Pending grants" hint="Usernames queued before their account exists — they bind automatically on first sign-up.">
          <ul className="space-y-1 text-sm">
            {(dash?.pending_handles ?? []).map((h) => (
              <li key={h.handle} className="flex justify-between">
                <span className="font-bold">@{h.handle}</span>
                <span className="text-[#6b7fae]">queued {when(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Grant admin" hint="Enter a member's username; unknown usernames become pending handles that bind at sign-up.">
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="operator_username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Btn disabled={!username.trim()} onClick={grant}>Grant</Btn>
        </div>
      </Card>
    </div>
  );
}
