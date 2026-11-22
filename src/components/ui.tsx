// Small shared UI primitives for the app shells (member desk + ops desk).
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  title,
  hint,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  hint?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-4 ${className}`}>
      {title && (
        <h3 className="text-sm font-semibold text-[#9fb3e8] uppercase tracking-wide">{title}</h3>
      )}
      {hint && <p className="text-xs text-[#6b7fae] mt-0.5">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad" | "gold";
  sub?: string;
}) {
  const tones: Record<string, string> = {
    default: "text-[#e8eefc]",
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-red-400",
    gold: "text-[#f5b301]",
  };
  return (
    <div>
      <div className="text-[11px] text-[#6b7fae] uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold leading-tight ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#9fb3e8]">{sub}</div>}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "gold",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "gold" | "ghost" | "danger" | "solid";
  className?: string;
}) {
  const styles: Record<string, string> = {
    gold: "bg-[#f5b301] text-[#1a1400] hover:bg-[#ffc93c]",
    solid: "bg-[#1e3a8a] text-white hover:bg-[#2547a8]",
    ghost: "border border-[#2b3f6f] text-[#9fb3e8] hover:bg-[#12204a]",
    danger: "bg-red-700 text-white hover:bg-red-600",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
