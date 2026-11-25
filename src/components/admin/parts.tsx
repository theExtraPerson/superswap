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

/**
 * Interruptive modal. The desk raises it ONLY for a deposit whose gateway
 * attempt actually failed — a healthy request merely waiting on the webhook
 * stays a quiet row, so this always means "act now". Dismissed by hand.
 */
export function AlertPopup({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  hint?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0c1626] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-red-300">{title}</h3>
          <button
            onClick={onClose}
            className="text-[#92a0b9] transition hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {hint ? <p className="mt-1 text-xs text-[#92a0b9]">{hint}</p> : null}
        <div className="mt-3 space-y-2">{children}</div>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-[#2fd4f2] py-2 text-xs font-bold text-[#04202b]"
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}
