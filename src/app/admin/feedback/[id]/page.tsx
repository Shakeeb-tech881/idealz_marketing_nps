import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import { canSeeContactDetails, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import { EXPERIENCE_SCALE, NON_PURCHASE_REASON_LABELS, SATISFACTION_SCALE, STAR_SCALE, SURVEYS, type NonPurchaseReason } from "@/lib/survey/definitions";
import { RESOLUTION_LABELS, ROLE_LABELS, type ResolutionStatus } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { NpsCategoryBadge, ResolutionBadge } from "@/components/admin/badges";
import { FollowUpForm, NoteForm } from "./follow-up";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbackDetailPage({ params }: PageProps<"/admin/feedback/[id]">) {
  const profile = await requirePageRole();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("survey_responses")
    .select(
      "id, submitted_at, survey_type, nps_score, nps_category, staff_service_rating, product_satisfaction, overall_experience_rating, product_pricing_satisfaction, non_purchase_reason, other_reason_description, additional_feedback, resolution_status, assigned_to, follow_up_due, branch_id, customer_id, customers(id, full_name, mobile, email), branches(name), employees(full_name), customer_interactions(interaction_date, product_category, product_model, invoice_number)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  const [{ data: notes }, { data: actions }, { data: assignees }] = await Promise.all([
    supabase.from("feedback_notes").select("id, body, created_at, profiles:created_by(full_name, email)").eq("response_id", id).order("created_at", { ascending: true }),
    supabase.from("feedback_actions").select("id, action_type, from_status, to_status, due_date, details, created_at, actor:created_by(full_name), assignee:assigned_to(full_name)").eq("response_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email, role, branch_id").eq("is_active", true).in("role", ["super_admin", "management", "branch_manager"]).order("full_name"),
  ]);

  const c = r.customers as unknown as { id: string; full_name: string; mobile: string | null; email: string | null } | null;
  const ix = r.customer_interactions as unknown as { interaction_date: string; product_category: string | null; product_model: string | null; invoice_number: string | null } | null;
  const showContact = canSeeContactDetails(profile);
  const canManage = profile.role !== "staff";
  const q = SURVEYS[r.survey_type as "purchased" | "non_purchased"];
  const label = (scale: typeof SATISFACTION_SCALE, v: number | null) => (v ? `${scale[v - 1]?.emoji ?? ""} ${scale[v - 1]?.label ?? v}` : "—");

  const answers =
    r.survey_type === "purchased"
      ? [
          { q: q[0].text, a: <NpsCategoryBadge category={r.nps_category} score={r.nps_score} /> },
          { q: q[1].text, a: label(SATISFACTION_SCALE, r.product_satisfaction) },
          { q: q[2].text, a: <span className="inline-flex items-center gap-1">{Array.from({ length: 5 }, (_, i) => <Star key={i} className={`size-4 ${i < r.staff_service_rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />)}<span className="ml-1">{STAR_SCALE[r.staff_service_rating - 1].label}</span></span> },
          { q: q[3].text, a: label(EXPERIENCE_SCALE, r.overall_experience_rating) },
          { q: q[4].text, a: r.additional_feedback ?? <span className="text-muted-foreground">No comment</span> },
        ]
      : [
          { q: q[0].text, a: <NpsCategoryBadge category={r.nps_category} score={r.nps_score} /> },
          { q: q[1].text, a: r.non_purchase_reason ? `${NON_PURCHASE_REASON_LABELS[r.non_purchase_reason as NonPurchaseReason]}${r.other_reason_description ? ` — “${r.other_reason_description}”` : ""}` : "—" },
          { q: q[2].text, a: <span className="inline-flex items-center gap-1">{Array.from({ length: 5 }, (_, i) => <Star key={i} className={`size-4 ${i < r.staff_service_rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />)}<span className="ml-1">{STAR_SCALE[r.staff_service_rating - 1].label}</span></span> },
          { q: q[3].text, a: label(SATISFACTION_SCALE, r.product_pricing_satisfaction) },
          { q: q[4].text, a: r.additional_feedback ?? <span className="text-muted-foreground">No comment</span> },
        ];

  const describe = (a: { action_type: string; from_status: ResolutionStatus | null; to_status: ResolutionStatus | null; due_date: string | null; details: string | null; assignee: { full_name: string } | null }) => {
    switch (a.action_type) {
      case "received": return "Survey response received";
      case "status_change": return `Status changed${a.from_status ? ` from ${RESOLUTION_LABELS[a.from_status]}` : ""} to ${a.to_status ? RESOLUTION_LABELS[a.to_status] : "—"}`;
      case "assignment": return a.assignee ? `Assigned to ${a.assignee.full_name}` : "Unassigned";
      case "follow_up_scheduled": return `Follow-up due ${formatDate(a.due_date)}`;
      case "note_added": return `Note: ${a.details ?? ""}`;
      default: return a.action_type;
    }
  };

  return (
    <>
      <Link href="/admin/feedback" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customer feedback
      </Link>
      <PageHeader
        title={c?.full_name ?? "Customer"}
        description={`${r.survey_type === "purchased" ? "Purchased" : "Non-purchased"} customer survey · submitted ${formatDateTime(r.submitted_at)}`}
        actions={<ResolutionBadge status={r.resolution_status as ResolutionStatus} />}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Survey answers">
            <ol className="divide-y divide-border">
              {answers.map((x, i) => (
                <li key={i} className="py-3 first:pt-0">
                  <p className="text-xs text-muted-foreground">Q{i + 1}. {x.q}</p>
                  <div className="mt-1 text-sm font-medium whitespace-pre-wrap">{x.a}</div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Internal notes" description="Visible to authorised staff only — never shown to customers.">
            <ul className="mb-4 space-y-3">
              {(notes ?? []).length === 0 && <li className="text-sm text-muted-foreground">No notes yet.</li>}
              {(notes ?? []).map((n) => {
                const author = n.profiles as unknown as { full_name: string; email: string } | null;
                return (
                  <li key={n.id} className="rounded-lg bg-muted/60 p-3">
                    <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{author?.full_name || author?.email || "Unknown"} · {formatDateTime(n.created_at)}</p>
                  </li>
                );
              })}
            </ul>
            <NoteForm responseId={r.id} />
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Customer & interaction">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Customer</dt>
              <dd>{c ? <Link className="hover:underline" href={`/admin/customers/${c.id}`}>{c.full_name}</Link> : "—"}</dd>
              <dt className="text-muted-foreground">Mobile</dt>
              <dd className="tabular">{showContact ? formatMobile(c?.mobile) : maskMobile(c?.mobile)}</dd>
              {showContact && c?.email && (<><dt className="text-muted-foreground">Email</dt><dd>{c.email}</dd></>)}
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{(r.branches as unknown as { name: string } | null)?.name ?? "—"}</dd>
              <dt className="text-muted-foreground">Employee</dt>
              <dd>{(r.employees as unknown as { full_name: string } | null)?.full_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Visit date</dt>
              <dd>{formatDate(ix?.interaction_date)}</dd>
              <dt className="text-muted-foreground">Product</dt>
              <dd>{[ix?.product_category, ix?.product_model].filter(Boolean).join(" · ") || "—"}</dd>
              {ix?.invoice_number && (<><dt className="text-muted-foreground">Invoice</dt><dd className="tabular">{ix.invoice_number}</dd></>)}
            </dl>
          </Panel>
          {canManage && (
            <Panel title="Follow-up">
              <FollowUpForm
                responseId={r.id}
                initial={{ resolution_status: r.resolution_status as ResolutionStatus, assigned_to: r.assigned_to, follow_up_due: r.follow_up_due }}
                assignees={(assignees ?? []).map((a) => ({ id: a.id, label: `${a.full_name || a.email} · ${ROLE_LABELS[a.role as keyof typeof ROLE_LABELS]}` }))}
              />
            </Panel>
          )}
          <Panel title="Action history">
            <ol className="relative space-y-4 border-l border-border pl-4">
              {(actions ?? []).map((a) => {
                const act = a as unknown as { id: string; action_type: string; from_status: ResolutionStatus | null; to_status: ResolutionStatus | null; due_date: string | null; details: string | null; created_at: string; actor: { full_name: string } | null; assignee: { full_name: string } | null };
                return (
                  <li key={act.id} className="relative">
                    <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-white bg-brand" aria-hidden />
                    <p className="text-sm">{describe(act)}</p>
                    <p className="text-xs text-muted-foreground">{act.actor?.full_name ?? "System"} · {formatDateTime(act.created_at)}</p>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
