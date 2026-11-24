"use client";

// The admin desk shell — privilege gate + section tabs. The gate is not
// decoration: /api/admin/* answers 401/403 straight from Postgres
// (session + app_admin_guard), and this UI just reacts to that.

import { useState } from "react";
import Link from "next/link";
import { Btn, Card } from "@/components/ui";
import { brand } from "@/lib/brand";
import { signOutBrowser } from "@/lib/app/session";
import { useDesk } from "./useDesk";
import { OverviewSection } from "./OverviewSection";
import { QueuesSection } from "./QueuesSection";
import { MembersSection } from "./MembersSection";
import { ProductsSection } from "./ProductsSection";
import { SettingsSection } from "./SettingsSection";
import { AdminsSection } from "./AdminsSection";
import { AuditSection } from "./AuditSection";
import { SignInCard } from "./SignInCard";

type DeskTab = "overview" | "queues" | "members" | "products" | "settings" | "admins" | "audit";

const TABS: { id: DeskTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "queues", label: "Queues" },
  { id: "members", label: "Members" },
  { id: "products", label: "Vaults" },
  { id: "settings", label: "Settings" },
  { id: "admins", label: "Admins" },
  { id: "audit", label: "Audit" },
];

export function AdminDesk() {
  const desk = useDesk();
  const [tab, setTab] = useState<DeskTab>("overview");

  const paused = desk.dash?.settings?.platform_paused === "true";
  const pending =
    (desk.dash?.metrics.pending_deposits ?? 0) + (desk.dash?.metrics.pending_withdrawals ?? 0);

  return (
    <div className="min-h-dvh text-[#f6f8ff]">
      <div className="mx-auto max-w-3xl px-4 pb-24">
        <header className="py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black tracking-tight">
              {brand.name} <span className="text-[#45e9ff]">Ops Desk</span>
            </h1>
            <p className="text-[11px] text-[#92a0b9]">
              Guarded by table membership · every mutation audited
            </p>
          </div>
          <div className="flex items-center gap-2">
            {desk.dash && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  paused ? "bg-red-900 text-red-200" : "bg-emerald-900 text-emerald-300"
                }`}
              >
                {paused ? "PAUSED" : "RUNNING"}
              </span>
            )}
            <Link href="/app" className="text-sm text-[#c3cfe4] underline">
              ← Desk
            </Link>
          </div>
        </header>

        {desk.errorMsg && (
          <div className="mb-3 rounded-xl border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">
            {desk.errorMsg}
          </div>
        )}

        {desk.loading && desk.isAdmin === null ? (
          <p className="text-sm text-[#92a0b9]">Checking your access…</p>
        ) : desk.isAdmin === false && desk.gate === "auth" ? (
          <SignInCard desk={desk} />
        ) : desk.isAdmin === false ? (
          <Card title="No desk for you" hint="The RPC answered 403 FORBIDDEN — your account is not in the admins table.">
            <p className="text-sm text-[#c3cfe4]">
              Sign in with an operator account (bootstrapped in <code>admin.sql</code> or granted on
              the Admins tab by an existing admin).
            </p>
            <Btn className="mt-3" variant="ghost" onClick={desk.reload}>
              ↻ Retry
            </Btn>
          </Card>
        ) : (
          <>
            <nav className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-[#080d19]/90 backdrop-blur-md border-b border-[#17233a] flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    tab === t.id
                      ? "bg-[linear-gradient(95deg,#23c8f0,#6a5cff_60%,#b03dff)] text-white shadow-[0_6px_16px_-8px_rgba(106,92,255,0.9)]"
                      : "text-[#c3cfe4] hover:bg-[#16233d]"
                  }`}
                >
                  {t.label}
                  {t.id === "queues" && pending > 0 && (
                    <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                      {pending}
                    </span>
                  )}
                </button>
              ))}
              <span className="ml-auto self-center flex gap-1">
                <Btn variant="ghost" onClick={desk.reload}>↻</Btn>
                <Btn
                  variant="ghost"
                  onClick={async () => {
                    await signOutBrowser();
                    desk.reload();
                  }}
                >
                  Sign out
                </Btn>
              </span>
            </nav>

            <div className="pt-4">
              {tab === "overview" && <OverviewSection desk={desk} />}
              {tab === "queues" && <QueuesSection desk={desk} />}
              {tab === "members" && <MembersSection desk={desk} />}
              {tab === "products" && <ProductsSection desk={desk} />}
              {tab === "settings" && <SettingsSection desk={desk} />}
              {tab === "admins" && <AdminsSection desk={desk} />}
              {tab === "audit" && <AuditSection desk={desk} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
