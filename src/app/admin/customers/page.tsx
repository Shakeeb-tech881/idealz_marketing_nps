import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload, Users } from "lucide-react";
import { canSeeContactDetails, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import { PURCHASE_STATUS_LABELS } from "@/lib/types";
import { getLookups } from "@/server/services/lookups";
import { latestInvitation, listInteractions } from "@/server/services/customer-queries";
import { PageHeader } from "@/components/admin/page-header";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Pagination } from "@/components/admin/pagination";
import { InvitationStatusBadge } from "@/components/admin/badges";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerFilters } from "./customer-filters";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const isUuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const profile = await requirePageRole();
  const sp = await searchParams;
  const supabase = await createClient();
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const params = {
    q: one(sp.q)?.slice(0, 80),
    branch: isUuid(one(sp.branch)),
    employee: isUuid(one(sp.employee)),
    status: (["purchased", "not_purchased"].includes(one(sp.status) ?? "") ? one(sp.status) : null) as "purchased" | "not_purchased" | null,
    survey: (["not_invited", "invited", "completed"].includes(one(sp.survey) ?? "") ? one(sp.survey) : null) as "not_invited" | "invited" | "completed" | null,
    from: isDate(one(sp.from)),
    to: isDate(one(sp.to)),
    page,
    pageSize: PAGE_SIZE,
  };
  const [lookups, { rows, total }] = await Promise.all([getLookups(supabase, { profile }), listInteractions(supabase, params)]);
  const showMobile = canSeeContactDetails(profile);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every purchase and visit is recorded separately, so returning customers can be surveyed for each interaction."
        actions={
          <>
            <Link href="/admin/customers/import" className={buttonVariants({ variant: "outline" })}>
              <Upload data-icon="inline-start" /> Import CSV / Excel
            </Link>
            <Link href="/admin/customers/new" className={buttonVariants()}>
              <Plus data-icon="inline-start" /> Add customer
            </Link>
          </>
        }
      />
      <CustomerFilters branches={lookups.branches} employees={lookups.employees} />
      <Panel bodyClassName="px-0 pb-0" className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={Object.values(params).some((v) => v && v !== page && v !== PAGE_SIZE) ? "No customers match these filters" : "No customers yet"}
            description="Add customers manually or import them from your POS / CRM export."
            action={<Link href="/admin/customers/new" className={buttonVariants()}>Add customer</Link>}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Customer</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="pr-5">Survey</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const inv = latestInvitation(r.survey_invitations);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="pl-5 font-medium">
                          {r.customers ? (
                            <Link href={`/admin/customers/${r.customers.id}`} className="hover:underline">
                              {r.customers.full_name}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {r.customers?.sms_opt_out && <span className="ml-2 text-[10px] font-semibold text-muted-foreground uppercase">Opted out</span>}
                        </TableCell>
                        <TableCell className="tabular text-muted-foreground">{showMobile ? formatMobile(r.customers?.mobile) : maskMobile(r.customers?.mobile)}</TableCell>
                        <TableCell>{r.branches?.name ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{r.employees?.full_name ?? "—"}</TableCell>
                        <TableCell>
                          <span className={r.purchase_status === "purchased" ? "text-series-1 font-medium" : "text-[#c4521f] font-medium"}>{PURCHASE_STATUS_LABELS[r.purchase_status]}</span>
                        </TableCell>
                        <TableCell className="tabular text-muted-foreground">{formatDate(r.interaction_date)}</TableCell>
                        <TableCell className="max-w-48 truncate text-muted-foreground">{[r.product_category, r.product_model].filter(Boolean).join(" · ") || "—"}</TableCell>
                        <TableCell className="tabular text-muted-foreground">{r.invoice_number ?? "—"}</TableCell>
                        <TableCell className="pr-5">{inv ? <InvitationStatusBadge status={inv.status} /> : <span className="text-xs text-muted-foreground">Not invited</span>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} baseHref="/admin/customers" params={Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]))} />
          </>
        )}
      </Panel>
    </>
  );
}
