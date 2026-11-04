import { cn } from "@/lib/utils";
import { INVITATION_STATUS_LABELS, RESOLUTION_LABELS, type InvitationStatus, type ResolutionStatus } from "@/lib/types";

const pill = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

export function NpsCategoryBadge({ category, score }: { category: string; score?: number }) {
  const cls =
    category === "promoter" ? "bg-promoter-soft text-[#087a08]" : category === "passive" ? "bg-passive-soft text-[#8a5f00]" : "bg-detractor-soft text-[#a52727]";
  const dot = category === "promoter" ? "bg-promoter" : category === "passive" ? "bg-passive" : "bg-detractor";
  return (
    <span className={cn(pill, cls)}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {score !== undefined && <span className="tabular font-semibold">{score}</span>}
      {category.charAt(0).toUpperCase() + category.slice(1)}
    </span>
  );
}

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const cls: Record<InvitationStatus, string> = {
    created: "bg-muted text-muted-foreground",
    pending: "bg-muted text-muted-foreground",
    sent: "bg-blue-50 text-blue-700",
    delivered: "bg-blue-50 text-blue-800",
    opened: "bg-indigo-50 text-indigo-700",
    completed: "bg-promoter-soft text-[#087a08]",
    failed: "bg-detractor-soft text-[#a52727]",
    expired: "bg-slate-100 text-slate-500",
  };
  return <span className={cn(pill, cls[status])}>{INVITATION_STATUS_LABELS[status]}</span>;
}

export function ResolutionBadge({ status }: { status: ResolutionStatus }) {
  const cls: Record<ResolutionStatus, string> = {
    new: "bg-blue-50 text-blue-700",
    under_review: "bg-indigo-50 text-indigo-700",
    contact_required: "bg-passive-soft text-[#8a5f00]",
    resolved: "bg-promoter-soft text-[#087a08]",
    closed: "bg-slate-100 text-slate-600",
  };
  return <span className={cn(pill, cls[status])}>{RESOLUTION_LABELS[status]}</span>;
}

export function TestBadge() {
  return <span className={cn(pill, "bg-amber-100 text-amber-800 uppercase tracking-wide text-[10px]")}>Test</span>;
}

export function SampleBadge({ n, min }: { n: number; min: number }) {
  if (n >= min) return <span className="text-xs text-muted-foreground tabular">n = {n}</span>;
  return (
    <span className={cn(pill, "bg-slate-100 text-slate-600")} title={`Fewer than ${min} responses — not reliable for comparison`}>
      n = {n} · low sample
    </span>
  );
}
