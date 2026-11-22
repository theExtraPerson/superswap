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
  howItWorks: [
    {
      title: "Deposit, don't gamble",
      body: "Top up your wallet from mobile money or bank. An operator confirms every deposit against the actual money movement — nothing appears from thin air.",
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
      title: "Withdraw when mature",
      body: "Payouts land in your wallet at the settlement hour on maturity day. Early exit returns a disclosed share of your principal; the unearned yield is forfeited, in writing.",
    },
  ],
  complianceNote:
    "SuperSwap is a term-savings product. Yield is fixed at opening, fully reserved before it is promised, and never compounded from new members' deposits. Rates are total-over-term and disclosed before you commit.",
} as const;
