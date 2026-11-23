"use client";

// Shared primitives for the member desk: form styling, error copy, the tab
// identity used by the shell + deep-link buttons, and the outline icon set.

import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

/** Bottom-tab identity (profile is opened from the header avatar, not the bar). */
export type DeskTab = "home" | "vip" | "league" | "wallet" | "profile";

export const input = "field";

export const label = "text-xs font-semibold text-[#c3cfe4]";

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
      {hint && <span className="text-[11px] text-[#92a0b9] mt-1 block">{hint}</span>}
    </label>
  );
}

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong. Please try again.";
}

export function Banner({ kind, children }: { kind: "error" | "ok" | "info" | "warn"; children: ReactNode }) {
  const styles = {
    error: "border-red-500/40 bg-red-500/10 text-red-300",
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    info: "border-[#2b3d5c] bg-[#101a2b] text-[#c3cfe4]",
  }[kind];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

/* ---------------------------------------------------------------------------
   Outline SVG icon set (reference icon language: 1.8px strokes, soft glow via
   currentColor). Function declarations so module-level tables can reference
   them regardless of definition order.
--------------------------------------------------------------------------- */

function IconWrap({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function IconHome() {
  return (
    <IconWrap>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10v9h11v-9" />
      <path d="M10 19v-5h4v5" />
    </IconWrap>
  );
}

export function IconVault() {
  return (
    <IconWrap>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 8.5V7M12 17v-1.5M15.5 12H17M7 12h1.5" />
    </IconWrap>
  );
}

export function IconMoney() {
  return (
    <IconWrap>
      <path d="M12 3v13" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 19h16" />
    </IconWrap>
  );
}

export function IconPayout() {
  return (
    <IconWrap>
      <path d="M12 21V8" />
      <path d="m7 13 5-5 5 5" />
      <path d="M4 5h16" />
    </IconWrap>
  );
}

export function IconHistory() {
  return (
    <IconWrap>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </IconWrap>
  );
}

export function IconTeam() {
  return (
    <IconWrap>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.2c2.4.2 4.2 1.6 4.9 3.8" />
    </IconWrap>
  );
}

export function IconWallet() {
  return (
    <IconWrap>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <rect x="3" y="7.5" width="18" height="11.5" rx="2.5" />
      <circle cx="16.5" cy="13.25" r="1.2" />
    </IconWrap>
  );
}

export function IconGift() {
  return (
    <IconWrap>
      <rect x="4" y="9" width="16" height="11" rx="1.8" />
      <path d="M4 13h16M12 9v11" />
      <path d="M12 9c-2.5 0-4.5-.6-4.5-2.5A2 2 0 0 1 9.5 4.5C11 4.8 12 6.5 12 9Zm0 0c2.5 0 4.5-.6 4.5-2.5A2 2 0 0 0 14.5 4.5C13 4.8 12 6.5 12 9Z" />
    </IconWrap>
  );
}

export function IconLife() {
  return (
    <IconWrap>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="m14.8 14.8 4.2 4.2M9.2 14.8 5 19M14.8 9.2l4.2-4.2M9.2 9.2 5 5" />
    </IconWrap>
  );
}

export function IconChevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
