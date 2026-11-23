import type { Metadata } from "next";
import RegisterForm from "@/components/auth/RegisterForm";
import { brand, shareImage } from "@/lib/brand";
import { SITE_URL } from "@/lib/supabase/config";

/**
 * /register — a server shell whose only real job is the invite code.
 *
 * A shared referral link is `/register?code=CODE`. Crawlers (WhatsApp, Facebook,
 * X, Telegram) read this page's Open Graph tags before any JavaScript runs, so
 * the code has to be handled here rather than in a client effect for the preview
 * card to carry it — and it is that same code which later becomes
 * profiles.referred_by inside app_handle_new_user(), i.e. how commission and the
 * team list get attributed. One value, one shape, from link to ledger.
 *
 * The code is echoed, never resolved: naming the referrer would require a public
 * "who owns code X" RPC, and the SQL layer deliberately exposes only
 * app_referral_valid() — existence, no identity.
 */
export const instant = false; // the card depends on ?code=, so never static-render it

// Exactly what POST /api/auth/register accepts, so junk input can neither reach
// the share card nor be stored as an "invite" for the next visit.
const CODE_RE = /^[A-Z0-9]{4,10}$/;
const origin = /^https?:\/\//.test(SITE_URL) ? SITE_URL : "http://localhost:3000";

type SearchParams = { code?: string | string[] };
type Props = { searchParams?: Promise<SearchParams> };

async function inviteCode(searchParams: Props["searchParams"]): Promise<string> {
  const raw = (await searchParams)?.code;
  const code = (Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().toUpperCase();
  return CODE_RE.test(code) ? code : "";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const code = await inviteCode(searchParams);
  const title = code
    ? `Join ${brand.name} — invite code ${code}`
    : `Create your ${brand.name} account`;
  const description = code
    ? `Use code ${code} to open your ${brand.name} account: UGX term-savings vaults with fixed, fully-reserved yield, plus the new-member welcome bonus.`
    : "UGX term-savings vaults with fixed, fully-reserved yield. Every promise is covered by the reserve before it is made.";

  return {
    title,
    description,
    alternates: { canonical: "/register" },
    openGraph: {
      type: "website",
      siteName: brand.name,
      // The code stays in og:url so the scrape of an invite is a distinct card.
      url: code ? `${origin}/register?code=${code}` : `${origin}/register`,
      title,
      description,
      images: [shareImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [shareImage.url],
    },
  };
}

export default async function RegisterPage({ searchParams }: Props) {
  const code = await inviteCode(searchParams);
  return <RegisterForm initialCode={code} />;
}
