import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isOrgWide, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/admin/page-header";
import { TemplateManager } from "./template-manager";

export const metadata: Metadata = { title: "SMS templates" };

export default async function TemplatesPage() {
  const profile = await requirePageRole();
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("id, survey_type, name, body, is_default, is_active, updated_at").order("survey_type").order("is_default", { ascending: false }).order("name");
  return (
    <>
      <Link href="/admin/messaging" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Survey messaging
      </Link>
      <PageHeader title="SMS templates" description="Use {{customer_name}} (first name) and {{survey_link}} (required). Purchased and non-purchased templates are kept separate." />
      <TemplateManager templates={data ?? []} canEdit={isOrgWide(profile)} />
    </>
  );
}
