import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { canSeeContactDetails, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, todayColombo } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import { GOOGLE_REVIEW_OPTIONS, PURCHASE_STATUS_LABELS, SALES_STEPS, SOURCE_LABELS, type CustomerSource, type InvitationStatus, type PurchaseStatus } from "@/lib/types";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { InvitationStatusBadge, NpsCategoryBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/admin/empty-state";
import { AddInteractionDialog, EditContactDialog, OptOutToggle, ResendButton, SendSurveyButton } from "./customer-actions";

export const metadata: Metadata = { title: "Customer" };

interface Interaction {
  id: string;
  interaction_date: string;
  purchase_status: PurchaseStatus;
  purchase_date: string | null;
  product_category: string | null;
  product_model: string | null;
  invoice_number: string | null;
  source: CustomerSource;
  notes: string | null;
  android_phones: number;
  apple_phones: number;
  other_devices: number;
  commission_accessories: number;
  non_commission_accessories: number;
  visit_start: string | null;
  visit_end: string | null;
  sales_steps: string[];
  google_review: string;
  kpi_tracked: boolean;
  branches: { name: string } | null;
  employees: { full_name: string } | null;
  survey_invitations: {
    id: string;
    status: InvitationStatus;
    survey_type: "purchased" | "non_purchased";
    created_at: string;
    sent_at: string | null;
    opened_at: string | null;
    completed_at: string | null;
    expires_at: string;
    send_count: number;
    last_error: string | null;
    survey_responses: { id: string; nps_score: number; nps_category: string; additional_feedback: string | null }[];
  }[];
}

const REVIEW_LABELS = Object.fromEntries(GOOGLE_REVIEW_OPTIONS.map((o) => [o.value, o.label]));

/** One line for the rep scorecard data recorded on a visit. */
function salesSummary(r: Interaction) {
  const sold = [
    r.android_phones && `${r.android_phones} Android`,
    r.apple_phones && `${r.apple_phones} Apple`,
    r.other_devices && `${r.other_devices} other device${r.other_devices === 1 ? "" : "s"}`,
    r.commission_accessories && `${r.commission_accessories} commission acc.`,
    r.non_commission_accessories && `${r.non_commission_accessories} non-comm. acc.`,
  ].filter(Boolean);
  const parts = [
    sold.length ? `Sold: ${sold.join(", ")}` : null,
    r.visit_start && r.visit_end ? `${r.visit_start.slice(0, 5)}–${r.visit_end.slice(0, 5)}` : r.visit_start ? `From ${r.visit_start.slice(0, 5)}` : null,
    `${r.sales_steps.length}/${SALES_STEPS.length} sales steps`,
    `Google review: ${REVIEW_LABELS[r.google_review] ?? r.google_review}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const profile = await requirePageRole();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: customer }, { data: interactions }, lookups] = await Promise.all([
    supabase.from("customers").select("id, full_name, mobile, email, sms_opt_out, sms_opt_out_at, anonymised_at, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("customer_interactions")
      .select(
        "id, interaction_date, purchase_status, purchase_date, product_category, product_model, invoice_number, source, notes, android_phones, apple_phones, other_devices, commission_accessories, non_commission_accessories, visit_start, visit_end, sales_steps, google_review, kpi_tracked, branches(name), employees(full_name), survey_invitations(id, status, survey_type, created_at, sent_at, opened_at, completed_at, expires_at, send_count, last_error, survey_responses(id, nps_score, nps_category, additional_feedback))",
      )
      .eq("customer_id", id)
      .order("interaction_date", { ascending: false }),
    getLookups(supabase, { profile }),
  ]);
  if (!customer) notFound();
  const rows = (interactions ?? []) as unknown as Interaction[];
  const showContact = canSeeContactDetails(profile);
  const now = new Date();

  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader
        title={customer.full_name}
        description={`Customer since ${formatDate(customer.created_at)} · ${rows.length} interaction${rows.length === 1 ? "" : "s"}`}
        actions={
          !customer.anonymised_at && (
            <>
              {showContact && <EditContactDialog customerId={customer.id} initial={{ full_name: customer.full_name, mobile: formatMobile(customer.mobile), email: customer.email ?? "" }} />}
              <OptOutToggle customerId={customer.id} optedOut={customer.sms_opt_out} />
              <AddInteractionDialog customerId={customer.id} branches={lookups.branches} employees={lookups.employees} defaultBranch={profile.branch_id} today={todayColombo()} defaultEmployee={profile.role === "staff" ? profile.employee_id : null} lockEmployee={profile.role === "staff"} />
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
        <Panel title="Contact">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" />
              <dd className="tabular">{showContact ? formatMobile(customer.mobile) : maskMobile(customer.mobile)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" />
              <dd>{showContact ? customer.email ?? "—" : customer.email ? "Hidden" : "—"}</dd>
            </div>
            <div className="pt-2">
              <dt className="text-xs text-muted-foreground">SMS consent</dt>
              <dd className={customer.sms_opt_out ? "font-medium text-destructive" : "font-medium text-[#087a08]"}>
                {customer.sms_opt_out ? `Opted out ${customer.sms_opt_out_at ? formatDate(customer.sms_opt_out_at) : ""}` : "May receive survey SMS"}
              </dd>
            </div>
            {customer.anonymised_at && <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">Personal data anonymised on {formatDate(customer.anonymised_at)} under the retention policy.</p>}
          </dl>
        </Panel>
        <Panel title="Purchase & visit history" bodyClassName="px-0 pb-0">
          {rows.length === 0 ? (
            <EmptyState title="No interactions you can access" />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const invs = [...r.survey_invitations].sort((a, b) => b.created_at.localeCompare(a.created_at));
                const live = invs.find((i) => i.status !== "expired" && !(i.status !== "completed" && new Date(i.expires_at) <= now));
                const response = invs.flatMap((i) => i.survey_responses)[0];
                const surveyType = r.purchase_status === "purchased" ? "purchased" : "non_purchased";
                return (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          <span className={r.purchase_status === "purchased" ? "text-series-1" : "text-[#c4521f]"}>{PURCHASE_STATUS_LABELS[r.purchase_status]}</span>
                          <span className="text-muted-foreground"> · {formatDate(r.interaction_date)} · {r.branches?.name}</span>
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {[r.product_category, r.product_model].filter(Boolean).join(" · ") || "No product recorded"}
                          {r.invoice_number && ` · Invoice ${r.invoice_number}`}
                          {r.employees && ` · Served by ${r.employees.full_name}`}
                          {` · ${SOURCE_LABELS[r.source] ?? r.source}`}
                        </p>
                        {r.kpi_tracked && <p className="mt-0.5 text-xs text-muted-foreground">{salesSummary(r)}</p>}
                        {r.notes && <p className="mt-1 text-xs text-muted-foreground italic">{r.notes}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {live && live.status !== "completed" && <ResendButton invitationId={live.id} failed={live.status === "failed"} />}
                        {!live && !customer.anonymised_at && <SendSurveyButton interactionId={r.id} surveyType={surveyType} disabled={customer.sms_opt_out} />}
                      </div>
                    </div>
                    {invs.length > 0 && (
                      <div className="mt-3 space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
                        {invs.map((i) => (
                          <div key={i.id} className="flex flex-wrap items-center gap-2">
                            <InvitationStatusBadge status={i.status} />
                            <span className="text-muted-foreground">
                              Created {formatDateTime(i.created_at)}
                              {i.sent_at && ` · sent ${formatDateTime(i.sent_at)}`}
                              {i.opened_at && ` · opened ${formatDateTime(i.opened_at)}`}
                              {i.completed_at && ` · completed ${formatDateTime(i.completed_at)}`}
                              {i.status !== "completed" && i.status !== "expired" && ` · expires ${formatDate(i.expires_at)}`}
                              {i.send_count > 1 && ` · ${i.send_count} sends`}
                            </span>
                            {i.last_error && i.status === "failed" && <span className="text-destructive">{i.last_error}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {response && (
                      <Link href={`/admin/feedback/${response.id}`} className="mt-3 flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40">
                        <NpsCategoryBadge category={response.nps_category} score={response.nps_score} />
                        <p className="line-clamp-2 text-sm text-foreground">{response.additional_feedback ?? <span className="text-muted-foreground">No written comment</span>}</p>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
