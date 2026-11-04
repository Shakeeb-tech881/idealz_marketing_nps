import { describe, expect, test } from "vitest";
import { classifyNps, computeNps, formatNps, npsFromTotals, pct, round1 } from "@/lib/nps";

describe("classifyNps", () => {
  test.each([
    [0, "detractor"], [6, "detractor"], [7, "passive"], [8, "passive"], [9, "promoter"], [10, "promoter"],
  ] as const)("%i → %s", (score, cat) => expect(classifyNps(score)).toBe(cat));
  test("rejects out-of-range and non-integers", () => {
    expect(() => classifyNps(11)).toThrow();
    expect(() => classifyNps(-1)).toThrow();
    expect(() => classifyNps(7.5)).toThrow();
  });
});

describe("computeNps", () => {
  test("spec example: 60 promoters, 25 passives, 15 detractors → +45", () => {
    const r = computeNps({ promoters: 60, passives: 25, detractors: 15 });
    expect(r).toMatchObject({ total: 100, nps: 45, promoterPct: 60, passivePct: 25, detractorPct: 15 });
  });
  test("no responses is null (N/A), not zero", () => {
    const r = computeNps({ promoters: 0, passives: 0, detractors: 0 });
    expect(r.nps).toBeNull();
    expect(formatNps(r.nps)).toBe("N/A");
  });
  test("zero NPS is a real value distinct from no data", () => {
    const r = computeNps({ promoters: 2, passives: 1, detractors: 2 });
    expect(r.nps).toBe(0);
    expect(formatNps(r.nps)).toBe("0");
  });
  test("passives only affect the denominator", () => {
    expect(computeNps({ promoters: 1, passives: 0, detractors: 0 }).nps).toBe(100);
    expect(computeNps({ promoters: 1, passives: 1, detractors: 0 }).nps).toBe(50);
  });
  test("bounds and rounding", () => {
    expect(computeNps({ promoters: 0, passives: 0, detractors: 7 }).nps).toBe(-100);
    expect(computeNps({ promoters: 1, passives: 1, detractors: 1 }).nps).toBe(0);
    expect(computeNps({ promoters: 2, passives: 0, detractors: 1 }).nps).toBe(33.3);
    expect(computeNps({ promoters: 1, passives: 0, detractors: 2 }).nps).toBe(-33.3);
    expect(round1(-0.05)).toBe(-0.1);
    expect(round1(0.05)).toBe(0.1);
  });
  test("npsFromTotals derives passives", () => {
    expect(npsFromTotals(10, 5, 2)).toMatchObject({ passives: 3, nps: 30 });
  });
  test("formatNps adds sign", () => {
    expect(formatNps(45)).toBe("+45");
    expect(formatNps(-12.5)).toBe("-12.5");
  });
  test("pct handles zero denominators", () => {
    expect(pct(3, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33.3);
  });
});
