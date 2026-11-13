import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { smsProviderStatusWithLogin } from "@/lib/messaging";
import { formatDateTime } from "@/lib/format";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SCORECARD_ROLES } from "@/lib/types";
import { BranchDialog, EmployeeDialog, GeneralSettingsForm, AllowSmsLoginButton } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { key: "general", label: "General" },
  { key: "branches", label: "Branches" },
  { key: "employees", label: "Employees" },
  { key: "integrations", label: "SMS integration" },
  { key: "audit", label: "Audit log" },
] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  await requirePageRole(["super_admin"]);
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "general";
  const supabase = await createClient();
  const [settings, lookups] = await Promise.all([getSettings(supabase), getLookups(supabase, { includeInactive: true })]);
  const branchName = new Map(lookups.branches.map((b) => [b.id, b.name]));

  let sms: Awaited<ReturnType<typeof smsProviderStatusWithLogin>> | null = null;
  let envError: string | null = null;
  try {
    sms = tab === "integrations" ? await smsProviderStatusWithLogin() : null;
  } catch (e) {
    envError = e instanceof Error ? e.message : "Environment not configured";
  }
  const audit = tab === "audit" ? (await supabase.from("audit_logs").select("id, action, entity_type, entity_id, details, created_at, profiles:actor_id(full_name, email)").order("created_at", { ascending: false }).limit(200)).data ?? [] : [];

  return (
    <>
      <PageHeader title="Settings" description="Company information, branches, employees, survey rules, integrations and audit history." />
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-border" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/settings?tab=${t.key}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "general" && <Panel><GeneralSettingsForm initial={settings} /></Panel>}

      {tab === "branches" && (
        <Panel title="Branches" actions={<BranchDialog />} bodyClassName="px-0 pb-0">
          <Table>
            <TableHeader><TableRow className="bg-muted/50"><TableHead className="pl-5">Name</TableHead><TableHead>Code</TableHead><TableHead>Brand shown</TableHead><TableHead>SMS mask</TableHead><TableHead>Status</TableHead><TableHead className="pr-5" /></TableRow></TableHeader>
            <TableBody>
              {lookups.branches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-5 font-medium">{b.name}</TableCell>
                  <TableCell className="tabular">{b.code}</TableCell>
                  <TableCell>
                    {b.brand_name ?? <span className="text-muted-foreground">{settings.company_display_name}</span>}
                    <a href={`/survey/preview/purchased?branch=${encodeURIComponent(b.code)}`} target="_blank" rel="noopener noreferrer" className="block text-xs text-series-1 hover:underline">Preview survey</a>
                  </TableCell>
                  <TableCell>{b.sms_sender_id ? <span className="font-mono text-xs">{b.sms_sender_id}</span> : <span className="text-muted-foreground">Default mask</span>}</TableCell>
                  <TableCell>{b.is_active ? "Active" : <span className="text-muted-foreground">Inactive</span>}</TableCell>
                  <TableCell className="pr-5 text-right"><BranchDialog branch={b} /></TableCell>
                </TableRow>
              ))}
              {lookups.branches.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No branches yet — add your first branch.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Panel>
      )}

      {tab === "employees" && (
        <Panel title="Employees / salespeople" actions={<EmployeeDialog branches={lookups.branches.filter((b) => b.is_active)} />} bodyClassName="px-0 pb-0">
          <Table>
            <TableHeader><TableRow className="bg-muted/50"><TableHead className="pl-5">Name</TableHead><TableHead>Code</TableHead><TableHead>Branch</TableHead><TableHead>Title</TableHead><TableHead>Scorecard</TableHead><TableHead>Status</TableHead><TableHead className="pr-5" /></TableRow></TableHeader>
            <TableBody>
              {lookups.employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-5 font-medium">{e.full_name}</TableCell>
                  <TableCell className="tabular">{e.employee_code ?? "—"}</TableCell>
                  <TableCell>{branchName.get(e.branch_id) ?? "—"}</TableCell>
                  <TableCell>{e.job_title ?? "—"}</TableCell>
                  <TableCell className={e.scorecard_role === "rep" ? "" : "text-muted-foreground"}>{SCORECARD_ROLES.find((r) => r.value === e.scorecard_role)?.label ?? "Sales rep"}</TableCell>
                  <TableCell>{e.is_active ? "Active" : <span className="text-muted-foreground">Inactive</span>}</TableCell>
                  <TableCell className="pr-5 text-right"><EmployeeDialog employee={e} branches={lookups.branches} /></TableCell>
                </TableRow>
              ))}
              {lookups.employees.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No employees yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Panel>
      )}

      {tab === "integrations" && (
        <Panel title="SMS provider – Dialog eSMS" description="Credentials are server-side environment variables and are never shown or editable here.">
          {envError ? (
            <p className="text-sm text-destructive">{envError}</p>
          ) : sms ? (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <dt className="text-muted-foreground">Active provider</dt>
                <dd className="font-medium">{sms.isTest ? "Test mode (messages are logged, not sent)" : sms.label}</dd>
                <dt className="text-muted-foreground">Ready to send</dt>
                <dd className="flex items-center gap-1.5">{sms.ready ? <><CheckCircle2 className="size-4 text-promoter" /> Yes</> : <><XCircle className="size-4 text-destructive" /> No</>}</dd>
                <dt className="text-muted-foreground">Delivery reports</dt>
                <dd>{sms.supportsDeliveryReports ? "Supported – webhook /api/webhooks/sms" : "Off – set SMS_WEBHOOK_SECRET to receive Delivered / Failed updates"}</dd>
              </dl>
              {sms.problems.length > 0 && (
                <ul className="list-disc space-y-1 rounded-lg bg-destructive/5 p-3 pl-8 text-destructive">{sms.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
              {sms.loginBlocked && <AllowSmsLoginButton />}
              <div className="rounded-lg bg-muted/60 p-3 text-muted-foreground">
                <p className="font-medium text-foreground">To send real SMS with Dialog eSMS</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>In Vercel set <code>DIALOG_ESMS_USERNAME</code>, <code>DIALOG_ESMS_PASSWORD</code> and <code>DIALOG_ESMS_SOURCE_ADDRESS</code> (your approved mask, e.g. iDealzLanka).</li>
                  <li>Set <code>DIALOG_ESMS_PAYMENT_METHOD</code> to <code>0</code> (wallet) or <code>4</code> (API package), and <code>SMS_WEBHOOK_SECRET</code> for delivery reports.</li>
                  <li>Set <code>SMS_PROVIDER=dialog_esms</code> and redeploy. eSMS does not send between 8 PM and 8 AM.</li>
                </ol>
              </div>
            </div>
          ) : null}
        </Panel>
      )}

      {tab === "audit" && (
        <Panel title="Audit log" description="Latest 200 administrative actions" bodyClassName="px-0 pb-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/50"><TableHead className="pl-5">Time</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead className="pr-5">Details</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.map((a) => {
                  const actor = a.profiles as unknown as { full_name: string; email: string } | null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="pl-5 tabular text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                      <TableCell>{actor?.full_name || actor?.email || "System"}</TableCell>
                      <TableCell className="font-medium">{a.action}</TableCell>
                      <TableCell className="text-muted-foreground">{a.entity_type}</TableCell>
                      <TableCell className="max-w-md truncate pr-5 font-mono text-xs text-muted-foreground">{JSON.stringify(a.details)}</TableCell>
                    </TableRow>
                  );
                })}
                {audit.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No audit entries yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </>
  );
}
