// Shared bits for the admin desk sections.
import type { ReactNode } from "react";

export const inputCls = "field";

export const labelCls = "text-[11px] text-[#92a0b9] uppercase tracking-wide";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
