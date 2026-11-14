import { expect, test, vi } from "vitest";

// The Branch Manager Scorecard report: 70/30 columns, notes for managers without a grade, PDF renders.
vi.mock("server-only", () => ({}));
vi.mock("@/server/services/analytics", async () => {
  const { branchTotals, scoreBranches, scoreManagers } = await import("@/lib/kpi");
  const base = { isActive: true, visits: 20, sales: 10, androidPhones: 5, applePhones: 5, otherDevices: 0, commissionAccessoriesValue: 8000, nonCommissionAccessoriesValue: 6000, timedVisits: 20, avgVisitMinutes: 25, measuredConversions: 10, avgConversionDays: 1, avgSalesSteps: 6, reviewsAsked: 10, reviewsConfirmed: 4, feedbackResponses: 12, avgStaffRating: 4.5, nps: 60, periodDays: 30 };
  const emp = (name: string, branchId: string, role: "rep" | "branch_manager", o: Record<string, unknown> = {}) => ({ ...base, employeeId: name, name, branchId, branchName: branchId === "b1" ? "iDealz Prime" : "iDealz Marino", scorecardRole: role, ...o });
  const people = [
    emp("Rep A", "b1", "rep"), emp("Rep B", "b1", "rep"), emp("Manager Prime", "b1", "branch_manager", { unexcusedLeaveDays: 1, leaveDays: 1 }),
    emp("Rep C", "b2", "rep"), emp("Rep D", "b2", "rep"), emp("Manager Marino", "b2", "branch_manager", { visits: 3, sales: 1 }),
  ];
  const fb = new Map([["b1", { responses: 30, avgStaffRating: 4.5, nps: 60 }], ["b2", { responses: 30, avgStaffRating: 4.5, nps: 60 }]]);
  const branches = scoreBranches(branchTotals(people as never, fb, new Map()), { minFeedbackSample: 10 });
  const managers = scoreManagers(
    people.filter((p) => p.scorecardRole === "branch_manager").map((p) => ({ totals: p as never, name: p.name, branchId: p.branchId, branchName: p.branchName, isActive: true })),
    people.filter((p) => p.scorecardRole === "rep") as never,
    branches,
    { minFeedbackSample: 10 },
  );
  return { getBranchScorecard: async () => ({ branches, managers }) };
});

test("manager report: 70% branch + 30% own, leave penalty, low activity flagged", async () => {
  const { buildReport } = await import("@/server/reports/build");
  const { renderPdf, renderXlsx } = await import("@/server/reports/render");
  const f = { from: "2026-10-16", to: "2026-11-14", branch: null, employee: null, surveyType: null, category: null, range: "30d" };
  const r = await buildReport({} as never, { role: "management" } as never, "manager_scorecard", f, null, 10);
  expect(new Set(r.columns.map((c) => c.key)).size).toBe(r.columns.length);
  expect(r.rows.map((x) => [x.manager, x.grade])).toEqual([["Manager Prime", "B+"], ["Manager Marino", "LOW ACTIVITY"]]);
  const prime = r.rows[0];
  expect(prime).toMatchObject({ rank: 1, branch_score: expect.any(Number), own_score: expect.any(Number), penalty: -5, noproof: 1, compared: "Branch reps" });
  expect(prime.before).toBe(Math.round((0.7 * (prime.branch_score as number) + 0.3 * (prime.own_score as number)) * 10) / 10);
  expect(prime.score).toBe(Math.round(((prime.before as number) - 5) * 10) / 10);
  expect(r.rows[1]).toMatchObject({ rank: "", score: null, status: "Own sales: 3 tracked visits, needs 10." });
  expect(r.rowTone).toEqual([null, "danger"]);
  expect(renderPdf(r, "iDealz Lanka").subarray(0, 4).toString()).toBe("%PDF");
  expect((await renderXlsx(r, "iDealz Lanka")).length).toBeGreaterThan(1000);
});

test("staff and branch managers can't download the manager report", async () => {
  const { buildReport } = await import("@/server/reports/build");
  const f = { from: "2026-10-16", to: "2026-11-14", branch: null, employee: null, surveyType: null, category: null, range: "30d" };
  await expect(buildReport({} as never, { role: "branch_manager" } as never, "manager_scorecard", f, null, 10)).rejects.toThrow(/Management and Super Admin/);
});
