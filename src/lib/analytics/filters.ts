import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";
import { APP_TIMEZONE } from "@/lib/format";

export interface AnalyticsFilters {
  from: string;
  to: string;
  branch: string | null;
  employee: string | null;
  surveyType: "purchased" | "non_purchased" | null;
  category: string | null;
  range: string;
}

export const RANGE_PRESETS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "365d", label: "Last 12 months", days: 365 },
  { value: "custom", label: "Custom range", days: 0 },
] as const;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.uuid();

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse filters from URL search params, falling back to safe defaults. */
export function parseFilters(sp: Record<string, string | string[] | undefined>, defaultRange = "90d"): AnalyticsFilters {
  const today = formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
  const range = first(sp.range) ?? defaultRange;
  let from: string;
  let to: string = today;
  const preset = RANGE_PRESETS.find((r) => r.value === range && r.value !== "custom");
  if (range === "custom" && iso.safeParse(first(sp.from)).success && iso.safeParse(first(sp.to)).success) {
    from = first(sp.from)!;
    to = first(sp.to)!;
    if (from > to) [from, to] = [to, from];
  } else {
    const days = (preset ?? RANGE_PRESETS[2]).days;
    from = formatInTimeZone(subDays(new Date(), days - 1), APP_TIMEZONE, "yyyy-MM-dd");
  }
  const branch = first(sp.branch);
  const employee = first(sp.employee);
  const type = first(sp.type);
  const category = first(sp.category);
  return {
    from,
    to,
    range: preset || range === "custom" ? range : defaultRange,
    branch: branch && uuid.safeParse(branch).success ? branch : null,
    employee: employee && uuid.safeParse(employee).success ? employee : null,
    surveyType: type === "purchased" || type === "non_purchased" ? type : null,
    category: category && category.length <= 80 ? category : null,
  };
}

export function rpcArgs(f: AnalyticsFilters) {
  return {
    p_from: f.from,
    p_to: f.to,
    p_branch: f.branch,
    p_employee: f.employee,
    p_survey_type: f.surveyType,
    p_category: f.category,
  };
}

/** Pick a sensible trend granularity for the selected window. */
export function grainFor(f: AnalyticsFilters): "day" | "week" | "month" {
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86400000 + 1;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}
