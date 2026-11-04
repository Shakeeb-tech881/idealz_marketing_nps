import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePageRole } from "@/lib/auth";
import { PageHeader } from "@/components/admin/page-header";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import customers" };

export default async function ImportPage() {
  await requirePageRole();
  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader title="Import customers" description="Upload a CSV or Excel export, map the columns, review validation results, then import. Invalid rows are never imported silently." />
      <ImportWizard />
    </>
  );
}
