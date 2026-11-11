import { formatInTimeZone } from "date-fns-tz";

export const APP_TIMEZONE = "Asia/Colombo";

export function formatDate(value: string | Date | null | undefined, pattern = "d MMM yyyy"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, APP_TIMEZONE, pattern);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, "d MMM yyyy, h:mm a");
}

/** Today's date in Colombo as YYYY-MM-DD. */
export function todayColombo(): string {
  return formatInTimeZone(new Date(), APP_TIMEZONE, "yyyy-MM-dd");
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-LK").format(n);
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;
}

export function formatRating(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "N/A";
  return Number(n).toFixed(2);
}

/** ISO timestamp `hours` ago (helper keeps render functions pure). */
export function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

/** Start of the current calendar month (UTC) as an ISO timestamp. */
export function isoMonthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Colombo calendar date `days` ago as YYYY-MM-DD. */
export function colomboDateDaysAgo(days: number): string {
  return formatInTimeZone(new Date(Date.now() - days * 86400000), APP_TIMEZONE, "yyyy-MM-dd");
}

/** Sri Lankan rupees, e.g. "Rs. 12,500" (cents only when present). */
export function formatLKR(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `Rs. ${new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 }).format(n)}`;
}
