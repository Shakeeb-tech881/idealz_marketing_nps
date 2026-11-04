import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { SurveyShell } from "@/components/survey/survey-shell";
import { getPublicBranding } from "@/server/services/public-branding";

export const metadata: Metadata = { title: "Thank you", robots: { index: false, follow: false } };

export default async function ThankYouPage({ searchParams }: PageProps<"/survey/thank-you">) {
  const sp = await searchParams;
  const brand = await getPublicBranding();
  const already = sp.already === "1";
  const preview = sp.preview === "1";
  return (
    <SurveyShell logoUrl={brand.logoUrl} brandName={brand.name}>
      <div className="flex flex-col items-center py-8 text-center">
        <span className="mb-5 flex size-16 items-center justify-center rounded-full bg-promoter-soft text-promoter animate-in zoom-in-50 duration-500">
          <CheckCircle2 className="size-9" strokeWidth={1.75} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Thank you for sharing your experience!</h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Your feedback means a lot to {brand.name}. We use your valuable feedback to improve our products, customer service and overall shopping
          experience.
        </p>
        <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-promoter" aria-hidden />
          {preview ? "Preview – nothing was saved" : already ? "Your response was already recorded" : "Your response has been submitted"}
        </p>
      </div>
    </SurveyShell>
  );
}
