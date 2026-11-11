import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settingFromStorage } from "@/lib/settings-values";

export interface AppSettings {
  company_name: string;
  company_display_name: string;
  company_logo_url: string | null;
  support_phone: string | null;
  survey_expiry_days: number;
  min_employee_sample: number;
  min_branch_sample: number;
  data_retention_months: number;
  timezone: string;
  sms_daily_limit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  company_name: "iDealz Lanka (Pvt) Ltd",
  company_display_name: "iDealz Lanka",
  company_logo_url: null,
  support_phone: null,
  survey_expiry_days: 14,
  min_employee_sample: 10,
  min_branch_sample: 20,
  data_retention_months: 36,
  timezone: "Asia/Colombo",
  sms_daily_limit: 2000,
};

async function load(client: SupabaseClient): Promise<AppSettings> {
  const { data } = await client.from("system_settings").select("key, value");
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    const value = settingFromStorage(row.value);
    // Optional settings (logo, support phone) may be empty; required ones keep their default.
    if (value !== null || DEFAULT_SETTINGS[row.key as keyof AppSettings] === null) out[row.key] = value;
  }
  return out as unknown as AppSettings;
}

export const getSettings = cache(load);
