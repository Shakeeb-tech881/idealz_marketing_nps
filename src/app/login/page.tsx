import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  inactive: "Your account is not active. Please contact a Super Admin.",
  link: "That sign-in link is not valid. Click “Forgot password?” below to get a new one.",
  link_expired: "That link has already been used or has expired (links work once, for a limited time). Click “Forgot password?” below to get a new one.",
  link_browser: "Open the reset link in the same browser where you clicked “Forgot password?”, or ask a Super Admin to update the Supabase email templates (see docs/DEPLOYMENT.md) so links work in any browser.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const next = typeof sp.next === "string" && sp.next.startsWith("/admin") ? sp.next : "/admin";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[linear-gradient(180deg,#eef2f8_0%,#f7f8fa_320px)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <p className="mt-2 text-sm text-muted-foreground">Customer Experience &amp; NPS Platform</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_-12px_rgba(15,39,71,0.15)]">
          <LoginForm next={next} initialError={error} />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Authorised iDealz Lanka personnel only. Access is logged.</p>
      </div>
    </div>
  );
}
