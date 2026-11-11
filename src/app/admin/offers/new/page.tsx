import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ORG_WIDE, requirePageRole } from "@/lib/auth";
import { insightFiltersToParams, parseInsightFilters } from "@/lib/insights/filters";
import { PageHeader } from "@/components/admin/page-header";
import { OfferComposer } from "./offer-composer";

export const metadata: Metadata = { title: "New offer" };

export default async function NewOfferPage({ searchParams }: PageProps<"/admin/offers/new">) {
  await requirePageRole(ORG_WIDE);
  const sp = await searchParams;
  const filters = Object.fromEntries(insightFiltersToParams(parseInsightFilters(sp)).entries());
  const back = new URLSearchParams(filters).toString();
  return (
    <>
      <Link href={`/admin/insights${back ? `?${back}` : ""}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Change who gets it (Customer Insights)
      </Link>
      <PageHeader title="New offer" description="Write the message, check who gets it and what it costs, then save. Nothing is sent until you press Start on the next screen." />
      <OfferComposer filters={filters} />
    </>
  );
}
