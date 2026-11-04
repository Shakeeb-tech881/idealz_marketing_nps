import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Public, non-sensitive branding values for customer-facing pages. */
export async function getPublicBranding(): Promise<{ name: string; logoUrl: string | null }> {
  try {
    const { data } = await createAdminClient()
      .from("system_settings")
      .select("key, value")
      .in("key", ["company_display_name", "company_logo_url"]);
    const get = (k: string) => data?.find((d) => d.key === k)?.value as string | null | undefined;
    return { name: get("company_display_name") || "iDealz Lanka", logoUrl: get("company_logo_url") ?? null };
  } catch {
    return { name: "iDealz Lanka", logoUrl: null };
  }
}
