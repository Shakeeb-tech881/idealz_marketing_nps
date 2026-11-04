import type { Metadata } from "next";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayColombo } from "@/lib/format";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { NewCustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const profile = await requirePageRole();
  const supabase = await createClient();
  const { branches, employees } = await getLookups(supabase, { profile });
  return (
    <>
      <PageHeader title="Add customer" description="Record a purchase or a visit. You can send the survey from the customer page or Survey Messaging." />
      <NewCustomerForm branches={branches} employees={employees} defaultBranch={profile.branch_id ?? (branches.length === 1 ? branches[0].id : null)} today={todayColombo()} />
    </>
  );
}
