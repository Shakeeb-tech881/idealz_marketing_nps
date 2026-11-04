import { formatNps, type NpsResult } from "@/lib/nps";
import { NON_PURCHASE_REASON_LABELS, type NonPurchaseReason } from "@/lib/survey/definitions";
import type { ThemeCount } from "./themes";

export interface Insight {
  question: string;
  answer: string;
  basis: string;
  tone: "good" | "warn" | "neutral";
}

interface Inputs {
  overall: NpsResult;
  promoterThemes: ThemeCount[];
  detractorThemes: ThemeCount[];
  allThemes: ThemeCount[];
  commentsAnalysed: number;
  reasons: { reason: string; responses: number; share: number | null }[];
  branches: { name: string; nps: NpsResult }[];
  minBranchSample: number;
  drivers: { category: string; staff: number | null; product: number | null; overall: number | null; pricing: number | null; responses: number }[];
  monthly: { period: string; overall: number | null; responses: number }[];
  minMonthlySample?: number;
}

/**
 * Plain-language answers to the management questions, derived only from the
 * aggregated data passed in. Each answer states its basis (sample size) and
 * returns "not enough data" rather than guessing.
 */
export function buildInsights(i: Inputs): Insight[] {
  const out: Insight[] = [];

  // Why do customers choose iDealz Lanka?
  const topPromoter = i.promoterThemes.slice(0, 2);
  out.push(
    topPromoter.length
      ? { question: "Why do customers choose iDealz Lanka?", answer: `Promoters most often mention ${topPromoter.map((t) => t.label.toLowerCase()).join(" and ")}.`, basis: `Keyword themes in ${topPromoter.reduce((s, t) => s + t.promoters, 0)} promoter comments`, tone: "good" }
      : { question: "Why do customers choose iDealz Lanka?", answer: "Not enough promoter comments yet to identify themes.", basis: `${i.overall.promoters} promoters in period`, tone: "neutral" },
  );

  // Why do customers decide not to purchase?
  const totalReasons = i.reasons.reduce((s, r) => s + r.responses, 0);
  const topReason = i.reasons[0];
  out.push(
    topReason && totalReasons > 0
      ? { question: "Why do customers decide not to purchase?", answer: `The most common reason is “${NON_PURCHASE_REASON_LABELS[topReason.reason as NonPurchaseReason] ?? topReason.reason}” (${topReason.share}% of non-purchased responses)${i.reasons[1] ? `, followed by “${NON_PURCHASE_REASON_LABELS[i.reasons[1].reason as NonPurchaseReason] ?? i.reasons[1].reason}”` : ""}.`, basis: `${totalReasons} non-purchased responses`, tone: "warn" }
      : { question: "Why do customers decide not to purchase?", answer: "No non-purchased responses in this period.", basis: "0 responses", tone: "neutral" },
  );

  // Which branches have the strongest customer experience?
  const reliable = i.branches.filter((b) => b.nps.total >= i.minBranchSample && b.nps.nps !== null).sort((a, b) => (b.nps.nps ?? 0) - (a.nps.nps ?? 0));
  out.push(
    reliable.length >= 1
      ? { question: "Which branches have the strongest customer experience?", answer: `${reliable[0].name} leads with NPS ${formatNps(reliable[0].nps.nps)}${reliable.length > 1 ? `; ${reliable[reliable.length - 1].name} is lowest at ${formatNps(reliable[reliable.length - 1].nps.nps)}` : ""}.`, basis: `Only branches with ≥ ${i.minBranchSample} responses compared (${reliable.length} of ${i.branches.length})`, tone: "good" }
      : { question: "Which branches have the strongest customer experience?", answer: "No branch has enough responses yet for a reliable comparison.", basis: `Minimum ${i.minBranchSample} responses per branch`, tone: "neutral" },
  );

  // Which areas require improvement / what factors are associated with lower NPS?
  const det = i.drivers.find((d) => d.category === "detractor");
  const pro = i.drivers.find((d) => d.category === "promoter");
  if (det && pro && det.responses >= 5 && pro.responses >= 5) {
    const gaps = (
      [
        ["staff service", pro.staff, det.staff],
        ["product satisfaction", pro.product, det.product],
        ["overall purchasing experience", pro.overall, det.overall],
        ["availability & pricing", pro.pricing, det.pricing],
      ] as const
    )
      .filter(([, p, d]) => p !== null && d !== null)
      .map(([name, p, d]) => ({ name, gap: Math.round(((p as number) - (d as number)) * 100) / 100, d: d as number }))
      .sort((a, b) => b.gap - a.gap);
    if (gaps.length) {
      out.push({ question: "What factors are associated with lower NPS?", answer: `The largest rating gap between promoters and detractors is ${gaps[0].name} (${gaps[0].gap.toFixed(2)} points on a 5-point scale; detractors average ${gaps[0].d.toFixed(2)}).`, basis: `${pro.responses} promoters vs ${det.responses} detractors · association, not proven cause`, tone: "warn" });
      const lowest = [...gaps].sort((a, b) => a.d - b.d)[0];
      out.push({ question: "Which areas require improvement?", answer: `Among detractors, ${lowest.name} has the lowest average rating (${lowest.d.toFixed(2)} / 5).`, basis: `${det.responses} detractor responses`, tone: "warn" });
    }
  } else {
    out.push({ question: "What factors are associated with lower NPS?", answer: "At least 5 promoters and 5 detractors are needed to compare ratings.", basis: `${pro?.responses ?? 0} promoters, ${det?.responses ?? 0} detractors`, tone: "neutral" });
  }

  // What improvements are most frequently requested?
  const topDet = i.detractorThemes[0] ?? i.allThemes[0];
  out.push(
    topDet
      ? { question: "What improvements are most frequently requested?", answer: `${topDet.label} is the most frequent topic in critical feedback (${topDet.detractors || topDet.total} comments)${i.detractorThemes[1] ? `, then ${i.detractorThemes[1].label.toLowerCase()}` : ""}.`, basis: `Keyword themes across ${i.commentsAnalysed} comments (indicative)`, tone: "warn" }
      : { question: "What improvements are most frequently requested?", answer: "Not enough written feedback to identify themes.", basis: `${i.commentsAnalysed} comments`, tone: "neutral" },
  );

  // How does feedback change month by month?
  const min = i.minMonthlySample ?? 10;
  const months = i.monthly.filter((m) => m.responses >= min && m.overall !== null);
  if (months.length >= 2) {
    const [prev, last] = months.slice(-2);
    const delta = Math.round(((last.overall as number) - (prev.overall as number)) * 10) / 10;
    out.push({ question: "How does customer feedback change month by month?", answer: `NPS moved from ${formatNps(prev.overall)} to ${formatNps(last.overall)} (${delta >= 0 ? "+" : ""}${delta} points) between the last two months with enough responses.`, basis: `${prev.responses} and ${last.responses} responses`, tone: delta >= 0 ? "good" : "warn" });
  } else {
    out.push({ question: "How does customer feedback change month by month?", answer: `Need at least two months with ${min}+ responses to compare.`, basis: `${months.length} qualifying month(s)`, tone: "neutral" });
  }
  return out;
}
