import type { Metadata } from "next";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/types";
import { navFor } from "@/components/admin/nav-config";
import { MobileNav, Sidebar } from "@/components/admin/sidebar";
import { UserMenu } from "@/components/admin/user-menu";
import { smsProviderStatus } from "@/lib/messaging";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · iDealz Lanka CX" } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requirePageRole();
  const supabase = await createClient();
  const [settings, branch] = await Promise.all([
    getSettings(supabase),
    profile.branch_id ? supabase.from("branches").select("name").eq("id", profile.branch_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const sections = navFor(profile.role);
  let sms: ReturnType<typeof smsProviderStatus> | null = null;
  try {
    sms = smsProviderStatus();
  } catch {
    sms = null;
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar sections={sections} brandName={settings.company_display_name} logoUrl={null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-bar sticky top-0 z-30 flex h-14 items-center gap-3 px-4 sm:px-6">
          <MobileNav sections={sections} brandName={settings.company_display_name} logoUrl={null} />
          {sms?.isTest && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800" title="SMS_PROVIDER=mock – messages are logged but not sent">
              SMS test mode
            </span>
          )}
          <div className="ml-auto">
            <UserMenu name={profile.full_name} email={profile.email} role={ROLE_LABELS[profile.role]} branch={(branch.data as { name: string } | null)?.name ?? null} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
