import { Logo } from "@/components/brand/logo";

export function SurveyShell({ children, logoUrl, brandName }: { children: React.ReactNode; logoUrl?: string | null; brandName?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[linear-gradient(180deg,#eef2f8_0%,#f7f8fa_260px)]">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-center px-4 pt-8 pb-6 sm:pt-12">
        <Logo logoUrl={logoUrl} name={brandName} className="text-2xl" />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(15,39,71,0.04),0_8px_24px_-12px_rgba(15,39,71,0.12)] sm:p-8">{children}</div>
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-muted-foreground">
        Your responses are used only to improve our products and service, in line with our privacy policy.
        <br />
        Replies are confidential and are not shared outside {brandName ?? "iDealz Lanka"}.
      </footer>
    </div>
  );
}
