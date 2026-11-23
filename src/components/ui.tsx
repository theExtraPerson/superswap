// Small shared UI primitives for the app shells (member desk + ops desk).
import type { ReactNode } from "react";
import Image from "next/image";
import { brand } from "@/lib/brand";

/**
 * The brand mark as artwork, not styled text — so the wordmark members see in
 * the app is the same one the share card previews (see openGraph in layout.tsx).
 * `height` picks the box; the 1280x478 source keeps its own aspect ratio.
 */
export function BrandMark({
  height = 40,
  className = "",
  priority = false,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const width = Math.round((height * brand.logo.width) / brand.logo.height);
  return (
    <Image
      src={brand.logo.src}
      alt={`${brand.name} — ${brand.tagline}`}
      width={width}
      height={height}
      priority={priority}
      className={`object-contain ${className}`}
    />
  );
}

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
    <section className={`card-grad p-4 ${className}`}>
      {title && (
        <h3 className="text-sm font-semibold text-[#c3cfe4] uppercase tracking-wide">{title}</h3>
      )}
      {hint && <p className="text-xs text-[#92a0b9] mt-0.5">{hint}</p>}
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
    default: "text-[#f6f8ff]",
    good: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-red-400",
    gold: "text-[#45e9ff]",
  };
  return (
    <div>
      <div className="text-[11px] text-[#92a0b9] uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold leading-tight ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#c3cfe4]">{sub}</div>}
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
    // primary: the reference's cyan→indigo→violet CTA gradient with lift glow
    gold: "bg-[linear-gradient(95deg,#23c8f0,#6a5cff_60%,#b03dff)] text-white shadow-[inset_0_1px_rgba(255,255,255,0.25),0_10px_24px_-12px_rgba(106,92,255,0.9)] hover:brightness-110 active:scale-[0.985]",
    solid: "bg-[linear-gradient(95deg,#2bd4e8,#4a7dff)] text-[#04202b] hover:brightness-110",
    ghost: "btn-ghost-grad hover:brightness-125",
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
