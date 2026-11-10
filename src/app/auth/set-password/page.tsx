import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage({ searchParams }: PageProps<"/auth/set-password">) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[linear-gradient(180deg,#eef2f8_0%,#f7f8fa_320px)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_8px_24px_-12px_rgba(15,39,71,0.15)]">
          <SetPasswordForm firstSignIn={sp.first === "1"} />
        </div>
      </div>
    </div>
  );
}
