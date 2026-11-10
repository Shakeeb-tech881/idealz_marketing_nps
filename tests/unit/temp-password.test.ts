import { describe, expect, test } from "vitest";
import { generateTemporaryPassword } from "@/lib/temp-password";

describe("temporary passwords", () => {
  test("format: three groups of four, easy to read, meets the 10-character rule", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(pw).not.toMatch(/[0O1lI]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/\d/);
      expect(pw.length).toBeGreaterThanOrEqual(10);
    }
  });

  test("random every time", () => {
    const set = new Set(Array.from({ length: 500 }, generateTemporaryPassword));
    expect(set.size).toBe(500);
  });
});
