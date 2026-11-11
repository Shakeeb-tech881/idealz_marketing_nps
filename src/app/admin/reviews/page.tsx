import type { Metadata } from "next";
import Link from "next/link";
import { Info, Star } from "lucide-react";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMobile } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { listReviewChecks } from "@/server/services/reviews";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReviewButtons } from "./review-buttons";

export const metadata: Metadata = { title: "Google reviews" };

const TABS = [
  { key: "to_check", label: "To check" },
  { key: "checked", label: "Checked" },
  { key: "all", label: "All" },
] as const;

const STATUS: Record<string, [string, string]> = {
  asked: ["Rep asked – not checked", "bg-muted text-muted-foreground"],
  confirmed: ["Found on Google", "bg-promoter-soft text-[#087a08]"],
  not_found: ["Not found", "bg-detractor-soft text-[#a52727]"],
};

export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "30d");
  const show = TABS.find((t) => t.key === sp.show)?.key ?? "to_check";
  const supabase = await createClient();
  const [lookups, rows] = await Promise.all([getLookups(supabase, { profile }), listReviewChecks(supabase, filters, show)]);
  const qs = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "show") p.set(k, v);
    if (key !== "to_check") p.set("show", key);
    const s = p.toString();
    return `/admin/reviews${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Google reviews" description="Confirm which customers really left a Google review. Only confirmed reviews count on the Rep Scorecard." />
      <div className="mb-4 flex gap-3 rounded-xl border border-series-1/20 bg-blue-50/60 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-series-1" />
        <p>
          Sales reps can only record that they <strong>asked</strong> for a review. Open your Google Business Profile reviews, look for the customer&apos;s name around the visit date,
          then click <strong>Found on Google</strong> or <strong>Not found</strong>. Only <strong>found</strong> reviews count for the rep (per working day, compared with the showroom).
        </p>
      </div>
      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} show={["range", "branch", "employee"]} defaultRange="30d" />
      <div className="mb-3 flex gap-1">
        {TABS.map((t) => (
          <Link key={t.key} href={qs(t.key)} className={cn("rounded-full px-3 py-1 text-sm", show === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {t.label}
          </Link>
        ))}
      </div>
      <Panel bodyClassName="px-0 pb-0">
        {rows.length === 0 ? (
          <EmptyState icon={Star} title={show === "to_check" ? "Nothing to check" : "No reviews in this period"} description={show === "to_check" ? "Every review request in this period has been checked." : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-5">Visit date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Sales rep</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const [label, cls] = STATUS[r.google_review] ?? [r.google_review, ""];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-5 whitespace-nowrap">{formatDate(r.interaction_date)}</TableCell>
                      <TableCell>
                        <p className="font-medium">{r.customers?.full_name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground tabular">{r.customers?.mobile ? formatMobile(r.customers.mobile) : ""}</p>
                      </TableCell>
                      <TableCell><p>{r.employees?.full_name ?? "—"}</p><p className="text-xs text-muted-foreground">{r.branches?.name}</p></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.product_model ?? "—"}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", cls)}>{label}</span>
                        {r.review_checked_at && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.checker?.full_name ?? "Manager"} · {formatDateTime(r.review_checked_at)}</p>}
                      </TableCell>
                      <TableCell className="pr-5 text-right"><ReviewButtons id={r.id} status={r.google_review} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}
