import { describe, expect, test } from "vitest";
import { branchTotals, combineManagerScore, feedbackScore, gradeFor, repStatusText, KPI_WEIGHTS, MANAGER_WEIGHTS, relativeScore, scoreBranches, scoreManagers, scoreReps, weightedScore, type ManagerInput, type RepKpiTotals, type ScorecardRole } from "@/lib/kpi";
import { interactionImportSchema, interactionSchema, newCustomerSchema } from "@/lib/validation/customer";

const rep = (over: Partial<RepKpiTotals>): RepKpiTotals => ({
  employeeId: over.name ?? "x", name: "x", branchId: "b1", branchName: "Prime", isActive: true,
  visits: 20, sales: 10, androidPhones: 5, applePhones: 5, otherDevices: 0,
  commissionAccessoriesValue: 8000, nonCommissionAccessoriesValue: 6000, timedVisits: 20, avgVisitMinutes: 25,
  measuredConversions: 10, avgConversionDays: 1, avgSalesSteps: 6, reviewsAsked: 10, reviewsConfirmed: 4,
  feedbackResponses: 12, avgStaffRating: 4.5, nps: 60, ...over,
});

describe("rep scorecard", () => {
  test("weights add up to 100", () => {
    expect(Object.values(KPI_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("grade bands", () => {
    expect([95, 90, 89.9, 80, 75, 60, 55, 40, 39.9, 0].map(gradeFor)).toEqual(["A+", "A+", "A", "A", "B+", "B", "C+", "C", "Fail", "Fail"]);
  });

  test("matching the average scores 75, a third above scores 100, capped", () => {
    expect(relativeScore(10, 10)).toBe(75);
    expect(relativeScore(5, 10)).toBe(37.5);
    expect(relativeScore(40, 10)).toBe(100);
    expect(relativeScore(3, 0)).toBeNull();
  });

  test("feedback needs the minimum survey sample", () => {
    expect(feedbackScore({ feedbackResponses: 3, avgStaffRating: 5, nps: 100 }, 10)).toBeNull();
    expect(feedbackScore({ feedbackResponses: 10, avgStaffRating: 5, nps: 100 }, 10)).toBe(100);
    expect(feedbackScore({ feedbackResponses: 10, avgStaffRating: 1, nps: -100 }, 10)).toBe(0);
  });

  test("unmeasurable KPIs are left out and the rest scale up", () => {
    expect(weightedScore({ feedback: null, phones: 80, accessories: 80, conversion: 80, reviews: 80 })).toBe(80);
    expect(weightedScore({ feedback: null, phones: null, accessories: null, conversion: 80, reviews: 80 })).toBeNull();
  });

  test("reps are compared within their showroom; too few visits are not graded", () => {
    const out = scoreReps(
      [
        rep({ name: "Star", androidPhones: 10, applePhones: 10, commissionAccessoriesValue: 20000, sales: 15, reviewsConfirmed: 10, reviewsAsked: 15, avgSalesSteps: 8 }),
        rep({ name: "Average" }),
        rep({ name: "Weak", androidPhones: 1, applePhones: 0, commissionAccessoriesValue: 0, nonCommissionAccessoriesValue: 1500, sales: 2, reviewsAsked: 0, reviewsConfirmed: 0, avgSalesSteps: 2, avgStaffRating: 2.5, nps: -40 }),
        rep({ name: "New", visits: 3 }),
      ],
      { minFeedbackSample: 10 },
    );
    const by = Object.fromEntries(out.map((r) => [r.name, r]));
    expect(by.Star.grade).toMatch(/^A/);
    expect(by.Weak.grade).toBe("Fail");
    expect(by.Star.score!).toBeGreaterThan(by.Average.score!);
    expect(by.Average.score!).toBeGreaterThan(by.Weak.score!);
    expect(by.New).toMatchObject({ graded: false, status: "low_activity", grade: null, score: null });
    expect(repStatusText(by.New)).toBe("Low activity: 3 tracked visits, needs 10");
    expect(by.Star.status).toBe("graded");
    expect(repStatusText(by.Star)).toBeNull();
    expect(by.Star.comparedWith).toBe("branch");
  });

  test("a rep alone in a showroom is compared with the whole company", () => {
    const out = scoreReps([rep({ name: "A" }), rep({ name: "B" }), rep({ name: "Solo", branchId: "b2" })], { minFeedbackSample: 10 });
    expect(out.find((r) => r.name === "Solo")!.comparedWith).toBe("company");
    expect(out.find((r) => r.name === "A")!.comparedWith).toBe("branch");
  });
});

describe("visit form scorecard fields", () => {
  const base = { branch_id: "6f1c2a8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", purchase_status: "purchased", interaction_date: "2026-11-09", product_category: "Smartphones", product_model: "iPhone 16" };

  test("blank counts become 0 and checkbox values are normalised", () => {
    const v = interactionSchema.parse({ ...base, android_phones: "", apple_phones: "2", sales_steps: "greeted", visit_start: "10:05", visit_end: "10:40" });
    expect(v).toMatchObject({ android_phones: 0, apple_phones: 2, sales_steps: ["greeted"], visit_start: "10:05", visit_end: "10:40", google_review: "not_asked" });
    expect(interactionSchema.parse({ ...base, sales_steps: false }).sales_steps).toEqual([]);
  });

  test("end time must be after start; unknown steps and negative counts are rejected", () => {
    expect(interactionSchema.safeParse({ ...base, visit_start: "11:00", visit_end: "10:00" }).success).toBe(false);
    expect(interactionSchema.safeParse({ ...base, sales_steps: ["bribed"] }).success).toBe(false);
    expect(interactionSchema.safeParse({ ...base, apple_phones: -1 }).success).toBe(false);
    expect(interactionSchema.safeParse({ ...base, google_review: "maybe" }).success).toBe(false);
  });

  test("a visit without a purchase records no items sold", () => {
    const v = interactionSchema.parse({ ...base, purchase_status: "not_purchased", apple_phones: 3, commission_accessories: 2, google_review: "asked" });
    expect(v).toMatchObject({ apple_phones: 0, commission_accessories: 0, google_review: "asked" });
  });
});

describe("rep status", () => {
  test("enough visits but too few measurable KPIs is 'not graded', not low activity", () => {
    const [r] = scoreReps([rep({ name: "Solo", feedbackResponses: 0, androidPhones: 0, applePhones: 0, otherDevices: 0, commissionAccessoriesValue: 0, nonCommissionAccessoriesValue: 0, reviewsAsked: 0, reviewsConfirmed: 0, avgSalesSteps: null })], { minFeedbackSample: 10 });
    expect(r.status).toBe("insufficient_data");
    expect(repStatusText(r)).toBe("Not graded: not enough measurable KPIs yet");
  });
});

describe("customer form: browser check, then server check", () => {
  // Exactly what the Add customer form holds when only the required fields are filled.
  const blankForm = {
    full_name: "Nimal Perera", mobile: "077 123 4567", email: "", branch_id: "6f1c2a8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", employee_id: "",
    purchase_status: "purchased", interaction_date: "2026-11-09", purchase_date: "", product_category: "Smartphones", product_model: "iPhone 16 Pro",
    invoice_number: "", source: "walk_in", notes: "",
    android_phones: "0", apple_phones: "", other_devices: 0, commission_accessories: 0, non_commission_accessories: 0,
    visit_start: "", visit_end: "", sales_steps: false, google_review: "not_asked",
  };

  test.each([
    ["purchase, all optional fields blank", blankForm],
    ["visit without purchase, all optional fields blank", { ...blankForm, purchase_status: "not_purchased" }],
    ["everything filled", { ...blankForm, email: "A@B.LK", invoice_number: "INV-1", notes: "Paid cash", visit_start: "10:00", visit_end: "10:20", sales_steps: ["greeted"] }],
  ])("%s: saves, and the server accepts what the browser sends", (_label, form) => {
    const browser = newCustomerSchema.safeParse(form);
    expect(browser.success).toBe(true);
    const server = newCustomerSchema.safeParse(browser.data);
    expect(server.success, JSON.stringify(server.error?.issues)).toBe(true);
    expect(server.data).toEqual(browser.data);
    const visitOnly = interactionSchema.safeParse(interactionSchema.parse(form));
    expect(visitOnly.success, JSON.stringify(visitOnly.error?.issues)).toBe(true);
  });

  test("blank optional fields are saved as empty", () => {
    expect(newCustomerSchema.parse(blankForm)).toMatchObject({ email: null, invoice_number: null, notes: null, employee_id: null, visit_start: null });
  });
});

describe("staff leave", () => {
  test("sudden leave without proof costs 5 points a day, at most 25, and can change the grade", () => {
    const base = scoreReps([rep({ name: "A" }), rep({ name: "B" })], { minFeedbackSample: 10 })[0];
    const [two] = scoreReps([rep({ name: "A", unexcusedLeaveDays: 2 }), rep({ name: "B" })], { minFeedbackSample: 10 });
    expect(two.penalty).toBe(10);
    expect(two.scoreBeforePenalty).toBe(base.score);
    expect(two.score).toBeCloseTo(base.score! - 10, 5);
    const [many] = scoreReps([rep({ name: "A", unexcusedLeaveDays: 9 }), rep({ name: "B" })], { minFeedbackSample: 10 });
    expect(many.penalty).toBe(25);
    expect(many.grade).not.toBe(base.grade);
  });

  test("informed leave and sudden leave with proof cost nothing", () => {
    const [r] = scoreReps([rep({ name: "A", informedLeaveDays: 3, excusedSuddenDays: 2, leaveDays: 5 }), rep({ name: "B" })], { minFeedbackSample: 10 });
    expect(r.penalty).toBe(0);
  });

  test("days off don't count against sales: compared per working day", () => {
    // Same sales, but A was off 10 of 30 days → A sold more per working day.
    const out = scoreReps(
      [rep({ name: "A", periodDays: 30, leaveDays: 10 }), rep({ name: "B", periodDays: 30, leaveDays: 0 })],
      { minFeedbackSample: 10 },
    );
    const a = out.find((r) => r.name === "A")!;
    const b = out.find((r) => r.name === "B")!;
    expect(a.components.phones!).toBeGreaterThan(b.components.phones!);
    // A served as many customers in fewer working days, so conversion never favours B.
    expect(a.components.conversion!).toBeGreaterThanOrEqual(b.components.conversion!);
  });

  test("low activity reason mentions days on leave", () => {
    const [r] = scoreReps([rep({ name: "A", visits: 4, leaveDays: 6 })], { minFeedbackSample: 10 });
    expect(repStatusText(r)).toBe("Low activity: 4 tracked visits, needs 10 · 6 days on leave");
  });
});

describe("accessories by sales value", () => {
  test("the form takes rupee amounts (commas allowed, blank = 0)", () => {
    const base = { branch_id: "6f1c2a8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", purchase_status: "purchased", interaction_date: "2026-11-13", product_category: "Smartphones", product_model: "Galaxy S25" };
    expect(interactionSchema.parse({ ...base, commission_accessories_value: "12,500", non_commission_accessories_value: "" })).toMatchObject({
      commission_accessories_value: 12500, non_commission_accessories_value: 0,
    });
    expect(interactionSchema.parse({ ...base, commission_accessories_value: "999.999" }).commission_accessories_value).toBe(1000);
    expect(interactionSchema.safeParse({ ...base, commission_accessories_value: "-5" }).success).toBe(false);
    expect(interactionSchema.safeParse({ ...base, commission_accessories_value: "abc" }).success).toBe(false);
    expect(interactionSchema.parse({ ...base, purchase_status: "not_purchased", commission_accessories_value: 5000 }).commission_accessories_value).toBe(0);
  });

  test("more accessory sales value per working day scores higher; commission rupees count 1.5×", () => {
    const out = scoreReps(
      [
        rep({ name: "Comm", commissionAccessoriesValue: 10000, nonCommissionAccessoriesValue: 0 }),
        rep({ name: "NonComm", commissionAccessoriesValue: 0, nonCommissionAccessoriesValue: 10000 }),
      ],
      { minFeedbackSample: 10 },
    );
    const c = out.find((r) => r.name === "Comm")!;
    const n = out.find((r) => r.name === "NonComm")!;
    expect(c.components.accessories!).toBeGreaterThan(n.components.accessories!);
  });
});

describe("product is required when adding a customer or visit", () => {
  const base = { branch_id: "6f1c2a8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f", interaction_date: "2026-11-13" };
  const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
    Object.fromEntries((r.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));

  test("purchase without category or model is rejected with clear messages", () => {
    const r = interactionSchema.safeParse({ ...base, purchase_status: "purchased", product_category: "", product_model: " " });
    expect(r.success).toBe(false);
    expect(issues(r)).toMatchObject({ product_category: "Choose the product category", product_model: expect.stringMatching(/model bought/) });
  });

  test("a visit without a purchase needs the product asked about", () => {
    const r = interactionSchema.safeParse({ ...base, purchase_status: "not_purchased", product_category: "Smartphones" });
    expect(issues(r)).toEqual({ product_model: "Enter the product / model they asked about" });
    expect(interactionSchema.safeParse({ ...base, purchase_status: "not_purchased", product_category: "Smartphones", product_model: "Pixel 9" }).success).toBe(true);
  });

  test("the add-customer form enforces it too; Excel/CSV imports stay lenient", () => {
    const contact = { full_name: "Nimal", mobile: "0771234567" };
    expect(newCustomerSchema.safeParse({ ...contact, ...base, purchase_status: "purchased" }).success).toBe(false);
    expect(interactionImportSchema.safeParse({ ...base, purchase_status: "purchased" }).success).toBe(true);
  });
});

describe("self-reported sales steps", () => {
  test("ticking every step does not change the grade", () => {
    const [none] = scoreReps([rep({ name: "A", avgSalesSteps: 0 }), rep({ name: "B" })], { minFeedbackSample: 10 });
    const [all] = scoreReps([rep({ name: "A", avgSalesSteps: 8 }), rep({ name: "B" })], { minFeedbackSample: 10 });
    expect(all.score).toBe(none.score);
    expect(Object.keys(all.components)).not.toContain("process");
  });

  test("customer feedback now weighs 35%", () => {
    expect(KPI_WEIGHTS.feedback).toBe(35);
  });
});

describe("fair play", () => {
  test("leaving out walk-ins who didn't buy does not raise conversion", () => {
    const out = scoreReps(
      [
        rep({ name: "Honest", visits: 20, sales: 10, periodDays: 30 }),
        rep({ name: "Skipper", visits: 10, sales: 10, periodDays: 30 }),
        rep({ name: "Third", visits: 20, sales: 10, periodDays: 30 }),
      ],
      { minFeedbackSample: 10 },
    );
    const h = out.find((r) => r.name === "Honest")!;
    const s = out.find((r) => r.name === "Skipper")!;
    expect(s.components.conversion!).toBeLessThanOrEqual(h.components.conversion!);
    expect(s.recordingRate).toBe(0.5);
    expect(h.recordingRate).toBe(1.33);
  });

  test("only manager-confirmed Google reviews count; 'asked' alone earns nothing", () => {
    const out = scoreReps(
      [rep({ name: "Asker", reviewsAsked: 20, reviewsConfirmed: 0 }), rep({ name: "Real", reviewsAsked: 5, reviewsConfirmed: 5 })],
      { minFeedbackSample: 10 },
    );
    expect(out.find((r) => r.name === "Asker")!.components.reviews).toBe(0);
    expect(out.find((r) => r.name === "Real")!.components.reviews!).toBeGreaterThan(0);
  });
});

describe("branch scorecard (branch managers)", () => {
  const emp = (name: string, branchId: string, role: ScorecardRole, over: Partial<RepKpiTotals> = {}) => ({
    ...rep({ name, branchId, branchName: branchId === "b1" ? "Prime" : branchId === "b2" ? "Marino" : "iSeven", periodDays: 30, ...over }),
    scorecardRole: role,
  });
  const fb = new Map([
    ["b1", { responses: 30, avgStaffRating: 4.5, nps: 60 }],
    ["b2", { responses: 30, avgStaffRating: 4.5, nps: 60 }],
    ["b3", { responses: 3, avgStaffRating: 5, nps: 100 }],
  ]);

  test("every visit counts for the branch; management adds sales but no staff days", () => {
    const [b1] = branchTotals(
      [emp("Rep1", "b1", "rep"), emp("Mgr", "b1", "branch_manager", { visits: 10, sales: 5 }), emp("Boss", "b1", "not_scored", { visits: 4, sales: 4 })],
      fb, new Map([["b1", ["Mgr"]]]),
    );
    expect(b1).toMatchObject({ name: "Prime", visits: 34, sales: 19, staffCount: 2, staffDays: 60, managers: ["Mgr"], feedbackResponses: 30 });
  });

  test("a branch's sales are per staff day, so size alone does not win", () => {
    // b1 has two reps, b2 one rep doing exactly the same per person: equal scores.
    const totals = branchTotals([emp("A", "b1", "rep"), emp("B", "b1", "rep"), emp("C", "b2", "rep")], fb, new Map());
    const [b1, b2] = scoreBranches(totals, { minFeedbackSample: 10 });
    expect(b1.components.phones).toBe(75);
    expect(b2.components.phones).toBe(75);
    expect(b1.score).toBe(b2.score);
    expect(b1.comparedWith).toBe("company");
  });

  test("a stronger branch scores higher; too few branch responses leaves feedback out", () => {
    const totals = branchTotals(
      [emp("A", "b1", "rep", { applePhones: 10 }), emp("C", "b2", "rep"), emp("D", "b3", "rep")],
      fb, new Map(),
    );
    const out = scoreBranches(totals, { minFeedbackSample: 10 });
    const by = Object.fromEntries(out.map((b) => [b.branchId, b]));
    expect(by.b1.components.phones!).toBeGreaterThan(by.b2.components.phones!);
    expect(by.b3.components.feedback).toBeNull();
    expect(by.b1.grade).not.toBeNull();
  });

  test("a branch with fewer than 10 visits is flagged low activity, not graded", () => {
    const totals = branchTotals([emp("A", "b1", "rep"), emp("C", "b2", "rep", { visits: 4, sales: 2 })], fb, new Map());
    const by = Object.fromEntries(scoreBranches(totals, { minFeedbackSample: 10 }).map((b) => [b.branchId, b]));
    expect(by.b2.status).toBe("low_activity");
    expect(by.b2.grade).toBeNull();
    expect(by.b2.penalty).toBe(0);
  });
});

describe("branch managers' leave and a single live branch", () => {
  const emp = (name: string, branchId: string, role: ScorecardRole, over: Partial<RepKpiTotals> = {}) => ({
    ...rep({ name, branchId, branchName: branchId, periodDays: 30, ...over }),
    scorecardRole: role,
  });
  const fb = new Map([["b1", { responses: 30, avgStaffRating: 4.5, nps: 60 }], ["b2", { responses: 30, avgStaffRating: 4.5, nps: 60 }]]);

  test("the branch result has no leave penalty (it is on each manager's own grade); manager leave is still shown", () => {
    const rows = branchTotals([
      emp("Rep1", "b1", "rep"), emp("Mgr1", "b1", "branch_manager", { unexcusedLeaveDays: 2, informedLeaveDays: 1, leaveDays: 3 }),
      emp("Rep2", "b2", "rep"), emp("Mgr2", "b2", "branch_manager"),
    ], fb, new Map());
    const by = Object.fromEntries(scoreBranches(rows, { minFeedbackSample: 10 }).map((b) => [b.branchId, b]));
    expect(by.b1.managerLeave).toEqual({ informed: 1, suddenProof: 0, suddenNoProof: 2 });
    expect(by.b1.penalty).toBe(0);
    expect(by.b1.score).toBe(by.b1.scoreBeforePenalty);
    expect(by.b2.penalty).toBe(0);
    // A rep's leave is not a branch penalty (it only lowers the staff days).
    expect(by.b1.staffDays).toBe(30 + 27);
  });

  test("with only one live branch there is no grade yet, but results and leave still show", () => {
    const rows = branchTotals([emp("Rep1", "b1", "rep"), emp("Mgr1", "b1", "branch_manager", { unexcusedLeaveDays: 1, leaveDays: 1 })], fb, new Map([["b1", ["Mgr1"]]]));
    const [b1] = scoreBranches(rows, { minFeedbackSample: 10 });
    expect(b1.grade).toBeNull();
    expect(b1.status).toBe("insufficient_data");
    expect(b1.note).toMatch(/second branch/);
    expect(b1.components.phones).toBeNull();
    expect(b1.components.feedback).not.toBeNull();
    expect(b1.penalty).toBe(0);
    expect(b1.managerLeave.suddenNoProof).toBe(1);
    expect(b1.visits).toBe(40);
  });
});

describe("branch manager grade: 70% branch result + 30% own sales", () => {
  const emp = (name: string, branchId: string, role: ScorecardRole, over: Partial<RepKpiTotals> = {}) => ({
    ...rep({ name, branchId, branchName: branchId === "b1" ? "Prime" : "Marino", periodDays: 30, ...over }),
    scorecardRole: role,
  });
  const fb = new Map([["b1", { responses: 30, avgStaffRating: 4.5, nps: 60 }], ["b2", { responses: 30, avgStaffRating: 4.5, nps: 60 }]]);
  const input = (e: ReturnType<typeof emp>): ManagerInput => ({ totals: e, name: e.name, branchId: e.branchId, branchName: e.branchName, isActive: true });
  const run = (people: ReturnType<typeof emp>[], extra: ManagerInput[] = []) => {
    const branches = scoreBranches(branchTotals(people, fb, new Map()), { minFeedbackSample: 10 });
    const managers = scoreManagers(
      [...people.filter((p) => p.scorecardRole === "branch_manager").map(input), ...extra],
      people.filter((p) => p.scorecardRole === "rep"),
      branches,
      { minFeedbackSample: 10 },
    );
    return { branches: Object.fromEntries(branches.map((b) => [b.branchId, b])), managers: Object.fromEntries(managers.map((m) => [m.name, m])) };
  };
  const twoBranches = (mgr1: Partial<RepKpiTotals> = {}, mgr2: Partial<RepKpiTotals> = {}) => [
    emp("R1", "b1", "rep"), emp("R2", "b1", "rep"), emp("M1", "b1", "branch_manager", mgr1),
    emp("R3", "b2", "rep"), emp("R4", "b2", "rep"), emp("M2", "b2", "branch_manager", mgr2),
  ];

  test("weights are 70 / 30 and the maths is exact", () => {
    expect(MANAGER_WEIGHTS.branch + MANAGER_WEIGHTS.own).toBe(100);
    expect(combineManagerScore(80, 60)).toBe(74);
    expect(combineManagerScore(79.1, 60)).toBe(73.4); // 55.37 + 18 = 73.37
    expect(combineManagerScore(100, 0)).toBe(70);
    expect(combineManagerScore(0, 100)).toBe(30);
  });

  test("a manager selling exactly like the branch reps: own KPIs 75, feedback 84.5, own 78.3, grade B+", () => {
    const { branches, managers } = run(twoBranches());
    const m = managers.M1;
    expect(m.own!.components).toEqual({ feedback: 84.5, phones: 75, accessories: 75, conversion: 75, reviews: 75 });
    expect(m.ownScore).toBe(78.3); // (84.5×35 + 75×65) / 100 = 78.325
    expect(branches.b1.score).toBe(78.3);
    expect(m.branchScore).toBe(78.3);
    expect(m.scoreBeforePenalty).toBe(78.3);
    expect(m).toMatchObject({ status: "graded", score: 78.3, grade: "B+", penalty: 0, note: null });
    expect(m.own!.comparedWith).toBe("branch");
  });

  test("own sales above the branch reps lift only the 30% part", () => {
    // Twice the reps' devices per day: devices score 100 (capped) instead of 75.
    const { managers } = run(twoBranches({ androidPhones: 10, applePhones: 10 }));
    const m = managers.M1;
    expect(m.own!.components.phones).toBe(100);
    const own = Math.round(((84.5 * 35 + 100 * 25 + 75 * 40) / 100) * 10) / 10; // 84.6
    expect(m.ownScore).toBe(own);
    expect(m.score).toBe(combineManagerScore(m.branchScore!, own));
  });

  test("the manager's own sudden leave without proof: 5 points a day off their own grade only", () => {
    const { managers, branches } = run(twoBranches({ unexcusedLeaveDays: 2, leaveDays: 2 }));
    expect(managers.M1.penalty).toBe(10);
    expect(managers.M1.score).toBe(Math.round((managers.M1.scoreBeforePenalty! - 10) * 10) / 10);
    expect(managers.M1.leave).toEqual({ informed: 0, suddenProof: 0, suddenNoProof: 2 });
    expect(managers.M2.penalty).toBe(0);
    expect(branches.b1.penalty).toBe(0);
  });

  test("two managers at one branch share the branch result but get their own grade", () => {
    const people = [...twoBranches(), emp("M1b", "b1", "branch_manager", { androidPhones: 1, applePhones: 1, unexcusedLeaveDays: 1, leaveDays: 1 })];
    const { managers } = run(people);
    expect(managers.M1.branchScore).toBe(managers.M1b.branchScore);
    expect(managers.M1b.ownScore!).toBeLessThan(managers.M1.ownScore!);
    expect(managers.M1b.penalty).toBe(5);
    expect(managers.M1.penalty).toBe(0);
  });

  test("own sales are compared with the company's reps when the branch has fewer than two graded reps", () => {
    const people = [emp("R1", "b1", "rep"), emp("M1", "b1", "branch_manager"), emp("R3", "b2", "rep"), emp("R4", "b2", "rep")];
    const { managers } = run(people);
    expect(managers.M1.own!.comparedWith).toBe("company");
  });

  test("fewer than 10 own visits: low activity, no grade, branch result still shown", () => {
    const { managers } = run(twoBranches({ visits: 6, sales: 3 }));
    expect(managers.M1).toMatchObject({ status: "low_activity", grade: null, score: null, ownScore: null });
    expect(managers.M1.branchScore).not.toBeNull();
    expect(managers.M1.note).toMatch(/6 tracked visits, needs 10/);
  });

  test("only one live branch: own sales are scored, but no grade until the branch result exists", () => {
    const people = [emp("R1", "b1", "rep"), emp("R2", "b1", "rep"), emp("M1", "b1", "branch_manager")];
    const { managers } = run(people);
    expect(managers.M1).toMatchObject({ status: "waiting_for_branch", grade: null, score: null, branchScore: null });
    expect(managers.M1.ownScore).toBe(78.3);
    expect(managers.M1.note).toMatch(/second branch/);
  });

  test("a branch-manager login without an employee record can't be graded and says why", () => {
    const { managers } = run(twoBranches(), [{ totals: null, name: "Unlinked", branchId: "b1", branchName: "Prime", isActive: true }]);
    expect(managers.Unlinked).toMatchObject({ status: "no_employee", grade: null, own: null, employeeId: null });
    expect(managers.Unlinked.note).toMatch(/link this login to an employee record/);
  });

  test("reps' grades don't change when a manager sells (managers are never their peers)", () => {
    const people = twoBranches({ androidPhones: 20, applePhones: 20 });
    const before = scoreReps(people.filter((p) => p.scorecardRole === "rep"), { minFeedbackSample: 10 });
    run(people);
    const after = scoreReps(people.filter((p) => p.scorecardRole === "rep"), { minFeedbackSample: 10 });
    expect(after).toEqual(before);
    expect(before.every((r) => r.components.phones === 75)).toBe(true);
  });
});
