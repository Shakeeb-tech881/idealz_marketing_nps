/**
 * Single source of truth for NPS maths.
 * NPS = %promoters − %detractors, using valid completed responses as the
 * denominator. Passives count in the denominator only. Returns null (shown as
 * "N/A") when there are no responses — never 0.
 */
export type NpsCategory = "promoter" | "passive" | "detractor";

export interface NpsCounts {
  promoters: number;
  passives: number;
  detractors: number;
}

export interface NpsResult extends NpsCounts {
  total: number;
  /** -100…100 rounded to 1 decimal, or null when total = 0 */
  nps: number | null;
  promoterPct: number | null;
  passivePct: number | null;
  detractorPct: number | null;
}

export function classifyNps(score: number): NpsCategory {
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    throw new RangeError(`NPS score must be an integer 0–10, got ${score}`);
  }
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/** Round half away from zero to 1 decimal place (consistent for ±values). */
export function round1(n: number): number {
  const r = Math.round(Math.abs(n) * 10) / 10;
  return n < 0 ? -r : r;
}

export function computeNps(counts: NpsCounts): NpsResult {
  const promoters = Number(counts.promoters) || 0;
  const passives = Number(counts.passives) || 0;
  const detractors = Number(counts.detractors) || 0;
  const total = promoters + passives + detractors;
  if (total === 0) {
    return { promoters, passives, detractors, total, nps: null, promoterPct: null, passivePct: null, detractorPct: null };
  }
  const p = (promoters / total) * 100;
  const d = (detractors / total) * 100;
  return {
    promoters,
    passives,
    detractors,
    total,
    nps: round1(p - d),
    promoterPct: round1(p),
    passivePct: round1((passives / total) * 100),
    detractorPct: round1(d),
  };
}

/** Build counts from total / promoters / detractors (passives derived). */
export function npsFromTotals(total: number, promoters: number, detractors: number): NpsResult {
  const t = Number(total) || 0;
  const p = Number(promoters) || 0;
  const d = Number(detractors) || 0;
  return computeNps({ promoters: p, detractors: d, passives: Math.max(0, t - p - d) });
}

export function formatNps(nps: number | null): string {
  if (nps === null) return "N/A";
  const s = Number.isInteger(nps) ? nps.toFixed(0) : nps.toFixed(1);
  return nps > 0 ? `+${s}` : s;
}

/** Ratio as a percentage, or null when the denominator is zero. */
export function pct(numerator: number, denominator: number): number | null {
  const d = Number(denominator) || 0;
  if (d === 0) return null;
  return round1(((Number(numerator) || 0) / d) * 100);
}
