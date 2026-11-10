import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { safeNext } from "@/lib/auth-links";
import { FinishSignIn } from "./finish-sign-in";

export const metadata: Metadata = { title: "Signing you in" };

export default async function FinishPage({ searchParams }: PageProps<"/auth/finish">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[linear-gradient(180deg,#eef2f8_0%,#f7f8fa_320px)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-[0_8px_24px_-12px_rgba(15,39,71,0.15)]">
          <FinishSignIn next={next} />
        </div>
      </div>
    </div>
  );
}
