import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { canSeeContactDetails, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatLKR, formatRating, todayColombo } from "@/lib/format";
import { NON_PURCHASE_REASON_LABELS, type NonPurchaseReason } from "@/lib/survey/definitions";
import { formatMobile, maskMobile } from "@/lib/phone";
import { GOOGLE_REVIEW_OPTIONS, PURCHASE_STATUS_LABELS, SALES_STEPS, SOURCE_LABELS, type CustomerSource, type InvitationStatus, type PurchaseStatus } from "@/lib/types";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { InvitationStatusBadge, NpsCategoryBadge } from "@/components/admin/badges";
import { EmptyState } from "@/components/admin/empty-state";
import { AddInteractionDialog, EditContactDialog, OffersOptOutToggle, OptOutToggle, ResendButton, SendSurveyButton } from "./customer-actions";

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
  commission_accessories_value: number;
  non_commission_accessories_value: number;
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
    survey_responses: SurveyResponse[];
  }[];
}

const REVIEW_LABELS = Object.fromEntries(GOOGLE_REVIEW_OPTIONS.map((o) => [o.value, o.label]));

/** One line for the rep scorecard data recorded on a visit. */
function salesSummary(r: Interaction) {
  const sold = [
    r.android_phones && `${r.android_phones} Android`,
    r.apple_phones && `${r.apple_phones} Apple`,
    r.other_devices && `${r.other_devices} other device${r.other_devices === 1 ? "" : "s"}`,
    Number(r.commission_accessories_value) > 0 && `${formatLKR(Number(r.commission_accessories_value))} commission acc.`,
    Number(r.non_commission_accessories_value) > 0 && `${formatLKR(Number(r.non_commission_accessories_value))} non-comm. acc.`,
  ].filter(Boolean);
  const parts = [
    sold.length ? `Sold: ${sold.join(", ")}` : null,
    r.visit_start && r.visit_end ? `${r.visit_start.slice(0, 5)}–${r.visit_end.slice(0, 5)}` : r.visit_start ? `From ${r.visit_start.slice(0, 5)}` : null,
    `${r.sales_steps.length}/${SALES_STEPS.length} sales steps`,
    `Google review: ${REVIEW_LABELS[r.google_review] ?? r.google_review}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

interface SurveyResponse {
  id: string;
  nps_score: number;
  nps_category: string;
  additional_feedback: string | null;
  staff_service_rating: number | null;
  product_satisfaction: number | null;
  overall_experience_rating: number | null;
  product_pricing_satisfaction: number | null;
  non_purchase_reason: NonPurchaseReason | null;
  other_reason_description: string | null;
  submitted_at: string;
}

interface MessageRow {
  id: string;
  created_at: string;
  status: string;
  body_redacted: string;
  error_message: string | null;
  is_test: boolean;
  sender_id: string | null;
  invitation_id: string | null;
  offer_campaigns: { name: string } | null;
}

const MESSAGE_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "text-muted-foreground" },
  sent: { label: "Accepted by provider", cls: "text-blue-700" },
  delivered: { label: "Delivered", cls: "text-[#087a08]" },
  failed: { label: "Failed", cls: "text-[#a52727]" },
};

/** Every answer of one survey, in plain words. */
function Answers({ r }: { r: SurveyResponse }) {
  const items: [string, string][] = [];
  const stars = (v: number | null) => (v === null ? null : `${v} / 5`);
  if (r.product_satisfaction !== null) items.push(["Product", stars(r.product_satisfaction)!]);
  if (r.staff_service_rating !== null) items.push(["Staff service", stars(r.staff_service_rating)!]);
  if (r.overall_experience_rating !== null) items.push(["Overall experience", stars(r.overall_experience_rating)!]);
  if (r.product_pricing_satisfaction !== null) items.push(["Availability & pricing", stars(r.product_pricing_satisfaction)!]);
  if (r.non_purchase_reason) {
    items.push(["Why not purchased", `${NON_PURCHASE_REASON_LABELS[r.non_purchase_reason] ?? r.non_purchase_reason}${r.other_reason_description ? ` – ${r.other_reason_description}` : ""}`]);
  }
  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <NpsCategoryBadge category={r.nps_category} score={r.nps_score} />
          <span className="text-xs text-muted-foreground">Would recommend: {r.nps_score}/10 · answered {formatDateTime(r.submitted_at)}</span>
        </div>
        <Link href={`/admin/feedback/${r.id}`} className="text-xs font-medium text-primary hover:underline">Open feedback & follow-up →</Link>
      </div>
      {items.length > 0 && (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {items.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed border-border/70 py-0.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-sm">{r.additional_feedback ?? <span className="text-muted-foreground">No written comment</span>}</p>
    </div>
  );
}

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const profile = await requirePageRole();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: customer }, { data: interactions }, lookups, { data: messages }] = await Promise.all([
    supabase.from("customers").select("id, full_name, mobile, email, sms_opt_out, sms_opt_out_at, offers_opt_out, offers_opt_out_at, anonymised_at, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("customer_interactions")
      .select(
        "id, interaction_date, purchase_status, purchase_date, product_category, product_model, invoice_number, source, notes, android_phones, apple_phones, other_devices, commission_accessories, non_commission_accessories, commission_accessories_value, non_commission_accessories_value, visit_start, visit_end, sales_steps, google_review, kpi_tracked, branches(name), employees(full_name), survey_invitations(id, status, survey_type, created_at, sent_at, opened_at, completed_at, expires_at, send_count, last_error, survey_responses(id, nps_score, nps_category, additional_feedback, staff_service_rating, product_satisfaction, overall_experience_rating, product_pricing_satisfaction, non_purchase_reason, other_reason_description, submitted_at))",
      )
      .eq("customer_id", id)
      .order("interaction_date", { ascending: false }),
    getLookups(supabase, { profile }),
    supabase
      .from("message_logs")
      .select("id, created_at, status, body_redacted, error_message, is_test, sender_id, invitation_id, offer_campaigns(name)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (!customer) notFound();
  const rows = (interactions ?? []) as unknown as Interaction[];
  const sms = (messages ?? []) as unknown as MessageRow[];

  // 360 summary
  const purchases = rows.filter((r) => r.purchase_status === "purchased");
  const models = [...new Set(purchases.map((r) => r.product_model).filter((m): m is string => !!m))];
  const responses = rows.flatMap((r) => r.survey_invitations.flatMap((i) => i.survey_responses)).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const staffRatings = responses.map((r) => r.staff_service_rating).filter((v): v is number => v !== null);
  const avgStaff = staffRatings.length ? staffRatings.reduce((a, b) => a + b, 0) / staffRatings.length : null;
  const dates = rows.map((r) => r.interaction_date).sort();
  const stats: [string, React.ReactNode][] = [
    ["Purchases", purchases.length],
    ["Visits", rows.length],
    ["First visit", dates[0] ? formatDate(dates[0]) : "—"],
    ["Last visit", dates.length ? formatDate(dates[dates.length - 1]) : "—"],
    ["Surveys answered", responses.length],
    ["Latest feedback", responses[0] ? <NpsCategoryBadge key="nps" category={responses[0].nps_category} score={responses[0].nps_score} /> : "—"],
    ["Avg staff rating", avgStaff === null ? "—" : `${formatRating(avgStaff)} / 5`],
  ];
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
              <OffersOptOutToggle customerId={customer.id} optedOut={customer.offers_opt_out} />
              <AddInteractionDialog customerId={customer.id} branches={lookups.branches} employees={lookups.employees} defaultBranch={profile.branch_id} today={todayColombo()} defaultEmployee={profile.role === "staff" ? profile.employee_id : null} lockEmployee={profile.role === "staff"} />
            </>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <div className="mt-1 text-lg font-semibold tabular">{value}</div>
          </div>
        ))}
      </div>
      {models.length > 0 && (
        <p className="-mt-1 mb-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Models bought:</span> {models.join(" · ")}
        </p>
      )}
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
            <div>
              <dt className="text-xs text-muted-foreground">Offer SMS</dt>
              <dd className={customer.offers_opt_out || customer.sms_opt_out ? "font-medium text-destructive" : "font-medium text-[#087a08]"}>
                {customer.sms_opt_out ? "No SMS at all" : customer.offers_opt_out ? `Stopped offers ${customer.offers_opt_out_at ? formatDate(customer.offers_opt_out_at) : ""}` : "May receive offers"}
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
                    {invs.flatMap((i) => i.survey_responses).map((resp) => <Answers key={resp.id} r={resp} />)}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      <Panel className="mt-4" title="SMS sent to this customer" description="Survey and offer messages, newest first (links are hidden)." bodyClassName="px-0 pb-0">
        {sms.length === 0 ? (
          <EmptyState title="No SMS sent yet" />
        ) : (
          <ul className="divide-y divide-border">
            {sms.map((m) => {
              const st = MESSAGE_STATUS[m.status] ?? { label: m.status, cls: "" };
              return (
                <li key={m.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{m.offer_campaigns ? `Offer: ${m.offer_campaigns.name}` : m.invitation_id ? "Survey" : "SMS"}</span>
                    <span className={`font-medium ${st.cls}`}>{st.label}</span>
                    {m.is_test && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">TEST</span>}
                    <span className="text-muted-foreground">{formatDateTime(m.created_at)}{m.sender_id ? ` · from ${m.sender_id}` : ""}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{m.body_redacted}</p>
                  {m.status === "failed" && m.error_message && <p className="mt-0.5 text-xs text-destructive">{m.error_message}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
