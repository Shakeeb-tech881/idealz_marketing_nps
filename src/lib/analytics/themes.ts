/**
 * Lightweight, transparent keyword theming of free-text feedback.
 * This is an indicative classification (keyword match), not a verified fact.
 */
export const FEEDBACK_THEMES = [
  { key: "price", label: "Price & offers", words: ["price", "pricing", "expensive", "cost", "cheap", "discount", "offer", "deal", "rate", "costly"] },
  { key: "availability", label: "Stock & availability", words: ["stock", "available", "availability", "unavailable", "out of stock", "colour", "color", "variant", "model"] },
  { key: "staff", label: "Staff & service", words: ["staff", "service", "salesman", "sales person", "rude", "friendly", "helpful", "polite", "attitude", "explain"] },
  { key: "speed", label: "Waiting time & speed", words: ["wait", "waiting", "slow", "delay", "late", "queue", "time", "quick", "fast"] },
  { key: "warranty", label: "Warranty & after-sales", words: ["warranty", "repair", "after sales", "service center", "replacement", "return", "refund", "guarantee"] },
  { key: "payment", label: "Payment & financing", words: ["payment", "card", "installment", "instalment", "emi", "leasing", "finance", "credit", "koko", "mintpay"] },
  { key: "product", label: "Product quality", words: ["quality", "battery", "defect", "damaged", "original", "genuine", "fake", "screen", "faulty"] },
  { key: "delivery", label: "Delivery", words: ["delivery", "courier", "shipping", "deliver"] },
  { key: "store", label: "Showroom & facilities", words: ["showroom", "parking", "shop", "store", "clean", "location", "ac ", "crowded"] },
] as const;

export function themesFor(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  return FEEDBACK_THEMES.filter((th) => th.words.some((w) => t.includes(w))).map((th) => th.key);
}

export interface ThemeCount {
  key: string;
  label: string;
  total: number;
  detractors: number;
  promoters: number;
}

export function countThemes(rows: { additional_feedback: string | null; nps_category: string }[]): ThemeCount[] {
  const map = new Map<string, ThemeCount>(FEEDBACK_THEMES.map((t) => [t.key, { key: t.key, label: t.label, total: 0, detractors: 0, promoters: 0 }]));
  for (const r of rows) {
    if (!r.additional_feedback) continue;
    for (const k of themesFor(r.additional_feedback)) {
      const c = map.get(k)!;
      c.total++;
      if (r.nps_category === "detractor") c.detractors++;
      if (r.nps_category === "promoter") c.promoters++;
    }
  }
  return [...map.values()].filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
}
