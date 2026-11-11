import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { ORG_WIDE, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CampaignStatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Offers" };

export default async function OffersPage() {
  await requirePageRole(ORG_WIDE);
  const supabase = await createClient();
  const { data } = await supabase
    .from("offer_campaigns")
    .select("id, name, status, recipient_count, created_at, started_at, completed_at, audience, profiles:created_by(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as {
    id: string; name: string; status: string; recipient_count: number; created_at: string; started_at: string | null; completed_at: string | null;
    audience: { description?: string }; profiles: { full_name: string } | null;
  }[];

  return (
    <>
      <PageHeader
        title="Offers"
        description="Bulk SMS about new models and upgrade offers to past customers. Customers who stopped offers or SMS are always left out, and every SMS has a one-tap “Stop offers” link."
        actions={<Link href="/admin/insights" className={buttonVariants()}><Plus data-icon="inline-start" /> New offer</Link>}
      />
      <Panel bodyClassName="px-0 pb-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No offers yet"
            description="Open Customer Insights, filter the customers (e.g. bought “iPhone 15”, last purchase over 12 months ago), then click “Send offer to these customers”."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="pl-5">Offer</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead className="text-right">Customers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5"><Link href={`/admin/offers/${r.id}`} className="font-medium hover:underline">{r.name}</Link></TableCell>
                    <TableCell className="max-w-80 text-sm text-muted-foreground">{r.audience?.description ?? "—"}</TableCell>
                    <TableCell className="text-right tabular">{r.recipient_count.toLocaleString()}</TableCell>
                    <TableCell><CampaignStatusBadge status={r.status} /></TableCell>
                    <TableCell className="pr-5 text-sm text-muted-foreground">{formatDateTime(r.created_at)}{r.profiles ? ` · ${r.profiles.full_name}` : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  );
}
