import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseOtpType, safeNext } from "@/lib/auth-links";

/**
 * Landing URL for invitation and password-reset emails. Supabase can send three link styles:
 *  1. ?token_hash=…&type=invite|recovery  (recommended email templates — works in any browser)
 *  2. ?code=…                              (PKCE — only works in the browser that asked for it)
 *  3. #access_token=…                      (default invite emails; the fragment never reaches the
 *                                           server, so /auth/finish handles it in the browser)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tokenHash = sp.get("token_hash");
  const type = parseOtpType(sp.get("type"));
  const code = sp.get("code");
  const next = safeNext(sp.get("next"), type);
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, req.url));

  // Supabase puts errors in the query (e.g. ?error_code=otp_expired) when the link was already used or is too old.
  if (sp.get("error_code") || sp.get("error")) return fail(sp.get("error_code") === "otp_expired" ? "link_expired" : "link");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, req.url));
    return fail(/expired|invalid/i.test(error.message) ? "link_expired" : "link");
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, req.url));
    // PKCE needs the browser that requested the link (e.g. the phone's mail app opens a different one).
    return fail("link_browser");
  }

  // No query credentials: the link may carry #access_token=… — the browser keeps the fragment across this redirect.
  return NextResponse.redirect(new URL(`/auth/finish?next=${encodeURIComponent(next)}`, req.url));
}
