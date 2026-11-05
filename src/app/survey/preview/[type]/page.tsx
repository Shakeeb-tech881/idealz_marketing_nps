import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { SurveyShell } from "@/components/survey/survey-shell";
import { SurveyForm } from "@/components/survey/survey-form";
import { getPublicBranding, getShowroomBrand } from "@/server/services/public-branding";

export const metadata: Metadata = { title: { absolute: "Survey preview" }, robots: { index: false, follow: false } };

/** Read-only preview of the customer survey. Nothing is saved. */
export default async function SurveyPreviewPage({ params, searchParams }: PageProps<"/survey/preview/[type]">) {
  const { type } = await params;
  if (type !== "purchased" && type !== "non_purchased") notFound();
  const sp = await searchParams;
  const showroom = await getShowroomBrand(typeof sp.branch === "string" ? sp.branch : null);
  const brand = await getPublicBranding(showroom?.brandName);
  return (
    <SurveyShell logoUrl={brand.logoUrl} brandName={brand.name}>
      <p className="mb-6 flex items-center justify-center gap-2 rounded-lg bg-passive-soft px-3 py-2 text-xs font-medium text-[#8a5f00]">
        <Eye className="size-3.5" /> Preview — responses are not saved
      </p>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{type === "purchased" ? "Thank you for shopping with us" : "Thank you for visiting us"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">5 quick questions · about 1 minute</p>
      </div>
      <SurveyForm token="preview" surveyType={type} preview brandName={brand.name} brandCode={showroom?.brandName ? showroom.code : null} />
    </SurveyShell>
  );
}
