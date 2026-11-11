import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ORG_WIDE, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { smsProviderStatus } from "@/lib/messaging";
import { campaignCounts } from "@/server/services/offers";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { CampaignStatusBadge } from "../status-badge";
import { CampaignSender } from "./campaign-sender";

export const metadata: Metadata = { title: "Offer" };
// Each "send next batch" request may take several seconds (one SMS request per customer).
export const maxDuration = 60;

export default async function OfferPage({ params }: PageProps<"/admin/offers/[id]">) {
  await requirePageRole(ORG_WIDE);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("offer_campaigns")
    .select("id, name, body, status, pause_reason, recipient_count, audience, created_at, started_at, completed_at, profiles:created_by(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();
  const campaign = c as unknown as {
    id: string; name: string; body: string; status: string; pause_reason: string | null; recipient_count: number;
    audience: { description?: string }; created_at: string; started_at: string | null; completed_at: string | null; profiles: { full_name: string } | null;
  };
  const [counts, { data: failures }] = await Promise.all([
    campaignCounts(supabase, id),
    supabase.from("offer_recipients").select("id, error, customers(full_name)").eq("campaign_id", id).eq("status", "failed").limit(20),
  ]);
  let isTest = true;
  try {
    isTest = smsProviderStatus().isTest;
  } catch {
    isTest = true;
  }

  return (
    <>
      <Link href="/admin/offers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Offers
      </Link>
      <PageHeader
        title={campaign.name}
        description={`Created ${formatDateTime(campaign.created_at)}${campaign.profiles ? ` by ${campaign.profiles.full_name}` : ""}${campaign.completed_at ? ` · finished ${formatDateTime(campaign.completed_at)}` : ""}`}
        actions={<CampaignStatusBadge status={campaign.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <CampaignSender
          campaignId={campaign.id}
          status={campaign.status}
          pauseReason={campaign.pause_reason}
          total={campaign.recipient_count}
          initialCounts={counts}
          isTest={isTest}
        />
        <div className="space-y-4">
          <Panel title="Message">
            <p className="text-sm whitespace-pre-wrap">{campaign.body}</p>
            <p className="mt-2 text-xs text-muted-foreground">Each customer gets their own name, last model and a personal “Stop offers” link.</p>
          </Panel>
          <Panel title="Who gets it">
            <p className="text-sm text-muted-foreground">{campaign.audience?.description ?? "—"}</p>
            <p className="mt-1 text-sm">{campaign.recipient_count.toLocaleString()} customers (fixed when the offer was saved).</p>
          </Panel>
          {(failures ?? []).length > 0 && (
            <Panel title="Failed" description="Not charged unless Dialog accepted the message." bodyClassName="px-0 pb-0">
              <ul className="divide-y divide-border text-sm">
                {(failures as unknown as { id: string; error: string | null; customers: { full_name: string } | null }[]).map((f) => (
                  <li key={f.id} className="px-5 py-2"><span className="font-medium">{f.customers?.full_name ?? "Customer"}</span> <span className="text-destructive">{f.error}</span></li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
