"use client";

// Shared primitives for the member desk: form styling + error copy.

import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

export const input =
  "w-full rounded-xl bg-[#0a1430] border border-[#1d2c55] px-4 py-3 text-sm text-[#e8eefc] placeholder-[#42527c] outline-none focus:border-[#f5b301]";

export const label = "text-xs font-semibold text-[#9fb3e8]";

export function Field({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[11px] text-[#6b7fae] mt-1 block">{hint}</span>}
    </label>
  );
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong. Please try again.";
}

export function Banner({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-500/40 bg-red-500/10 text-red-300",
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    info: "border-[#2b3f6f] bg-[#0d1733] text-[#9fb3e8]",
  }[kind];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}
