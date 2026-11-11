import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_BRAND } from "@/lib/survey/definitions";

export interface PublicBrand {
  name: string;
  logoUrl: string | null;
}

/**
 * Public, non-sensitive branding for customer-facing pages.
 * A showroom with its own brand (e.g. iSeven Mobiles) shows that name as a
 * text wordmark; the company logo is only used for the company brand.
 */
export async function getPublicBranding(showroomBrand?: string | null): Promise<PublicBrand> {
  if (showroomBrand?.trim()) return { name: showroomBrand.trim(), logoUrl: null };
  try {
    const { data } = await createAdminClient()
      .from("system_settings")
      .select("key, value")
      .in("key", ["company_display_name", "company_logo_url"]);
    const get = (k: string) => data?.find((d) => d.key === k)?.value as string | null | undefined;
    return { name: get("company_display_name") || DEFAULT_BRAND, logoUrl: get("company_logo_url") || null };
  } catch {
    return { name: DEFAULT_BRAND, logoUrl: null };
  }
}

/** Branch code → that showroom's public brand name (null if none / unknown). Codes are not secret. */
export async function getShowroomBrand(code: string | null | undefined): Promise<{ code: string; brandName: string | null } | null> {
  const c = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(c)) return null;
  try {
    const { data } = await createAdminClient().from("branches").select("code, brand_name").eq("code", c).maybeSingle();
    return data ? { code: data.code as string, brandName: (data.brand_name as string | null) ?? null } : null;
  } catch {
    return null;
  }
}
