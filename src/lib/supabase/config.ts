// Server-only env mirrors for the SuperSwap data layer.
// The AUTHORITY for every money rule is the platform_settings row (see
// supabase/schema.sql); these values only exist so forms/routes can state
// rules before a round-trip. Fallbacks here MUST equal the RPC fallbacks in
// supabase/rpc.sql (app_setting_* defaults) and the seeds in schema.sql.

const env = process.env;

export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Server only. NEVER expose to the browser — bypasses RLS. */
export const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Bearer secret for the private settlement cron (/api/settle). */
export const CRON_SECRET = env.CRON_SECRET ?? "";

/** Where Supabase redirects after auth (PKCE code exchange). */
export const SITE_URL = env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const appRulesFallback = {
  min_deposit: 10000,
  min_withdrawal: 5000,
  withdrawal_fee_percent: 17,
  referral_commission_percent: 18,
  referral_commission_l2_percent: 1,
  signup_bonus: 1500,
  checkin_bonus: 100,
  withdraw_window_from: "09:00",
  withdraw_window_to: "22:00",
  timezone: "Africa/Kampala",
  settlement_hour: "22:00",
  platform_paused: false,
  pause_message: "",
  support_contact: "",
  community_link: "https://t.me/+D8o6_tUFNbFjNjE0",
  support_link: "",
} as const;

// Client-side input validators (UX only — the DB re-checks everything).
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const PHONE_RE = /^(\+?256|0)7[0-9]{8}$/;
