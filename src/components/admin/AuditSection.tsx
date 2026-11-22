"use client";

import { Card } from "@/components/ui";
import type { DeskApi } from "./useDesk";
import { when } from "./parts";

/** Audit — the append-only trail; the dashboard already carries the last 50. */
export function AuditSection({ desk }: { desk: DeskApi }) {
  const rows = desk.dash?.audit ?? [];

  return (
    <Card title="Audit trail" hint="Append-only. Every guarded mutation writes one of these — including grants, revokes, settlement and setting edits.">
      {rows.length === 0 ? (
        <p className="text-sm text-[#6b7fae]">No admin actions recorded yet.</p>
      ) : (
        <ul className="divide-y divide-[#1d2c55] text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
              <div className="min-w-0">
                <span className="font-bold text-[#f5b301]">{r.action}</span>
                {r.target && <span className="ml-2 text-[#6b7fae]">{r.target}</span>}
                {r.detail && <div className="truncate text-[12px] text-[#9fb3e8]">{r.detail}</div>}
              </div>
              <div className="text-right text-[11px] text-[#6b7fae]">
                @{r.actor_username}
                <div>{when(r.created_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
