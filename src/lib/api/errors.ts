// DB-error → friendly-message map.
// The app_* RPCs raise 'CODE: detail'. We split on the first colon, look the
// code up here, and pick an HTTP status so clients can react per class.

import type { ApiError } from "./types";

// Friendly sentences for every named exception the RPCs raise.
const FRIENDLY: Record<string, string> = {
  NOT_AUTHENTICATED: "Please sign in again — your session is missing or expired.",
  PROFILE_MISSING: "We could not find your account. Sign out and back in.",
  ACCOUNT_RESTRICTED: "This account has been restricted. Contact support.",
  FORBIDDEN: "You do not have access to that action.",
  PLATFORM_PAUSED: "Money movement is paused for maintenance.",
  DAILY_LOCK: "Money movement is locked while the daily books close.",
  INSUFFICIENT_RESERVE:
    "The reserve does not cover this promise yet — the operation was refused to keep every payout payable.",
  INSUFFICIENT_FUNDS: "Your wallet does not have the available balance for that action.",
  BELOW_MINIMUM: "That amount is below the minimum.",
  ABOVE_MAXIMUM: "That amount is above the maximum.",
  INVALID_AMOUNT: "Enter a valid positive amount.",
  INVALID_CHANNEL: "Choose a valid channel (momo or bank).",
  MISSING_ACCOUNT: "Provide the account number for this operation.",
  PRODUCT_NOT_FOUND: "That vault is not available.",
  CYCLE_NOT_OPEN: "That vault was not found or is no longer open.",
  NOT_FOUND: "The requested record was not found.",
  USERNAME_TAKEN: "That username is already taken.",
  INVALID_USERNAME: "Username must be 3-20 characters: lowercase letters, numbers or underscore.",
  INVALID_NAME: "Please provide your real name (2-60 characters).",
  INVALID_PHONE: "Provide a valid Ugandan mobile number, e.g. 0772123456.",
  BAD_REFERRAL: "That referral code does not exist.",
  INVALID_REQUEST: "The request was malformed.",
  INTERNAL: "Something went wrong. Please try again.",
};

// HTTP status per code — auth first (401/403), missing rows 404, rule and
// validation violations 422, platform-wide halts 503, unexpected faults 500.
const STATUS: Record<string, number> = {
  NOT_AUTHENTICATED: 401,
  FORBIDDEN: 403,
  ACCOUNT_RESTRICTED: 403,
  PROFILE_MISSING: 404,
  NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  CYCLE_NOT_OPEN: 422,
  PLATFORM_PAUSED: 503,
  DAILY_LOCK: 503,
  INVALID_REQUEST: 422,
  INTERNAL: 500,
};

export interface RpcFailure {
  code: string;
  message: string;
  status: number;
}

/** Parse a raised 'CODE: detail' (or bare Supabase) message into a mapped failure. */
export function mapRpcError(raw: string | undefined | null): RpcFailure {
  const text = (raw ?? "Unknown error").trim();
  const head = text.split(":")[0].trim().toUpperCase().replace(/[\s-]+/g, "_");
  const known = head in FRIENDLY;
  const code = known ? head : "INTERNAL";
  return {
    code,
    // The RPC's own detail carries live figures (balances, minimums) —
    // keep it when the code is recognised; hide internals otherwise.
    message: known ? text.slice(head.length + 1).trim() || FRIENDLY[code] : FRIENDLY.INTERNAL,
    status: STATUS[code] ?? 422,
  };
}

export function apiError(failure: RpcFailure): ApiError {
  return { error: { code: failure.code, message: failure.message } };
}
