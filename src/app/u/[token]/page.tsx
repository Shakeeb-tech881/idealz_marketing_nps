import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { SurveyShell } from "@/components/survey/survey-shell";
import { getPublicBranding } from "@/server/services/public-branding";
import { optoutLinkState } from "@/server/services/offers";
import { StopOffersForm } from "./stop-offers-form";

export const metadata: Metadata = { title: { absolute: "Stop offer SMS" }, robots: { index: false, follow: false } };

/**
 * One-tap opt-out from the link in every offer SMS (/u/<token>).
 * Opening the page changes nothing (phones and mail apps preview links);
 * the customer confirms with a button.
 */
export default async function StopOffersPage({ params }: PageProps<"/u/[token]">) {
  const { token } = await params;
  const state = await optoutLinkState(token);
  const brand = await getPublicBranding(state.brandName);
  return (
    <SurveyShell logoUrl={brand.logoUrl} brandName={brand.name}>
      <div className="py-8">
        {!state.valid ? (
          <div className="text-center">
            <h1 className="text-xl font-semibold">This link is not valid</h1>
            <p className="mt-2 text-[15px] text-muted-foreground">Please use the link from the SMS exactly as received, or contact the showroom.</p>
          </div>
        ) : state.alreadyStopped ? (
          <div className="flex flex-col items-center text-center">
            <CheckCircle2 className="mb-3 size-12 text-promoter" strokeWidth={1.75} />
            <h1 className="text-xl font-semibold">Offers are already stopped</h1>
            <p className="mt-2 text-[15px] text-muted-foreground">You will not receive offer SMS from {brand.name}.</p>
          </div>
        ) : (
          <StopOffersForm token={token} brandName={brand.name} />
        )}
      </div>
    </SurveyShell>
  );
}
