import type { EmailOtpType } from "@supabase/supabase-js";

/** Email link types Supabase can verify with a token hash. */
const OTP_TYPES: readonly EmailOtpType[] = ["invite", "recovery", "magiclink", "signup", "email", "email_change"];

export function parseOtpType(v: string | null): EmailOtpType | null {
  return v && (OTP_TYPES as readonly string[]).includes(v) ? (v as EmailOtpType) : null;
}

/**
 * Where to go after an email link. Only same-site paths; invitations and
 * password resets always end on the set-password page.
 */
export function safeNext(nextParam: string | null, type?: EmailOtpType | null): string {
  if (type === "invite" || type === "recovery") return "/auth/set-password";
  const n = nextParam ?? "";
  return /^\/(admin|auth\/set-password)(\/|\?|$)/.test(n) ? n : "/admin";
}

/** Parse "#access_token=…&refresh_token=…" or "#error_code=otp_expired…" from an email link. */
export function parseAuthFragment(hash: string) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const type = parseOtpType(p.get("type"));
  const errorCode = p.get("error_code") ?? (p.get("error") ? "error" : null);
  return { accessToken, refreshToken, type, errorCode };
}
