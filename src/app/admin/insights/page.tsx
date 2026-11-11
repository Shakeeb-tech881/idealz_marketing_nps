import type { Metadata } from "next";
import Link from "next/link";
import { Download, Megaphone, UsersRound } from "lucide-react";
import { MANAGERS, canSeeContactDetails, isOrgWide, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatRating } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import { describeInsightFilters, insightFiltersToParams, parseInsightFilters } from "@/lib/insights/filters";
import { getCustomerInsights } from "@/server/services/insights";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination } from "@/components/admin/pagination";
import { NpsCategoryBadge } from "@/components/admin/badges";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InsightsFilters } from "./insights-filters";

export const metadata: Metadata = { title: "Customer insights" };

const PAGE_SIZE = 50;

export default async function InsightsPage({ searchParams }: PageProps<"/admin/insights">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const f = parseInsightFilters(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const supabase = await createClient();
  const [lookups, { rows, total }] = await Promise.all([getLookups(supabase, { profile }), getCustomerInsights(supabase, f, page, PAGE_SIZE)]);
  const showContact = canSeeContactDetails(profile);
  const params = insightFiltersToParams(f);
  const qs = params.toString();
  const branchName = f.branch ? lookups.branches.find((b) => b.id === f.branch)?.name : null;
  const exportHref = (format: string) => `/api/reports?type=customer_insights&format=${format}${qs ? `&${qs}` : ""}`;

  return (
    <>
      <PageHeader
        title="Customer insights"
        description="Every customer with what they bought, where, and what they told us. Filter to find upgrade candidates or unhappy customers."
        actions={
          <>
            <a href={exportHref("xlsx")} className={buttonVariants({ variant: "outline" })}><Download data-icon="inline-start" /> Excel</a>
            <a href={exportHref("pdf")} className={buttonVariants({ variant: "outline" })}><Download data-icon="inline-start" /> PDF</a>
            {isOrgWide(profile) && (
              <Link href={`/admin/offers/new${qs ? `?${qs}` : ""}`} className={buttonVariants()}>
                <Megaphone data-icon="inline-start" /> Send offer to these customers
              </Link>
            )}
          </>
        }
      />
      <InsightsFilters branches={lookups.branches} />
      <Panel
        title={`${total.toLocaleString()} customer${total === 1 ? "" : "s"}`}
        description={`Showing: ${describeInsightFilters(f, branchName)}`}
        bodyClassName="px-0 pb-0"
      >
        {rows.length === 0 ? (
          <EmptyState icon={UsersRound} title="No customers match these filters" description="Try a shorter model name (e.g. “iPhone 15” instead of “iPhone 15 Pro Max 256GB”) or clear some filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Customer</TableHead>
                    <TableHead>Showroom</TableHead>
                    <TableHead>Models bought</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead>Last purchase</TableHead>
                    <TableHead>Latest feedback</TableHead>
                    <TableHead className="text-right">Staff rating</TableHead>
                    <TableHead className="min-w-56">Latest comment</TableHead>
                    <TableHead className="pr-5">Offer SMS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.customerId}>
                      <TableCell className="pl-5">
                        <Link href={`/admin/customers/${r.customerId}`} className="font-medium hover:underline">{r.fullName}</Link>
                        <p className="text-xs text-muted-foreground tabular">{r.mobile ? (showContact ? formatMobile(r.mobile) : maskMobile(r.mobile)) : "—"}</p>
                      </TableCell>
                      <TableCell className="text-sm">{r.branches.join(", ") || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {r.models.length ? (
                          <>
                            {r.models.slice(0, 2).join(", ")}
                            {r.models.length > 2 && <span className="text-muted-foreground"> +{r.models.length - 2}</span>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular">{r.purchases}</TableCell>
                      <TableCell className="text-right tabular">{r.visits}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.lastPurchase ? formatDate(r.lastPurchase) : "—"}</TableCell>
                      <TableCell>
                        {r.latestNpsCategory ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <NpsCategoryBadge category={r.latestNpsCategory} score={r.latestNps ?? undefined} />
                            <span className="text-[11px] text-muted-foreground">{r.responses} survey{r.responses === 1 ? "" : "s"}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No answer</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular">{r.avgStaffRating === null ? "—" : formatRating(r.avgStaffRating)}</TableCell>
                      <TableCell className="max-w-72 text-sm"><p className="line-clamp-2">{r.latestComment ?? <span className="text-muted-foreground">—</span>}</p></TableCell>
                      <TableCell className="pr-5 text-xs">
                        {r.smsOptOut || r.offersOptOut ? <span className="font-medium text-[#a52727]">Stopped</span> : !r.mobile ? <span className="text-muted-foreground">No mobile</span> : <span className="text-[#087a08]">Allowed</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} baseHref="/admin/insights" params={Object.fromEntries(params.entries())} />
          </>
        )}
      </Panel>
    </>
  );
}
