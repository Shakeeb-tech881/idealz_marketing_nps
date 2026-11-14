import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage({ searchParams }: PageProps<"/auth/set-password">) {
  const sp = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
        </div>
        <div className="glass rounded-3xl p-6">
          <SetPasswordForm firstSignIn={sp.first === "1"} />
        </div>
      </div>
    </div>
  );
}
