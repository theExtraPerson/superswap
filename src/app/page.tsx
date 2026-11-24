import Link from "next/link";
import { connection } from "next/server";
import { anonClient } from "@/lib/api/respond";
import { brand } from "@/lib/brand";
import { fmtRate, fmtUGX } from "@/lib/format";
import { InstallTile } from "@/components/InstallTile";
import { BrandMark } from "@/components/ui";
import type { PublicInfoPayload } from "@/lib/api/types";

/**
 * / — branded welcome screen (server render; live rates come from
 * the public RPC so marketing copy can never drift from the running rules).
 * The whole page is runtime data, so it opts out of
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
        </header>

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


        <InstallTile />

      </div>
    </main>
  );
}
