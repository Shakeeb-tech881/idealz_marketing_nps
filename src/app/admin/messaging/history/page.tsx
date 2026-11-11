import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { canSeeContactDetails, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import type { InvitationStatus, MessageStatus } from "@/lib/types";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination } from "@/components/admin/pagination";
import { InvitationStatusBadge, TestBadge } from "@/components/admin/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ResendButton } from "../../customers/[id]/customer-actions";

export const metadata: Metadata = { title: "Sending history" };

const PAGE_SIZE = 30;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATUS: MessageStatus[] = ["queued", "sent", "delivered", "failed"];
const LABEL: Record<MessageStatus, string> = { queued: "Queued", sent: "Accepted by provider", delivered: "Delivered", failed: "Failed" };

interface Row {
  id: string;
  created_at: string;
  provider: string;
  is_test: boolean;
  recipient: string;
  body_redacted: string;
  status: MessageStatus;
  provider_status: string | null;
  sender_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt: number;
  customers: { full_name: string } | null;
  branches: { name: string } | null;
  survey_invitations: { id: string; status: InvitationStatus; survey_type: string } | null;
  offer_campaigns: { name: string } | null;
}

export default async function HistoryPage({ searchParams }: PageProps<"/admin/messaging/history">) {
  const profile = await requirePageRole();
  const sp = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const status = STATUS.find((s) => s === one(sp.status)) ?? null;

  let q = supabase
    .from("message_logs")
    .select("id, created_at, provider, is_test, recipient, body_redacted, status, provider_status, sender_id, error_code, error_message, attempt, customers(full_name), branches(name), survey_invitations(id, status, survey_type), offer_campaigns(name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const start = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await q.range(start, start + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const showMobile = canSeeContactDetails(profile);

  return (
    <>
      <Link href="/admin/messaging" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Survey messaging
      </Link>
      <PageHeader title="Sending history" description="Every SMS attempt with the provider's response. Survey links are redacted from logs. “Delivered” is only shown when the provider reports it." />
      <div className="mb-4 flex flex-wrap gap-2">
        {[null, ...STATUS].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/admin/messaging/history?status=${s}` : "/admin/messaging/history"}
            className={cn("rounded-full border px-3 py-1 text-sm", status === s ? "border-brand bg-brand text-white" : "border-border bg-white text-muted-foreground hover:text-foreground")}
          >
            {s ? LABEL[s] : "All"}
          </Link>
        ))}
      </div>
      <Panel bodyClassName="px-0 pb-0" className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={History} title="No messages yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Time</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Message status</TableHead>
                    <TableHead>Survey</TableHead>
                    <TableHead>Provider response</TableHead>
                    <TableHead className="pr-5 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-5 tabular text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                      <TableCell className="font-medium">{r.customers?.full_name ?? "—"}</TableCell>
                      <TableCell className="tabular text-muted-foreground">{showMobile ? formatMobile(r.recipient) : maskMobile(r.recipient)}</TableCell>
                      <TableCell>
                        {r.branches?.name ?? "—"}
                        {r.sender_id && <span className="block font-mono text-[11px] text-muted-foreground">from {r.sender_id}</span>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-sm font-medium", r.status === "failed" ? "text-destructive" : r.status === "delivered" ? "text-[#087a08]" : "text-foreground")}>{LABEL[r.status]}</span>
                        {r.is_test && <span className="ml-2"><TestBadge /></span>}
                        {r.attempt > 1 && <span className="ml-2 text-xs text-muted-foreground">attempt {r.attempt}</span>}
                      </TableCell>
                      <TableCell>{r.survey_invitations ? <InvitationStatusBadge status={r.survey_invitations.status} /> : r.offer_campaigns ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Offer: {r.offer_campaigns.name}</span> : "—"}</TableCell>
                      <TableCell className="max-w-72 text-xs whitespace-normal text-muted-foreground">
                        {r.status === "failed" ? <span className="text-destructive">{r.error_code}: {r.error_message}</span> : r.provider_status ?? "—"}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {r.survey_invitations && r.survey_invitations.status === "failed" && <ResendButton invitationId={r.survey_invitations.id} failed />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} baseHref="/admin/messaging/history" params={{ status: status ?? undefined }} />
          </>
        )}
      </Panel>
    </>
  );
}
