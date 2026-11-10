"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseAuthFragment, safeNext } from "@/lib/auth-links";

/** Signs in from "#access_token=…" (or reads Supabase's error), then reports where to go. */
async function completeFromFragment(hash: string, next: string): Promise<{ ok: true; to: string } | { ok: false; reason: "expired" | "invalid" }> {
  const f = parseAuthFragment(hash);
  if (f.errorCode) return { ok: false, reason: f.errorCode === "otp_expired" ? "expired" : "invalid" };
  if (!f.accessToken || !f.refreshToken) return { ok: false, reason: "invalid" };
  const { error } = await createClient().auth.setSession({ access_token: f.accessToken, refresh_token: f.refreshToken });
  return error ? { ok: false, reason: "invalid" } : { ok: true, to: safeNext(next, f.type) };
}

/** Completes sign-in for email links that carry the session in the URL fragment (#access_token=…). */
export function FinishSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState<"expired" | "invalid" | null>(null);
  // Kept across React's development double-run of effects, after the address bar is cleaned.
  const hashRef = useRef<string | null>(null);

  useEffect(() => {
    if (hashRef.current === null) {
      hashRef.current = window.location.hash;
      // Remove the tokens from the address bar and history straight away.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const hash = hashRef.current;
    let cancelled = false;
    completeFromFragment(hash, next).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setFailed(r.reason);
      router.replace(r.to);
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  if (!failed) {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Signing you in…
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium text-destructive">{failed === "expired" ? "This link has already been used or has expired." : "This sign-in link is not valid."}</p>
      <p className="text-muted-foreground">
        Go to the sign-in page, click <strong>Forgot password?</strong> and enter your email to get a new link. Open it on the same device, and only once.
      </p>
      <a href="/login" className="inline-block font-medium text-primary underline underline-offset-4">Go to sign in</a>
    </div>
  );
}
