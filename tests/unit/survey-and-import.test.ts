import { describe, expect, test } from "vitest";
import { nonPurchasedAnswersSchema, purchasedAnswersSchema } from "@/lib/survey/schema";
import { SURVEYS, surveyFor } from "@/lib/survey/definitions";
import { normaliseMobile, maskMobile, formatMobile } from "@/lib/phone";
import { guessMapping, parseDate, parsePurchaseStatus, parseSource } from "@/lib/import/fields";
import { redactLink, renderTemplate, smsSegments } from "@/lib/messaging/template";
import { countThemes, themesFor } from "@/lib/analytics/themes";
import { MockSmsProvider } from "@/lib/messaging/mock";
import { newCustomerSchema } from "@/lib/validation/customer";

describe("survey definitions", () => {
  test("each survey has exactly five questions, NPS first, optional text last", () => {
    for (const qs of Object.values(SURVEYS)) {
      expect(qs).toHaveLength(5);
      expect(qs[0]).toMatchObject({ key: "nps_score", kind: "nps", required: true });
      expect(qs[4]).toMatchObject({ key: "additional_feedback", kind: "text", required: false });
    }
  });
  test("purchased and non-purchased questionnaires do not share rating questions", () => {
    const p = SURVEYS.purchased.map((q) => q.key);
    const n = SURVEYS.non_purchased.map((q) => q.key);
    expect(p).toContain("product_satisfaction");
    expect(n).not.toContain("product_satisfaction");
    expect(n).toContain("non_purchase_reason");
    expect(p).not.toContain("non_purchase_reason");
  });
});

describe("answer validation", () => {
  test("purchased: valid, optional feedback omitted", () => {
    const r = purchasedAnswersSchema.safeParse({ nps_score: 9, product_satisfaction: 5, staff_service_rating: 5, overall_experience_rating: 4 });
    expect(r.success).toBe(true);
  });
  test("purchased: rejects stars/emojis outside 1–5 and NPS outside 0–10", () => {
    expect(purchasedAnswersSchema.safeParse({ nps_score: 11, product_satisfaction: 5, staff_service_rating: 5, overall_experience_rating: 4 }).success).toBe(false);
    expect(purchasedAnswersSchema.safeParse({ nps_score: 5, product_satisfaction: 0, staff_service_rating: 5, overall_experience_rating: 4 }).success).toBe(false);
    expect(purchasedAnswersSchema.safeParse({ nps_score: 5, product_satisfaction: 3, staff_service_rating: 6, overall_experience_rating: 4 }).success).toBe(false);
  });
  test("empty feedback becomes undefined", () => {
    const r = purchasedAnswersSchema.parse({ nps_score: 0, product_satisfaction: 1, staff_service_rating: 1, overall_experience_rating: 1, additional_feedback: "   " });
    expect(r.additional_feedback).toBeUndefined();
  });
  test("non-purchased: 'other' requires description; others drop it", () => {
    const base = { nps_score: 5, staff_service_rating: 3, product_pricing_satisfaction: 2 };
    expect(nonPurchasedAnswersSchema.safeParse({ ...base, non_purchase_reason: "other" }).success).toBe(false);
    expect(nonPurchasedAnswersSchema.parse({ ...base, non_purchase_reason: "other", other_reason_description: "EMI" }).other_reason_description).toBe("EMI");
    expect(nonPurchasedAnswersSchema.parse({ ...base, non_purchase_reason: "price_too_high", other_reason_description: "x" }).other_reason_description).toBeUndefined();
    expect(nonPurchasedAnswersSchema.safeParse({ ...base, non_purchase_reason: "made_up" }).success).toBe(false);
  });
});

describe("phone numbers", () => {
  test.each([
    ["0771234567", "+94771234567"],
    ["771234567", "+94771234567"],
    ["94771234567", "+94771234567"],
    ["+94 77 123 4567", "+94771234567"],
    ["0094771234567", "+94771234567"],
    ["077-123-4567", "+94771234567"],
  ])("%s → %s", (input, out) => expect(normaliseMobile(input)).toBe(out));
  test("rejects landlines and junk", () => {
    expect(normaliseMobile("0112345678")).toBeNull();
    expect(normaliseMobile("12345")).toBeNull();
    expect(normaliseMobile("")).toBeNull();
  });
  test("formatting and masking", () => {
    expect(formatMobile("+94771234567")).toBe("077 123 4567");
    expect(maskMobile("+94771234567")).not.toContain("1234");
  });
});

describe("customer form validation", () => {
  const base = { full_name: "Nimal", mobile: "0771234567", email: "", branch_id: "6f1c1d1e-2b3a-4c5d-8e9f-0a1b2c3d4e5f", employee_id: "", interaction_date: "2026-11-01", purchase_date: "", product_category: "", product_model: "", invoice_number: "INV-1", source: "walk_in", notes: "" };
  test("purchased defaults purchase date to visit date", () => {
    const r = newCustomerSchema.parse({ ...base, purchase_status: "purchased" });
    expect(r.purchase_date).toBe("2026-11-01");
    expect(r.mobile).toBe("+94771234567");
  });
  test("non-purchased strips purchase date and invoice", () => {
    const r = newCustomerSchema.parse({ ...base, purchase_status: "not_purchased", purchase_date: "2026-11-01" });
    expect(r.purchase_date).toBeNull();
    expect(r.invoice_number).toBeNull();
  });
});

describe("import parsing", () => {
  test("guesses mappings from common headers", () => {
    expect(guessMapping(["Customer Name", "Phone", "Branch Code", "Salesperson", "Purchased", "Invoice No"])).toMatchObject({
      full_name: "Customer Name", mobile: "Phone", branch: "Branch Code", employee: "Salesperson", purchase_status: "Purchased", invoice_number: "Invoice No",
    });
  });
  test("purchase status values", () => {
    expect(parsePurchaseStatus("Yes")).toBe("purchased");
    expect(parsePurchaseStatus("Not Purchased")).toBe("not_purchased");
    expect(parsePurchaseStatus("enquiry")).toBe("not_purchased");
    expect(parsePurchaseStatus("maybe")).toBeNull();
  });
  test("dates", () => {
    expect(parseDate("2026-11-04")).toBe("2026-11-04");
    expect(parseDate("04/11/2026")).toBe("2026-11-04");
    expect(parseDate("31/02/2026")).toBe("invalid");
    expect(parseDate("")).toBeNull();
  });
  test("sources", () => {
    expect(parseSource("Facebook")).toBe("social_media");
    expect(parseSource("Walk in")).toBe("walk_in");
    expect(parseSource("TV")).toBe("other");
  });
});

describe("SMS templates & providers", () => {
  const body = "Hi {{customer_name}}, thank you! {{survey_link}}";
  test("personalises with first name and link, and redacts the link for logs", () => {
    const link = "https://feedback.idealzlanka.com/survey/abc";
    const msg = renderTemplate(body, { customerName: "Nimal Perera", surveyLink: link });
    expect(msg).toBe(`Hi Nimal, thank you! ${link}`);
    expect(redactLink(msg, link)).toBe("Hi Nimal, thank you! [survey-link]");
  });
  test("survey questions use the showroom's brand", () => {
    const iseven = surveyFor("purchased", "iSeven Mobiles");
    expect(iseven[0].text).toBe("How likely are you to recommend iSeven Mobiles to your friends or family based on your purchasing experience?");
    expect(iseven.some((q) => q.text.includes("iDealz"))).toBe(false);
    const np = surveyFor("non_purchased", "iSeven Mobiles");
    expect(np[4].placeholder).toContain("iSeven Mobiles");
    for (const type of ["purchased", "non_purchased"] as const) {
      const d = surveyFor(type, null);
      expect(d.every((q) => !q.text.includes("{brand}") && !(q.placeholder ?? "").includes("{brand}"))).toBe(true);
      expect(d[0].text).toContain("iDealz Lanka");
      expect(d.map((q) => q.key)).toEqual(SURVEYS[type].map((q) => q.key));
    }
  });
  test("{{brand_name}} renders the showroom brand, defaulting to iDealz Lanka", () => {
    const t = "Hi {{customer_name}}, thank you for choosing {{brand_name}}! {{survey_link}}";
    expect(renderTemplate(t, { customerName: "Kasun", surveyLink: "L", brandName: "iSeven Mobiles" })).toBe("Hi Kasun, thank you for choosing iSeven Mobiles! L");
    expect(renderTemplate(t, { customerName: "Kasun", surveyLink: "L" })).toBe("Hi Kasun, thank you for choosing iDealz Lanka! L");
  });
  test("{{branch_name}} is the showroom visited", () => {
    const t = "Hi {{customer_name}}, thanks for visiting {{branch_name}}! {{survey_link}}";
    expect(renderTemplate(t, { customerName: "Nimal Perera", surveyLink: "L", branchName: "iSeven Mobiles" })).toBe("Hi Nimal, thanks for visiting iSeven Mobiles! L");
    expect(renderTemplate(t, { customerName: "Nimal", surveyLink: "L" })).toBe("Hi Nimal, thanks for visiting our showroom! L");
  });
  test("mock provider reports which mask would be used", async () => {
    const r = await new MockSmsProvider().send({ to: "+94771234567", body: "x", reference: "1", senderId: "iSeven" });
    expect(r.ok && r.providerStatus).toContain("from iSeven");
  });
  test("segment counting", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ segments: 1, encoding: "GSM-7" });
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    expect(smsSegments("😊").encoding).toBe("UCS-2");
  });
  test("mock provider is flagged as test and can simulate failures", async () => {
    const p = new MockSmsProvider();
    expect(p.isTest).toBe(true);
    expect((await p.send({ to: "+94771234567", body: "x", reference: "1" })).ok).toBe(true);
    const fail = await p.send({ to: "+94770000000", body: "x", reference: "2" });
    expect(fail.ok).toBe(false);
  });
});

describe("feedback themes", () => {
  test("keyword themes", () => {
    expect(themesFor("Price was too expensive and the staff were rude")).toEqual(expect.arrayContaining(["price", "staff"]));
    const c = countThemes([
      { additional_feedback: "too expensive", nps_category: "detractor" },
      { additional_feedback: "great price", nps_category: "promoter" },
      { additional_feedback: null, nps_category: "detractor" },
    ]);
    expect(c[0]).toMatchObject({ key: "price", total: 2, detractors: 1, promoters: 1 });
  });
});
