import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand.name} — Term savings with reserved yield`,
    short_name: brand.name,
    description:
      "UGX term-savings vaults with fixed, fully-reserved yield. Every promise is covered by the reserve before it is made — and the coverage number is public.",
    id: "/",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#080d19",
    theme_color: "#080d19",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "My savings", url: "/app", description: "Open your member desk" },
      { name: "Sign up", url: "/register", description: "Create an account" },
    ],
  };
}
