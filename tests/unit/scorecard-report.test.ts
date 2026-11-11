import { expect, test, vi } from "vitest";

// The scorecard report: correct columns, Low activity rows flagged red, PDF renders.
vi.mock("server-only", () => ({}));
vi.mock("@/server/services/analytics", async () => {
  const { scoreReps } = await import("@/lib/kpi");
  const rep = (o: Record<string, unknown>) => ({ employeeId: String(o.name), name: "x", branchId: "b1", branchName: "iDealz Prime", isActive: true, visits: 20, sales: 10, androidPhones: 5, applePhones: 5, otherDevices: 1, commissionAccessoriesValue: 8000, nonCommissionAccessoriesValue: 6000, timedVisits: 20, avgVisitMinutes: 25, measuredConversions: 10, avgConversionDays: 1.5, avgSalesSteps: 6, reviewsAsked: 10, reviewsConfirmed: 4, feedbackResponses: 12, avgStaffRating: 4.5, nps: 60, ...o });
  return { getRepScorecard: async () => scoreReps([
    rep({ name: "Kasun Perera", androidPhones: 10, applePhones: 9, commissionAccessoriesValue: 24000, sales: 15, reviewsConfirmed: 9, reviewsAsked: 15, avgSalesSteps: 7.5 }),
    rep({ name: "Nimali Silva" }),
    rep({ name: "Ruwan Fernando", androidPhones: 1, applePhones: 0, commissionAccessoriesValue: 0, nonCommissionAccessoriesValue: 1500, sales: 2, reviewsAsked: 0, reviewsConfirmed: 0, avgSalesSteps: 2, avgStaffRating: 2.5, nps: -40 }),
    rep({ name: "Ishara Jayasinghe", visits: 4, sales: 1, androidPhones: 1, applePhones: 0, otherDevices: 0, commissionAccessoriesValue: 2000, nonCommissionAccessoriesValue: 0, reviewsAsked: 2, reviewsConfirmed: 1, avgSalesSteps: 5 }),
    rep({ name: "Dilan Kumara", visits: 0, sales: 0, androidPhones: 0, applePhones: 0, otherDevices: 0, commissionAccessoriesValue: 0, nonCommissionAccessoriesValue: 0, reviewsAsked: 0, reviewsConfirmed: 0, avgSalesSteps: null, avgVisitMinutes: null, avgConversionDays: null, avgStaffRating: null, nps: null, feedbackResponses: 0, branchName: "iSeven Mobiles", branchId: "b2" }),
  ] as never, { minFeedbackSample: 10 }) };
});
test("scorecard report: KPI scores and raw counts stay in their own columns; low activity is flagged red", async () => {
  const { buildReport } = await import("@/server/reports/build");
  const { renderPdf, renderXlsx } = await import("@/server/reports/render");
  const f = { from: "2026-10-11", to: "2026-11-09", branch: null, employee: null, surveyType: null, category: null, range: "30d" };
  const r = await buildReport({} as never, { role: "super_admin" } as never, "rep_scorecard", f, null, 10);
  expect(new Set(r.columns.map((c) => c.key)).size).toBe(r.columns.length);
  expect(r.rows.map((x) => [x.rep, x.grade])).toEqual([
    ["Kasun Perera", "A+"], ["Nimali Silva", "B+"], ["Ruwan Fernando", "Fail"], ["Dilan Kumara", "LOW ACTIVITY"], ["Ishara Jayasinghe", "LOW ACTIVITY"],
  ]);
  expect(r.rows[0]).toMatchObject({ rank: 1, kpi_reviews: 100, reviews: "15/9" });
  expect(r.rows[3]).toMatchObject({ rank: "", score: null, status: "0 visits (needs 10)" });
  expect(r.rowTone).toEqual([null, null, null, "danger", "danger"]);
  expect(renderPdf(r, "iDealz Lanka").subarray(0, 4).toString()).toBe("%PDF");
  expect((await renderXlsx(r, "iDealz Lanka")).length).toBeGreaterThan(1000);
});
