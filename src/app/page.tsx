import Link from "next/link";
import { connection } from "next/server";
import { anonClient } from "@/lib/api/respond";
import { brand } from "@/lib/brand";
import { fmtPct, fmtRate, fmtUGX } from "@/lib/format";
import { InstallTile } from "@/components/InstallTile";
import { BrandMark } from "@/components/ui";
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
  const coverage = info ? fmtPct(info.coverage_pct) : null;
  const signupBonus = Number(info?.rules?.signup_bonus ?? 0);
  const minDeposit = Number(info?.rules?.min_deposit ?? 0);

  return (
    <main className="min-h-dvh text-[#f6f8ff]">
      <div className="mx-auto max-w-md px-5 py-10 flex flex-col gap-6">
        <header className="flex flex-col items-center gap-2 text-center">
          <h1>
            <BrandMark height={54} priority />
          </h1>
          <p className="text-[#c3cfe4] text-sm font-medium">{brand.tagline}</p>
          <p className="text-[11px] text-[#92a0b9] leading-relaxed max-w-[34ch]">{brand.promise}</p>
          {coverage && (
            <span className="pill bg-emerald-500/15 text-emerald-300 mt-1">
              Live reserve coverage {coverage}
            </span>
          )}
        </header>

        {paused && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Money movement is briefly paused for maintenance. Existing vaults keep their terms.
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Link href="/register" className="btn-cta block w-full text-center text-lg py-4">
            Create your account
          </Link>
          <Link
            href="/login"
            className="btn-ghost-grad block w-full text-center font-bold py-3.5 text-sm text-[#c3cfe4]"
          >
            Sign in
          </Link>
        </div>

        {signupBonus > 0 && (
          <div className="card-grad p-4 text-center">
            <div className="text-[11px] uppercase tracking-wide text-[#92a0b9]">New members</div>
            <div className="text-lg font-black text-[#45e9ff] mt-0.5">
              {fmtUGX(signupBonus)} welcome bonus
            </div>
            <p className="text-[11px] text-[#c3cfe4] mt-1">
              Credited once at first sign-in{minDeposit > 0 ? ` · deposits start at ${fmtUGX(minDeposit)}` : ""}.
            </p>
          </div>
        )}

        {info && info.products.length > 0 && (
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">
              Term vaults, live rates
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {info.products.map((p) => (
                <div key={p.slug} className="card-grad p-3 text-center">
                  <div className="text-xl font-black text-[#45e9ff]">+{fmtRate(p.total_rate_pct)}</div>
                  <div className="text-[11px] font-bold mt-0.5">{p.name}</div>
                  <div className="text-[10px] text-[#92a0b9]">
                    {p.duration_days} days · {fmtUGX(p.min_principal)}–{fmtUGX(p.max_principal)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#92a0b9] mb-2">How it works</h2>
          <ol className="flex flex-col gap-2">
            {brand.howItWorks.map((s, i) => (
              <li key={s.title} className="card-grad !rounded-xl p-3 flex gap-3">
                <span className="orb orb-violet !w-8 !h-8 shrink-0 text-xs font-black">{i + 1}</span>
                <div>
                  <div className="text-xs font-bold">{s.title}</div>
                  <div className="text-[11px] text-[#92a0b9] mt-0.5 leading-relaxed">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <InstallTile />

        <footer className="text-center text-[10px] text-[#5d6f93] leading-relaxed">
          {brand.complianceNote}
        </footer>
      </div>
    </main>
  );
}
