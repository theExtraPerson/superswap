// Brand + copy for the live SuperSwap app. Display strings live in ONE file so
// a rebrand touches exactly this module. Rates/limits never live here — they
// come from platform_settings via the API (this file may only restate them).
export const brand = {
  name: "SuperSwap",
  tagline: "Term savings with reserved yield.",
  promise:
    "Every payout we promise is funded in advance from the operator's reserve, held securely with our licensed payment provider — never from newer members' deposits.",
  currency: "UGX",
  market: "Uganda",
  rails: "MTN MoMo · Airtel Money",
  // Visual assets. logo.jpg is the wide wordmark (1280x478 on a black field);
  // ogg.jpg is the card image that ships with every shared referral link. The
  // two files are byte-identical today but named separately on purpose, so the
  // share artwork can diverge from the in-app mark without touching code.
  logo: { src: "/logo.jpg", width: 1280, height: 478 },
  share: { src: "/ogg.jpg", width: 1280, height: 478 },
} as const;

/**
 * The card artwork every shared link previews with — referral links included,
 * which is how an invite looks in WhatsApp, Facebook or X. Relative `url` is
 * resolved against metadataBase, so it is correct on whatever origin serves the
 * page. Kept here (not in layout.tsx) because /register overrides its own
 * openGraph block per invite code and must ship the identical image.
 */
export const shareImage = {
  url: brand.share.src,
  width: brand.share.width,
  height: brand.share.height,
  alt: `${brand.name} — ${brand.tagline} Term-savings vaults in UGX, fully reserved. Sign up with a friend's code and start from the welcome bonus.`,
};
