import type { Metadata } from "next";
import { headers } from "next/headers";
import { Clock, LinkIcon, CheckCircle2, AlertTriangle } from "lucide-react";
import { SurveyShell } from "@/components/survey/survey-shell";
import { SurveyForm } from "@/components/survey/survey-form";
import { loadSurvey } from "@/server/services/public-survey";
import { getPublicBranding } from "@/server/services/public-branding";

export const metadata: Metadata = {
  title: { absolute: "Share your feedback" },
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

function StateMessage({ icon: Icon, title, body, tone = "muted" }: { icon: typeof Clock; title: string; body: string; tone?: "muted" | "good" | "warn" }) {
  const toneCls = tone === "good" ? "bg-promoter-soft text-promoter" : tone === "warn" ? "bg-passive-soft text-passive" : "bg-muted text-muted-foreground";
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className={`mb-4 flex size-14 items-center justify-center rounded-full ${toneCls}`}>
        <Icon className="size-7" />
      </span>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export default async function SurveyPage({ params }: PageProps<"/survey/[token]">) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const state = await loadSurvey(token, ip);
  const showroom = "brand" in state ? state.brand : null;
  const brand = await getPublicBranding(showroom?.brandName);

  return (
    <SurveyShell logoUrl={brand.logoUrl} brandName={brand.name}>
      {state.state === "open" && (
        <>
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">
              {state.surveyType === "purchased" ? "Thank you for shopping with us" : "Thank you for visiting us"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">5 quick questions · about 1 minute</p>
          </div>
          <SurveyForm token={token} surveyType={state.surveyType} brandName={brand.name} brandCode={showroom?.brandName ? showroom.code : null} />
        </>
      )}
      {state.state === "completed" && (
        <StateMessage icon={CheckCircle2} tone="good" title="You've already shared your feedback" body={`Thank you — your response has been recorded. We truly appreciate you taking the time to help ${brand.name} improve.`} />
      )}
      {state.state === "expired" && (
        <StateMessage icon={Clock} tone="warn" title="This survey link has expired" body="Survey links are valid for a limited time. Thank you for your interest — if you'd still like to share feedback, please contact our customer care team." />
      )}
      {state.state === "invalid" && (
        <StateMessage icon={LinkIcon} title="We couldn't find this survey" body="Please check that you opened the full link from your SMS message." />
      )}
      {(state.state === "rate_limited" || state.state === "unavailable") && (
        <StateMessage icon={AlertTriangle} tone="warn" title="Please try again shortly" body="We're unable to load the survey right now. Please try again in a few minutes." />
      )}
    </SurveyShell>
  );
}
