"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare, Send, XCircle, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { TestBadge } from "@/components/admin/badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { formatMobile } from "@/lib/phone";
import { renderTemplate, smsSegments } from "@/lib/messaging/template";
import type { Branch } from "@/lib/types";
import { sendInvitationsAction } from "./actions";

export interface Candidate {
  id: string;
  name: string;
  mobile: string;
  branch: string;
  employee: string | null;
  date: string;
  product: string | null;
}

type Summary = Extract<Awaited<ReturnType<typeof sendInvitationsAction>>, { ok: true }>["data"];

export function SendWizard({ surveyType, candidates, templates, branches, appUrl, isTest }: { surveyType: "purchased" | "non_purchased"; candidates: Candidate[]; templates: { id: string; name: string; body: string; is_default: boolean }[]; branches: Branch[]; appUrl: string; isTest: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState(templates.find((t) => t.is_default)?.id ?? templates[0]?.id ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pending, start] = useTransition();
  const [navPending, startNav] = useTransition();

  const template = templates.find((t) => t.id === templateId);
  const sampleName = candidates.find((c) => selected.has(c.id))?.name ?? candidates[0]?.name ?? "Nimal";
  const preview = template ? renderTemplate(template.body, { customerName: sampleName, surveyLink: `${appUrl.replace(/\/$/, "")}/survey/AbC123…` }) : "";
  const segments = useMemo(() => smsSegments(template ? renderTemplate(template.body, { customerName: sampleName, surveyLink: `${appUrl.replace(/\/$/, "")}/survey/${"x".repeat(43)}` }) : ""), [template, sampleName, appUrl]);

  function nav(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setSelected(new Set());
    setSummary(null);
    startNav(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const allSelected = candidates.length > 0 && selected.size === candidates.length;

  function send() {
    start(async () => {
      const res = await sendInvitationsAction({ interactionIds: [...selected], surveyType, templateId: templateId || null });
      setConfirmOpen(false);
      if (!res.ok) return void toast.error(res.error);
      setSummary(res.data);
      setSelected(new Set());
      if (res.data.sent > 0) toast.success(`${res.data.sent} survey ${res.data.sent === 1 ? "message" : "messages"} ${res.data.isTest ? "logged in test mode" : "sent"}`);
      if (res.data.failed > 0) toast.error(`${res.data.failed} failed — see the summary`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Panel
        title="1. Choose customers"
        description="Showing up to 200 eligible, not-yet-invited interactions (newest first). Opted-out customers are excluded."
        bodyClassName="px-0 pb-0"
      >
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-5 pb-4">
          <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Survey type">
            {(["purchased", "non_purchased"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={surveyType === t}
                onClick={() => nav({ type: t === "purchased" ? null : t })}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium", surveyType === t ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground")}
              >
                {t === "purchased" ? "Purchased customers" : "Non-purchased customers"}
              </button>
            ))}
          </div>
          {branches.length > 1 && (
            <NativeSelect className="w-44" aria-label="Branch" value={sp.get("branch") ?? ""} onChange={(e) => nav({ branch: e.target.value || null })}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          )}
          <Input type="date" aria-label="From" className="h-9 w-38 bg-white" value={sp.get("from") ?? ""} onChange={(e) => nav({ from: e.target.value || null })} />
          <Input type="date" aria-label="To" className="h-9 w-38 bg-white" value={sp.get("to") ?? ""} onChange={(e) => nav({ to: e.target.value || null })} />
          {navPending && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
        </div>
        {candidates.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No customers waiting for a survey" description="Everyone matching these filters has already been invited, opted out, or there are no records yet." />
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-10 pl-5">
                    <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} onCheckedChange={(v) => setSelected(v ? new Set(candidates.map((c) => c.id)) : new Set())} aria-label="Select all" />
                  </TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="pr-5">Product</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>
                    <TableCell className="pl-5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(c.id)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(c.id); else n.delete(c.id); return n; })} aria-label={`Select ${c.name}`} />
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="tabular text-muted-foreground">{formatMobile(c.mobile)}</TableCell>
                    <TableCell>{c.branch}</TableCell>
                    <TableCell className="tabular text-muted-foreground">{formatDate(c.date)}</TableCell>
                    <TableCell className="max-w-44 truncate pr-5 text-muted-foreground">{c.product ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <div className="space-y-4">
        <Panel title="2. Message" description="Each customer receives their own personalised, single-use link.">
          {templates.length === 0 ? (
            <p className="text-sm text-destructive">No active template for this survey type. Create one under Templates.</p>
          ) : (
            <>
              <NativeSelect value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>)}
              </NativeSelect>
              <div className="mt-3 rounded-2xl rounded-bl-sm bg-muted p-3.5 text-sm leading-relaxed whitespace-pre-wrap">{preview}</div>
              <p className="mt-2 text-xs text-muted-foreground tabular">
                ~{segments.characters} characters · {segments.segments} SMS segment{segments.segments === 1 ? "" : "s"} ({segments.encoding}) per customer
              </p>
            </>
          )}
        </Panel>
        <Panel title="3. Send">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground tabular">{selected.size}</strong> customer{selected.size === 1 ? "" : "s"} selected · {surveyType === "purchased" ? "Purchased" : "Non-purchased"} survey
          </p>
          {isTest && <p className="mt-2 flex items-center gap-2 text-xs text-[#8a5f00]"><TestBadge /> Test mode – messages are logged but not delivered.</p>}
          <Button className="mt-4 w-full" disabled={selected.size === 0 || !template || pending} onClick={() => setConfirmOpen(true)}>
            <Send data-icon="inline-start" /> Review &amp; send
          </Button>
        </Panel>
        {summary && (
          <Panel title="Sending summary" description={summary.isTest ? "Test mode – no real SMS were sent" : undefined}>
            <div className="mb-3 flex gap-4 text-sm">
              <span className="flex items-center gap-1 text-[#087a08]"><CheckCircle2 className="size-4" /> {summary.sent} sent</span>
              <span className="flex items-center gap-1 text-destructive"><XCircle className="size-4" /> {summary.failed} failed</span>
              <span className="flex items-center gap-1 text-muted-foreground"><MinusCircle className="size-4" /> {summary.skipped} skipped</span>
            </div>
            <ul className="max-h-60 space-y-1 overflow-auto text-xs">
              {summary.outcomes.filter((o) => o.status !== "sent").map((o) => (
                <li key={o.interactionId} className="flex justify-between gap-2">
                  <span className="font-medium">{o.customerName}</span>
                  <span className={o.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{o.reason}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(o) => !pending && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {selected.size} survey SMS?</DialogTitle>
            <DialogDescription>
              {surveyType === "purchased" ? "Purchased" : "Non-purchased"} customer survey using “{template?.name}”. {isTest ? "Test mode: messages will be logged but not delivered." : "Messages will be sent via the SMS provider immediately and cannot be recalled."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap">{preview}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>Cancel</Button>
            <Button onClick={send} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />} Confirm &amp; send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
