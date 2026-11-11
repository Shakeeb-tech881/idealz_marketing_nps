import { cn } from "@/lib/utils";

const STYLE: Record<string, [string, string]> = {
  draft: ["Ready to send", "bg-muted text-muted-foreground"],
  sending: ["Sending", "bg-blue-50 text-blue-800"],
  paused: ["Paused", "bg-passive-soft text-[#8a5f00]"],
  completed: ["Completed", "bg-promoter-soft text-[#087a08]"],
  cancelled: ["Cancelled", "bg-slate-100 text-slate-500"],
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const [label, cls] = STYLE[status] ?? [status, "bg-muted"];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", cls)}>{label}</span>;
}
