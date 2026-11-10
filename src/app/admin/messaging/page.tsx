import type { Metadata } from "next";
import Link from "next/link";
import { Eye, History, FileText } from "lucide-react";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatNumber, isoHoursAgo, isoMonthStart } from "@/lib/format";
import { smsProviderStatusWithLogin } from "@/lib/messaging";
import { getSettings } from "@/lib/settings";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { buttonVariants } from "@/components/ui/button";
import { SendWizard, type Candidate } from "./send-wizard";

export const metadata: Metadata = { title: "Survey messaging" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MessagingPage({ searchParams }: PageProps<"/admin/messaging">) {
  const profile = await requirePageRole();
  const sp = await searchParams;
  const supabase = await createClient();
  const type = one(sp.type) === "non_purchased" ? "non_purchased" : "purchased";
  const branch = one(sp.branch);
  const from = one(sp.from);
  const to = one(sp.to);

  let q = supabase
    .from("customer_interactions")
    .select("id, interaction_date, product_model, branch_id, customers!inner(full_name, mobile, sms_opt_out), branches(name), employees(full_name), survey_invitations(id)")
    .eq("purchase_status", type === "purchased" ? "purchased" : "not_purchased")
    .eq("customers.sms_opt_out", false)
    .not("customers.mobile", "is", null)
    .is("survey_invitations", null)
    .order("interaction_date", { ascending: false })
    .limit(200);
  if (branch && /^[0-9a-f-]{36}$/i.test(branch)) q = q.eq("branch_id", branch);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.gte("interaction_date", from);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.lte("interaction_date", to);

  const monthStart = isoMonthStart();
  const dayAgo = isoHoursAgo(24);

  const [candidatesRes, templatesRes, lookups, settings, sentDay, sentMonth, failedMonth] = await Promise.all([
    q,
    supabase.from("message_templates").select("id, name, body, survey_type, is_default").eq("is_active", true).order("is_default", { ascending: false }),
    getLookups(supabase, { profile }),
    getSettings(supabase),
    supabase.from("message_logs").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", dayAgo),
    supabase.from("message_logs").select("id", { count: "exact", head: true }).in("status", ["sent", "delivered"]).gte("created_at", monthStart),
    supabase.from("message_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", monthStart),
  ]);

  const candidates: Candidate[] = ((candidatesRes.data ?? []) as unknown as {
    id: string; interaction_date: string; product_model: string | null;
    customers: { full_name: string; mobile: string }; branches: { name: string } | null; employees: { full_name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    name: r.customers.full_name,
    mobile: r.customers.mobile,
    branch: r.branches?.name ?? "—",
    employee: r.employees?.full_name ?? null,
    date: r.interaction_date,
    product: r.product_model,
  }));

  let provider: Awaited<ReturnType<typeof smsProviderStatusWithLogin>> | null = null;
  try {
    provider = await smsProviderStatusWithLogin();
  } catch {
    provider = null;
  }

  return (
    <>
      <PageHeader
        title="Survey messaging"
        description="Send each customer a unique, secure survey link by SMS. Customers who already have an active invitation are excluded automatically."
        actions={
          <>
            <Link href="/admin/messaging/history" className={buttonVariants({ variant: "outline" })}><History data-icon="inline-start" /> Sending history</Link>
            <Link href="/admin/messaging/templates" className={buttonVariants({ variant: "outline" })}><FileText data-icon="inline-start" /> Templates</Link>
            <Link href={`/survey/preview/${type}`} target="_blank" className={buttonVariants({ variant: "outline" })}><Eye data-icon="inline-start" /> Preview survey</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Sent (last 24h)" value={formatNumber(sentDay.count ?? 0)} sub={`Daily limit ${formatNumber(settings.sms_daily_limit)}`} />
        <KpiCard label="Sent this month" value={formatNumber(sentMonth.count ?? 0)} />
        <KpiCard label="Failed this month" accent="detractor" value={formatNumber(failedMonth.count ?? 0)} sub={<Link className="hover:underline" href="/admin/messaging/history?status=failed">Review & retry</Link>} />
        <KpiCard
          label="SMS provider"
          value={provider ? (provider.isTest ? "Test mode" : provider.label) : "Not configured"}
          sub={provider?.isTest ? "Messages are logged, not sent" : provider?.loginBlocked ? "Login blocked – see below" : provider && !provider.ready ? "Configuration incomplete" : "Live"}
        />
      </div>
      {provider && !provider.ready && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium">The SMS provider is not ready — sends will fail until this is fixed:</p>
          <ul className="mt-1 list-disc pl-5">{provider.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <SendWizard
        surveyType={type}
        candidates={candidates}
        templates={(templatesRes.data ?? []).filter((t) => t.survey_type === type)}
        branches={lookups.branches}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
        isTest={provider?.isTest ?? true}
      />
    </>
  );
}
