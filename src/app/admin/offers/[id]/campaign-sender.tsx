"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pause, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/admin/panel";
import { cancelCampaignAction, pauseCampaignAction, sendCampaignBatchAction } from "../actions";

type Counts = Record<"pending" | "sending" | "sent" | "failed" | "skipped" | "delivered" | "stopped", number>;

/** Dialog eSMS does not send between 8 PM and 8 AM (Sri Lanka time). */
function inBlackout() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h >= 20 || h < 8;
}

export function CampaignSender({
  campaignId,
  status,
  pauseReason,
  total,
  initialCounts,
  isTest,
}: {
  campaignId: string;
  status: string;
  pauseReason: string | null;
  total: number;
  initialCounts: Counts;
  isTest: boolean;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(pauseReason);
  const stop = useRef(false);

  const processed = counts.sent + counts.failed + counts.skipped;
  const pct = total ? Math.round((processed / total) * 100) : 0;
  const finished = status === "completed" || status === "cancelled";
  const canSend = !finished && counts.pending > 0;

  async function run() {
    if (!isTest && inBlackout() && !confirm("It is between 8 PM and 8 AM. Dialog does not send offers now, so the offer will pause straight away. Try anyway?")) return;
    if (status === "draft" && !confirm(`Send this offer to ${total.toLocaleString()} customer${total === 1 ? "" : "s"} now?${isTest ? "\n\nTest mode: no real SMS will be sent." : ""}`)) return;
    stop.current = false;
    setRunning(true);
    setMessage(null);
    try {
      for (;;) {
        const res = await sendCampaignBatchAction(campaignId);
        if (!res.ok) {
          toast.error(res.error);
          break;
        }
        setCounts(res.counts);
        if (res.paused) {
          setMessage(res.paused);
          toast.warning("Sending paused");
          break;
        }
        if (res.done) {
          toast.success("Offer sent to everyone");
          break;
        }
        if (stop.current) {
          await pauseCampaignAction(campaignId);
          setMessage("Paused by a user");
          break;
        }
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  async function cancel() {
    if (!confirm("Cancel this offer? Customers not yet sent will not get it. This cannot be undone.")) return;
    stop.current = true;
    const res = await cancelCampaignAction(campaignId);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Offer cancelled");
    router.refresh();
  }

  const stat = (label: string, value: number, cls = "") => (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular ${cls}`}>{value.toLocaleString()}</p>
    </div>
  );

  return (
    <Panel title="Sending" description={isTest ? "Test mode – messages are logged, not sent." : "Real SMS via Dialog eSMS. Each customer is sent this offer at most once."}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span>{processed.toLocaleString()} of {total.toLocaleString()} processed</span>
            <span className="tabular text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stat("Waiting", counts.pending + counts.sending)}
          {stat("Sent", counts.sent, "text-blue-800")}
          {stat("Delivered*", counts.delivered, "text-[#087a08]")}
          {stat("Failed", counts.failed, counts.failed ? "text-[#a52727]" : "")}
          {stat("Skipped", counts.skipped)}
          {stat("Stopped offers", counts.stopped)}
        </div>
        <p className="text-xs text-muted-foreground">*Delivered only when Dialog sends a delivery report. “Skipped” = opted out after the offer was saved. “Stopped offers” = tapped the stop link.</p>
        {message && (
          <p className="flex gap-2 rounded-lg bg-passive-soft p-3 text-sm text-[#8a5f00]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button variant="outline" onClick={() => (stop.current = true)}>
              <Pause data-icon="inline-start" /> Pause after this batch
            </Button>
          ) : (
            canSend && (
              <Button onClick={run}>
                <Play data-icon="inline-start" /> {status === "draft" ? `Start sending to ${total.toLocaleString()}` : "Resume sending"}
              </Button>
            )
          )}
          {running && <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Sending… keep this page open</span>}
          {!finished && !running && (
            <Button variant="ghost" onClick={cancel}>
              <XCircle data-icon="inline-start" /> Cancel offer
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
