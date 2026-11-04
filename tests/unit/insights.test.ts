import { describe, expect, test } from "vitest";
import { buildInsights } from "@/lib/analytics/insights";
import { computeNps } from "@/lib/nps";

const empty = computeNps({ promoters: 0, passives: 0, detractors: 0 });

describe("insights", () => {
  test("never guesses without data", () => {
    const out = buildInsights({ overall: empty, promoterThemes: [], detractorThemes: [], allThemes: [], commentsAnalysed: 0, reasons: [], branches: [], minBranchSample: 20, drivers: [], monthly: [] });
    expect(out.every((i) => i.tone === "neutral")).toBe(true);
  });
  test("does not compare branches below the sample threshold", () => {
    const out = buildInsights({
      overall: empty, promoterThemes: [], detractorThemes: [], allThemes: [], commentsAnalysed: 0, reasons: [], minBranchSample: 20, drivers: [], monthly: [],
      branches: [{ name: "Tiny", nps: computeNps({ promoters: 5, passives: 0, detractors: 0 }) }, { name: "Big", nps: computeNps({ promoters: 15, passives: 10, detractors: 5 }) }],
    });
    const b = out.find((i) => i.question.startsWith("Which branches"))!;
    expect(b.answer).toContain("Big");
    expect(b.answer).not.toContain("Tiny");
  });
});
