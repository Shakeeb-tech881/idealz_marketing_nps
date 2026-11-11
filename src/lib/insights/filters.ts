import { formatInTimeZone } from "date-fns-tz";
import { subMonths } from "date-fns";

/** Customer Insights / offer audience filters (shared by the page, exports and offers). */
export interface InsightFilters {
  q: string | null;
  model: string | null;
  category: string | null;
  brand: "apple" | "android" | null;
  branch: string | null;
  from: string | null;
  to: string | null;
  /** Only customers whose LAST purchase is older than this many months. */
  ageMonths: number | null;
  nps: "promoter" | "passive" | "detractor" | "none" | null;
  offers: "allowed" | "opted_out" | null;
}

export const AGE_OPTIONS = [3, 6, 12, 18, 24, 36] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const text = (v: string | string[] | undefined, max: number) => {
  const s = first(v)?.trim();
  return s ? s.slice(0, max) : null;
};

export function parseInsightFilters(sp: Record<string, string | string[] | undefined>): InsightFilters {
  const brand = first(sp.brand);
  const nps = first(sp.nps);
  const offers = first(sp.offers);
  const age = Number(first(sp.age));
  const from = first(sp.from);
  const to = first(sp.to);
  const branch = first(sp.branch);
  return {
    q: text(sp.q, 100),
    model: text(sp.model, 80),
    category: text(sp.category, 80),
    brand: brand === "apple" || brand === "android" ? brand : null,
    branch: branch && UUID.test(branch) ? branch : null,
    from: from && ISO.test(from) ? from : null,
    to: to && ISO.test(to) ? to : null,
    ageMonths: (AGE_OPTIONS as readonly number[]).includes(age) ? age : null,
    nps: nps === "promoter" || nps === "passive" || nps === "detractor" || nps === "none" ? nps : null,
    offers: offers === "allowed" || offers === "opted_out" ? offers : null,
  };
}

/** Back to URL parameters (only set values), e.g. for links to Offers or exports. */
export function insightFiltersToParams(f: InsightFilters): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: string | number | null) => v !== null && v !== "" && p.set(k, String(v));
  set("q", f.q);
  set("model", f.model);
  set("category", f.category);
  set("brand", f.brand);
  set("branch", f.branch);
  set("from", f.from);
  set("to", f.to);
  set("age", f.ageMonths);
  set("nps", f.nps);
  set("offers", f.offers);
  return p;
}

export function lastPurchaseBefore(ageMonths: number | null, now = new Date()): string | null {
  return ageMonths ? formatInTimeZone(subMonths(now, ageMonths), "Asia/Colombo", "yyyy-MM-dd") : null;
}

export function insightRpcArgs(f: InsightFilters, limit: number, offset: number, now = new Date()) {
  return {
    p_q: f.q,
    p_model: f.model,
    p_category: f.category,
    p_brand: f.brand,
    p_branch: f.branch,
    p_from: f.from,
    p_to: f.to,
    p_last_purchase_before: lastPurchaseBefore(f.ageMonths, now),
    p_nps: f.nps,
    p_offers: f.offers,
    p_limit: limit,
    p_offset: offset,
  };
}

/** Plain-language summary, e.g. "bought a model matching “iPhone 15” · last purchase over 12 months ago". */
export function describeInsightFilters(f: InsightFilters, branchName?: string | null): string {
  const parts: string[] = [];
  if (f.model) parts.push(`bought “${f.model}”`);
  if (f.brand) parts.push(f.brand === "apple" ? "bought Apple" : "bought Android");
  if (f.category) parts.push(`bought in ${f.category}`);
  if (branchName) parts.push(`at ${branchName}`);
  if (f.from || f.to) parts.push(`visited ${f.from ?? "…"} – ${f.to ?? "…"}`);
  if (f.ageMonths) parts.push(`last purchase over ${f.ageMonths} months ago`);
  if (f.nps) parts.push(f.nps === "none" ? "no survey answer" : `latest feedback: ${f.nps}`);
  if (f.q) parts.push(`name/mobile “${f.q}”`);
  return parts.length ? parts.join(" · ") : "all customers";
}
