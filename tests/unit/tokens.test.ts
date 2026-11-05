import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { generateSurveyToken, hashSurveyToken, isWellFormedToken, surveyUrl } = await import("@/lib/tokens");

describe("survey tokens & short links", () => {
  test("tokens are 22 url-safe characters and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const t = generateSurveyToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isWellFormedToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(2000);
  });
  test("old 43-character links still validate; junk does not", () => {
    expect(isWellFormedToken("a".repeat(43))).toBe(true);
    expect(isWellFormedToken("a".repeat(21))).toBe(false);
    expect(isWellFormedToken("a".repeat(30))).toBe(false);
    expect(isWellFormedToken("a".repeat(21) + "/")).toBe(false);
  });
  test("short link format and hashing", () => {
    expect(surveyUrl("https://cx.idealz.lk/", "Ab3dEfGh1jKlMn0pQrStUv")).toBe("https://cx.idealz.lk/s/Ab3dEfGh1jKlMn0pQrStUv");
    expect(hashSurveyToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
