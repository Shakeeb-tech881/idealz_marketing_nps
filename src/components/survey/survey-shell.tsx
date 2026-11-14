import { Logo } from "@/components/brand/logo";

export function SurveyShell({ children, logoUrl, brandName }: { children: React.ReactNode; logoUrl?: string | null; brandName?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-center px-4 pt-8 pb-6 sm:pt-12">
        <Logo logoUrl={logoUrl} name={brandName} className="text-2xl" />
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
        <div className="glass rounded-3xl p-5 sm:p-8">{children}</div>
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-muted-foreground">
        Your responses are used only to improve our products and service, in line with our privacy policy.
        <br />
        Replies are confidential and are not shared outside {brandName ?? "iDealz Lanka"}.
      </footer>
    </div>
  );
}
