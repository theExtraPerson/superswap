import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { brand, shareImage } from "@/lib/brand";
import { SITE_URL } from "@/lib/supabase/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Shared links are scraped as absolute URLs, so every relative og:url/og:image
// below is resolved against this base. Set NEXT_PUBLIC_SITE_URL to the deployed
// origin (https://superswap-nine.vercel.app) — a stale value silently produces
// preview cards that point at localhost.
const origin = /^https?:\/\//.test(SITE_URL) ? SITE_URL : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: `${brand.name} — Term savings with reserved yield`,
  description:
    "UGX term-savings vaults. The rate is fixed at opening, and every payout is funded in advance from the operator's reserve held securely with our licensed payment provider.",
  manifest: "/manifest.webmanifest",
  applicationName: brand.name,
  keywords: ["savings", "term deposit", "mobile money", "Uganda", "UGX"],
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/icons/icon.png", type: "image/png", sizes: "1024x1024" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: brand.name,
    locale: "en_US",
    url: origin,
    title: `${brand.name} — ${brand.tagline}`,
    description:
      "UGX term-savings vaults with fixed, fully-reserved yield. Join with a friend's code and start from the welcome bonus.",
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.name} — ${brand.tagline}`,
    description:
      "UGX term-savings vaults with fixed, fully-reserved yield. Join with a friend's code and start from the welcome bonus.",
    images: [brand.share.src],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: brand.name,
  },
};

export const viewport: Viewport = {
  themeColor: "#080d19",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#080d19]">{children}</body>
    </html>
  );
}
