import type { Metadata } from "next";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLookups } from "@/server/services/lookups";
import { colomboDateDaysAgo, todayColombo } from "@/lib/format";
import { REPORT_TYPES } from "@/server/reports/definitions";
import { PageHeader } from "@/components/admin/page-header";
import { ReportBuilder } from "./report-builder";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const profile = await requirePageRole(MANAGERS);
  const supabase = await createClient();
  const lookups = await getLookups(supabase, { profile });
  return (
    <>
      <PageHeader title="Reports & exports" description="Download live database results as Excel, CSV or PDF. Exports respect your access level and are recorded in the audit log." />
      <ReportBuilder reports={REPORT_TYPES.filter((r) => r.value !== "branch_scorecard" || profile.role === "super_admin" || profile.role === "management").map((r) => ({ ...r }))} branches={lookups.branches} employees={lookups.employees} defaultFrom={colomboDateDaysAgo(29)} defaultTo={todayColombo()} />
    </>
  );
}
