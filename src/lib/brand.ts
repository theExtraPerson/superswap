// Brand + copy for the live SuperSwap app. Display strings live in ONE file so
// a rebrand touches exactly this module. Rates/limits never live here — they
// come from platform_settings via the API (this file may only restate them).
export const brand = {
  name: "SuperSwap",
  tagline: "Term savings with reserved yield.",
  promise:
    "Every payout we promise is covered by the reserve before we promise it — and you can watch the coverage number, live, on your dashboard.",
  currency: "UGX",
  market: "Uganda",
  rails: "MTN MoMo · Airtel Money · Bank transfer",
  // Visual assets. logo.jpg is the wide wordmark (1280x478 on a black field);
  // ogg.jpg is the card image that ships with every shared referral link. The
  // two files are byte-identical today but named separately on purpose, so the
  // share artwork can diverge from the in-app mark without touching code.
  logo: { src: "/logo.jpg", width: 1280, height: 478 },
  share: { src: "/ogg.jpg", width: 1280, height: 478 },
  howItWorks: [
    {
      title: "Deposit, don't gamble",
      body: "Top up your wallet from mobile money or bank. An operator confirms every deposit against the actual money movement — nothing appears from thin air. New members are also credited the disclosed welcome bonus, once, at sign-in.",
    },
    {
      title: "Lock a term, fix a rate",
      body: "Open a vault for 30-365 days. The total rate is fixed at opening — it never changes mid-term, and it is a TOTAL over the term, not a fake 'daily' rate.",
    },
    {
      title: "The reserve backs it",
      body: "The app refuses to open any vault whose promised yield is not already funded in the operator reserve. Coverage % is published to every member, always ≥ 100%.",
    },
    {
      title: "Refer once, earn on deposits",
      body: "Your code earns the disclosed percent of every deposit the members you bring in make — one level only. No commission on commissions, no chain to build.",
    },
    {
      title: "Withdraw in the open hours",
      body: "Payouts land in your wallet at the settlement hour on maturity day, and withdrawal requests are taken during the published daily window (shown on your Money tab, on the platform clock). Early exit returns a disclosed share of your principal; the unearned yield is forfeited, in writing.",
    },
  ],
  complianceNote:
    "SuperSwap is a term-savings product. Yield is fixed at opening, fully reserved before it is promised, and never compounded from new members' deposits. The welcome bonus and the one-level referral commission are operator-funded promotions, disclosed up front and never counted as vault yield. Rates are total-over-term and disclosed before you commit.",
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
