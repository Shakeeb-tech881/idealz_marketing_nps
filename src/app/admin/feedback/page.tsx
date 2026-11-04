import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText, Star } from "lucide-react";
import { canSeeContactDetails, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import { NON_PURCHASE_REASON_LABELS, type NonPurchaseReason } from "@/lib/survey/definitions";
import type { ResolutionStatus } from "@/lib/types";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination } from "@/components/admin/pagination";
import { NpsCategoryBadge, ResolutionBadge } from "@/components/admin/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FeedbackFilters } from "./feedback-filters";

export const metadata: Metadata = { title: "Customer feedback" };

const PAGE_SIZE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

interface Row {
  id: string;
  submitted_at: string;
  survey_type: "purchased" | "non_purchased";
  nps_score: number;
  nps_category: string;
  staff_service_rating: number;
  non_purchase_reason: NonPurchaseReason | null;
  additional_feedback: string | null;
  resolution_status: ResolutionStatus;
  customers: { full_name: string; mobile: string | null } | null;
  branches: { name: string } | null;
  employees: { full_name: string } | null;
}

export default async function FeedbackPage({ searchParams }: PageProps<"/admin/feedback">) {
  const profile = await requirePageRole();
  const sp = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const category = ["promoter", "passive", "detractor"].find((c) => c === one(sp.category)) ?? null;
  const status = ["new", "under_review", "contact_required", "resolved", "closed"].find((c) => c === one(sp.status)) ?? null;
  const type = ["purchased", "non_purchased"].find((c) => c === one(sp.type)) ?? null;
  const complaints = one(sp.complaints) === "1";
  const q = one(sp.q)?.trim().slice(0, 80);

  let query = supabase
    .from("survey_responses")
    .select(
      `id, submitted_at, survey_type, nps_score, nps_category, staff_service_rating, non_purchase_reason, additional_feedback, resolution_status, ${q ? "customers!inner(full_name, mobile)" : "customers(full_name, mobile)"}, branches(name), employees(full_name)`,
      { count: "exact" },
    )
    .order("submitted_at", { ascending: false });
  if (category) query = query.eq("nps_category", category);
  if (status) query = query.eq("resolution_status", status);
  if (type) query = query.eq("survey_type", type);
  if (uuid(one(sp.branch))) query = query.eq("branch_id", one(sp.branch)!);
  if (uuid(one(sp.employee))) query = query.eq("employee_id", one(sp.employee)!);
  if (date(one(sp.from))) query = query.gte("submitted_at", `${one(sp.from)}T00:00:00+05:30`);
  if (date(one(sp.to))) query = query.lte("submitted_at", `${one(sp.to)}T23:59:59.999+05:30`);
  if (complaints) query = query.not("additional_feedback", "is", null).or("nps_category.eq.detractor,staff_service_rating.lte.2,overall_experience_rating.lte.2,product_satisfaction.lte.2");
  if (q) {
    const safe = q.replace(/[%,()]/g, "");
    query = query.or(`full_name.ilike.%${safe}%,mobile.ilike.%${safe.replace(/[^\d]/g, "") || "__none__"}%`, { referencedTable: "customers" });
  }

  const start = (page - 1) * PAGE_SIZE;
  const [{ data, count, error }, lookups] = await Promise.all([query.range(start, start + PAGE_SIZE - 1), getLookups(supabase, { profile })]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const showMobile = canSeeContactDetails(profile);

  return (
    <>
      <PageHeader title="Customer feedback" description="Every completed survey. Identify detractors and complaints, assign follow-ups and track resolution." />
      <FeedbackFilters branches={lookups.branches} employees={lookups.employees} />
      <Panel bodyClassName="px-0 pb-0" className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="No feedback matches these filters" description="Responses appear here as soon as customers submit their surveys." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Branch / employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>NPS</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead className="min-w-72">Feedback</TableHead>
                    <TableHead className="pr-5">Follow-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="pl-5 tabular text-muted-foreground">{formatDate(r.submitted_at)}</TableCell>
                      <TableCell>
                        <Link href={`/admin/feedback/${r.id}`} className="font-medium hover:underline">{r.customers?.full_name ?? "—"}</Link>
                        <p className="text-xs text-muted-foreground tabular">{showMobile ? formatMobile(r.customers?.mobile) : maskMobile(r.customers?.mobile)}</p>
                      </TableCell>
                      <TableCell>
                        {r.branches?.name ?? "—"}
                        <p className="text-xs text-muted-foreground">{r.employees?.full_name ?? "No employee"}</p>
                      </TableCell>
                      <TableCell className="text-sm">{r.survey_type === "purchased" ? "Purchased" : "Non-purchased"}</TableCell>
                      <TableCell><NpsCategoryBadge category={r.nps_category} score={r.nps_score} /></TableCell>
                      <TableCell className="tabular"><span className="inline-flex items-center gap-1">{r.staff_service_rating}<Star className="size-3.5 fill-amber-400 text-amber-400" /></span></TableCell>
                      <TableCell className="max-w-md whitespace-normal">
                        {r.non_purchase_reason && <p className="mb-0.5 text-xs font-medium text-[#c4521f]">{NON_PURCHASE_REASON_LABELS[r.non_purchase_reason]}</p>}
                        <p className="line-clamp-2 text-sm">{r.additional_feedback ?? <span className="text-muted-foreground">—</span>}</p>
                      </TableCell>
                      <TableCell className="pr-5"><ResolutionBadge status={r.resolution_status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} baseHref="/admin/feedback" params={Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]))} />
          </>
        )}
      </Panel>
    </>
  );
}
