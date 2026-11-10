"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(initialError);
  const [info, setInfo] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setInfo(undefined);
    setLoading(true);
    const supabase = createClient();
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setLoading(false);
      if (error) {
        setError("Incorrect email or password.");
        return;
      }
      router.replace(next);
      router.refresh();
    } else {
      // The reset email must work in any browser (phones often open mail links in a different one),
      // so request it with the "implicit" link style: the session arrives in the link itself
      // (#access_token=…, completed by /auth/finish) instead of needing this browser's PKCE cookie.
      // Works with Supabase's default email templates — no custom SMTP needed.
      const resetClient = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "idealz-password-reset" },
      });
      await resetClient.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/set-password`,
      });
      setLoading(false);
      setInfo("If an account exists for this email, a password reset link has been sent.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-lg font-semibold">{mode === "signin" ? "Sign in" : "Reset password"}</h1>
        <p className="text-sm text-muted-foreground">{mode === "signin" ? "Use your iDealz Lanka work account." : "We'll email you a secure reset link."}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
      </div>
      {mode === "signin" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode("reset")}>
              Forgot password?
            </button>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {info && <p role="status" className="rounded-lg bg-promoter-soft px-3 py-2 text-sm text-[#087a08]">{info}</p>}
      <Button type="submit" className="h-10 w-full" disabled={loading || !email || (mode === "signin" && !password)}>
        {loading && <Loader2 className="animate-spin" data-icon="inline-start" />}
        {mode === "signin" ? "Sign in" : "Send reset link"}
      </Button>
      {mode === "reset" && (
        <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode("signin")}>
          Back to sign in
        </button>
      )}
    </form>
  );
}
