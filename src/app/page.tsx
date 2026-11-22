import Link from "next/link";
import { connection } from "next/server";
import { anonClient } from "@/lib/api/respond";
import { brand } from "@/lib/brand";
import { fmtUGX, fmtRate } from "@/lib/format";
import { InstallTile } from "@/components/InstallTile";
import type { PublicInfoPayload } from "@/lib/api/types";

/**
 * / — branded welcome screen (server render; live rates + coverage come from
 * the public RPC so marketing copy can never drift from the running rules).
 * The whole page is runtime data (coverage is live), so it opts out of
 * instant static rendering under cacheComponents.
 */
export const instant = false;

export default async function Home() {
  await connection(); // per-request under cacheComponents; never prerendered
  let info: PublicInfoPayload | null = null;
  try {
    const { data } = await anonClient().rpc("app_public_info");
    info = (data as PublicInfoPayload) ?? null;
  } catch {
    /* DB not configured yet — the page still renders with static copy */
  }

  const paused = info?.rules?.platform_paused === true;

  return (
    <main className="min-h-dvh bg-[#060b1f] text-[#e8eefc]">
      <div className="mx-auto max-w-md px-5 py-10 flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-4xl font-black tracking-tight">
            Super<span className="text-[#f5b301]">Swap</span>
          </h1>
          <p className="mt-1 text-[#9fb3e8] text-sm font-medium">{brand.tagline}</p>
        </header>

        <section className="rounded-2xl border border-[#1d2c55] bg-[#0d1733] p-5 text-center">
          <p className="text-lg font-bold leading-snug">{brand.promise}</p>
          {info && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl bg-[#060b1f] border border-[#1d2c55] p-3">
                <div className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Reserve coverage</div>
                <div className="text-xl font-black text-emerald-400">{fmtRate(info.coverage_pct)}</div>
              </div>
              <div className="rounded-xl bg-[#060b1f] border border-[#1d2c55] p-3">
                <div className="text-[11px] uppercase tracking-wide text-[#6b7fae]">Withdrawal fee</div>
                <div className="text-xl font-black">{fmtRate(info.rules.withdrawal_fee_percent)}</div>
              </div>
            </div>
          )}
        </section>

        {info && info.products.length > 0 && (
          <section>
            <h2 className="font-bold text-sm uppercase tracking-wide text-[#6b7fae] mb-3">
              Vault rates — total over the term, never “per day”
            </h2>
            <div className="space-y-3">
              {info.products.map((p) => (
                <div
                  key={p.slug}
                  className="rounded-xl border border-[#1d2c55] bg-[#0a1430] p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-bold">{p.name}</div>
                    <div className="text-xs text-[#9fb3e8] mt-0.5">
                      {p.duration_days} days · from {fmtUGX(p.min_principal)} · exit returns{" "}
                      {fmtRate(p.early_exit_percent)} of principal
                    </div>
                  </div>
                  <div className="text-2xl font-black text-[#f5b301] whitespace-nowrap">
                    +{fmtRate(p.total_rate_pct)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="font-bold text-sm uppercase tracking-wide text-[#6b7fae]">How it works</h2>
          {brand.howItWorks.map((s, i) => (
            <div key={s.title} className="rounded-xl border border-[#1d2c55] bg-[#0d1733] p-4">
              <div className="flex items-center gap-2 font-bold text-sm">
                <span className="w-6 h-6 shrink-0 rounded-full bg-[#f5b301] text-[#1a1400] text-xs font-black flex items-center justify-center">
                  {i + 1}
                </span>
                {s.title}
              </div>
              <p className="text-xs text-[#9fb3e8] mt-1.5 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </section>

        {paused && (
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
            Money movement is temporarily paused. Existing vaults keep their agreed terms.
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Link
            href="/register"
            className="block rounded-2xl bg-[#f5b301] text-[#1a1400] text-center font-black text-lg py-4 shadow-lg shadow-[#f5b301]/20 hover:bg-[#ffc93c]"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="block rounded-2xl border border-[#2b3f6f] text-center font-bold py-3 text-sm text-[#9fb3e8] hover:bg-[#0d1733]"
          >
            Sign in
          </Link>
        </div>

        <p className="text-center text-xs text-[#6b7fae] leading-relaxed">{brand.rails}</p>

        <InstallTile />

        <footer className="text-center text-[10px] text-[#42527c] pt-2 leading-relaxed">
          {brand.complianceNote}
        </footer>
      </div>
    </main>
  );
}
