import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { brand } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${brand.name} — Term savings with reserved yield`,
  description:
    "UGX term-savings vaults. The rate is fixed at opening, the yield is fully reserved before it is promised, and the coverage number is published to every member.",
  manifest: "/manifest.webmanifest",
  applicationName: brand.name,
  keywords: ["savings", "term deposit", "mobile money", "Uganda", "UGX"],
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: brand.name,
  },
};

export const viewport: Viewport = {
  themeColor: "#060b1f",
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
      <body className="min-h-full flex flex-col bg-[#060b1f]">{children}</body>
    </html>
  );
}
