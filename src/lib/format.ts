// Display formatting for the live app (UGX). Postgres numerics arrive as
// numbers or numeric-strings — everything is coerced through Number() here.
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const num = (n: number | string) => (typeof n === "string" ? Number(n) : n);

export const fmt = (n: number | string) => nf.format(Math.round(num(n) || 0));

export const fmtUGX = (n: number | string) => `${fmt(n)} UGX`;

export const fmtRate = (n: number | string) =>
  `${(num(n) || 0).toFixed(2).replace(/\.?0+$/, "")}%`;

export const fmtPct = (n: number | string) => `${(num(n) || 0).toFixed(2)}%`;

export const fmtShort = (n: number | string) => {
  const v = num(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
