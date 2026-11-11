import { describe, expect, test } from "vitest";
import { feedbackScore, gradeFor, repStatusText, KPI_WEIGHTS, relativeScore, scoreReps, weightedScore, type RepKpiTotals } from "@/lib/kpi";
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
    expect(weightedScore({ feedback: null, phones: 80, accessories: 80, conversion: 80, reviews: 80, process: 80 })).toBe(80);
    expect(weightedScore({ feedback: null, phones: null, accessories: null, conversion: 80, reviews: 80, process: 80 })).toBeNull();
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
    expect(a.components.conversion).toBe(b.components.conversion);
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
