
/**
 * Sales rep scorecard.
 *
 * No targets are needed: sales-type KPIs compare each rep with the average rep
 * in the same showroom for the same period. Matching the average scores 75;
 * a third above average (or more) scores 100. Showrooms with fewer than two
 * graded reps are compared with all graded reps company-wide.
 *
 * Customer feedback and sales steps are absolute (they don't depend on peers).
 */

/**
 * Graded KPIs. The "What the rep did" sales-step ticks are self-reported, so they
 * are shown for information only and NOT graded; their former 10% went to
 * customer feedback, which the customer answers.
 */
export const KPI_WEIGHTS = {
  feedback: 35,
  phones: 25,
  accessories: 15,
  conversion: 15,
  reviews: 10,
} as const;
export type KpiKey = keyof typeof KPI_WEIGHTS;

export const KPI_LABELS: Record<KpiKey, string> = {
  feedback: "Customer feedback",
  phones: "Device sales",
  accessories: "Accessories",
  conversion: "Conversion rate",
  reviews: "Google reviews",
};

export const GRADE_BANDS = [
  { grade: "A+", min: 90 },
  { grade: "A", min: 80 },
  { grade: "B+", min: 70 },
  { grade: "B", min: 60 },
  { grade: "C+", min: 50 },
  { grade: "C", min: 40 },
  { grade: "Fail", min: 0 },
] as const;
export type Grade = (typeof GRADE_BANDS)[number]["grade"];

/** Score given to a rep who exactly matches the peer average. */
export const AVERAGE_SCORE = 75;
/** A rep needs at least this many tracked visits in the period to be graded. */
export const MIN_GRADED_VISITS = 10;
/** Each rupee of commission accessories counts 1.5× a rupee of non-commission accessories. */
export const COMMISSION_ACCESSORY_WEIGHT = 1.5;
/** Points taken off the final score for each day of sudden leave without proof. */
export const LEAVE_PENALTY_PER_DAY = 5;
/** Most points sudden leave can take off in one period. */
export const MAX_LEAVE_PENALTY = 25;

export interface RepKpiTotals {
  employeeId: string;
  name: string;
  branchId: string;
  branchName: string;
  isActive: boolean;
  visits: number;
  sales: number;
  androidPhones: number;
  applePhones: number;
  otherDevices: number;
  /** Accessories are measured by sales value (Rs.), not quantity. */
  commissionAccessoriesValue: number;
  nonCommissionAccessoriesValue: number;
  timedVisits: number;
  avgVisitMinutes: number | null;
  measuredConversions: number;
  avgConversionDays: number | null;
  avgSalesSteps: number | null;
  reviewsAsked: number;
  reviewsConfirmed: number;
  /** Survey feedback for the same period. */
  feedbackResponses: number;
  avgStaffRating: number | null;
  nps: number | null;
  /** Calendar days in the period (sales are compared per working day). */
  periodDays?: number;
  /** Days off of any kind in the period. */
  leaveDays?: number;
  /** Sudden leave without proof (penalised). */
  unexcusedLeaveDays?: number;
  /** Leave told in advance. */
  informedLeaveDays?: number;
  /** Sudden leave with proof (not penalised). */
  excusedSuddenDays?: number;
}

/**
 * graded            – has a grade A+ … Fail
 * low_activity      – fewer than MIN_GRADED_VISITS tracked visits: flagged for the manager to follow up, no grade
 * insufficient_data – enough visits, but too few KPIs can be measured yet for a fair grade
 */
export type RepStatus = "graded" | "low_activity" | "insufficient_data";

export interface RepScore extends RepKpiTotals {
  graded: boolean;
  status: RepStatus;
  /** 0–100 per KPI; null when it can't be measured (it is then left out and the other weights scale up). */
  components: Record<KpiKey, number | null>;
  /** Final score, after the sudden-leave penalty. */
  score: number | null;
  /** Weighted KPI score before the penalty. */
  scoreBeforePenalty: number | null;
  /** Points taken off for sudden leave without proof. */
  penalty: number;
  grade: Grade | null;
  comparedWith: "branch" | "company" | null;
  /** Visits recorded per working day ÷ colleagues' average (1 = same). Low values may mean visits are not being recorded. */
  recordingRate: number | null;
}

export function gradeFor(score: number): Grade {
  return GRADE_BANDS.find((b) => score >= b.min)!.grade;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** value ÷ peer average × 75, capped at 100. Null when the peer average is 0 (nobody did it). */
export function relativeScore(value: number, peerAverage: number): number | null {
  if (!(peerAverage > 0)) return null;
  return clamp((AVERAGE_SCORE * value) / peerAverage);
}

/** Staff rating (1–5) counts 60%, NPS (−100…100) 40%. Null below the minimum survey sample. */
export function feedbackScore(r: Pick<RepKpiTotals, "feedbackResponses" | "avgStaffRating" | "nps">, minSample: number): number | null {
  if (r.feedbackResponses < minSample || r.avgStaffRating === null) return null;
  const rating = ((r.avgStaffRating - 1) / 4) * 100;
  if (r.nps === null) return clamp(rating);
  return clamp(0.6 * rating + 0.4 * ((r.nps + 100) / 2));
}

/** Days the rep could sell: the period minus days off (at least 1). Without a period, totals are compared as they are. */
export function workingDays(r: Pick<RepKpiTotals, "periodDays" | "leaveDays">): number {
  if (!r.periodDays) return 1;
  return Math.max(1, r.periodDays - (r.leaveDays ?? 0));
}

export function leavePenalty(unexcusedDays: number | undefined): number {
  return Math.min(MAX_LEAVE_PENALTY, LEAVE_PENALTY_PER_DAY * Math.max(0, unexcusedDays ?? 0));
}

/** Below this share of the showroom's visits per day, the scorecard flags possible under-recording. */
export const LOW_RECORDING_RATE = 0.6;

export function visitsPerDay(r: RepKpiTotals): number {
  return r.visits / workingDays(r);
}

/**
 * Raw measures compared between peers. Sales volumes are per working day, so days off don't count against a rep.
 *
 * Conversion: if a rep records fewer customers per working day than their colleagues' average,
 * the rate is worked out as if they had served that average number — so leaving out walk-ins
 * who didn't buy never raises it. (`othersVisitsPerDay` = average of the OTHER reps compared.)
 * Reviews: only reviews a manager confirmed on Google count ("asked" is self-reported).
 */
function measures(r: RepKpiTotals, othersVisitsPerDay: number) {
  const days = workingDays(r);
  const expectedVisits = Math.max(r.visits, othersVisitsPerDay * days);
  return {
    phones: (r.androidPhones + r.applePhones + r.otherDevices) / days,
    accessories: (COMMISSION_ACCESSORY_WEIGHT * r.commissionAccessoriesValue + r.nonCommissionAccessoriesValue) / days,
    conversion: expectedVisits > 0 ? r.sales / expectedVisits : 0,
    reviews: r.reviewsConfirmed / days,
  };
}

export function weightedScore(components: Record<KpiKey, number | null>): number | null {
  let total = 0;
  let weights = 0;
  for (const k of Object.keys(KPI_WEIGHTS) as KpiKey[]) {
    const c = components[k];
    if (c === null) continue;
    total += c * KPI_WEIGHTS[k];
    weights += KPI_WEIGHTS[k];
  }
  // Need at least half the weight measurable to give a fair grade.
  if (weights < 50) return null;
  return Math.round((total / weights) * 10) / 10;
}

export function scoreReps(rows: RepKpiTotals[], opts: { minFeedbackSample: number; minVisits?: number }): RepScore[] {
  const minVisits = opts.minVisits ?? MIN_GRADED_VISITS;
  const graded = rows.filter((r) => r.visits >= minVisits);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return rows.map((r) => {
    const empty: Record<KpiKey, number | null> = { feedback: null, phones: null, accessories: null, conversion: null, reviews: null };
    const penalty = leavePenalty(r.unexcusedLeaveDays);
    if (r.visits < minVisits) return { ...r, graded: false, status: "low_activity", components: empty, score: null, scoreBeforePenalty: null, penalty, grade: null, comparedWith: null, recordingRate: null };

    const branchPeers = graded.filter((p) => p.branchId === r.branchId);
    const useBranch = branchPeers.length >= 2;
    const peers = useBranch ? branchPeers : graded;
    // Average visits per working day of the other reps in the comparison (0 when there are none).
    const othersVpd = (x: RepKpiTotals) => mean(peers.filter((p) => p.employeeId !== x.employeeId).map(visitsPerDay));
    const peerMeasures = peers.map((p) => measures(p, othersVpd(p)));
    const avg = (key: keyof ReturnType<typeof measures>) => mean(peerMeasures.map((pm) => pm[key]));
    const myOthersVpd = othersVpd(r);
    const m = measures(r, myOthersVpd);
    const components: Record<KpiKey, number | null> = {
      feedback: feedbackScore(r, opts.minFeedbackSample),
      phones: relativeScore(m.phones, avg("phones")),
      accessories: relativeScore(m.accessories, avg("accessories")),
      conversion: relativeScore(m.conversion, avg("conversion")),
      reviews: relativeScore(m.reviews, avg("reviews")),
    };
    for (const k of Object.keys(components) as KpiKey[]) {
      if (components[k] !== null) components[k] = Math.round(components[k]! * 10) / 10;
    }
    const before = weightedScore(components);
    const score = before === null ? null : Math.round(Math.max(0, before - penalty) * 10) / 10;
    return {
      ...r,
      graded: score !== null,
      status: score === null ? "insufficient_data" : "graded",
      components,
      score,
      scoreBeforePenalty: before,
      penalty,
      grade: score === null ? null : gradeFor(score),
      comparedWith: useBranch ? "branch" : "company",
      recordingRate: myOthersVpd > 0 ? Math.round((visitsPerDay(r) / myOthersVpd) * 100) / 100 : null,
    };
  });
}

/** What to show instead of a grade, with the reason. */
export function repStatusText(r: Pick<RepScore, "status" | "visits" | "leaveDays">, minVisits = MIN_GRADED_VISITS): string | null {
  if (r.status === "low_activity") {
    const off = r.leaveDays ? ` · ${r.leaveDays} day${r.leaveDays === 1 ? "" : "s"} on leave` : "";
    return `Low activity: ${r.visits} tracked visit${r.visits === 1 ? "" : "s"}, needs ${minVisits}${off}`;
  }
  if (r.status === "insufficient_data") return "Not graded: not enough measurable KPIs yet";
  return null;
}
