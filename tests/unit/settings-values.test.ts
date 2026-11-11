import { describe, expect, test } from "vitest";
import { settingFromStorage, settingsRows } from "@/lib/settings-values";

describe("saving settings", () => {
  test("empty optional settings are never sent as null (the column is NOT NULL)", () => {
    const rows = settingsRows({ survey_expiry_days: 2, company_logo_url: null, support_phone: null, company_name: "iDealz Lanka (Pvt) Ltd" }, "u1");
    expect(rows.every((r) => r.value !== null && r.value !== undefined)).toBe(true);
    expect(rows.find((r) => r.key === "survey_expiry_days")).toEqual({ key: "survey_expiry_days", value: 2, updated_by: "u1" });
    expect(rows.find((r) => r.key === "support_phone")?.value).toBe("");
  });

  test("an empty stored value reads back as not set", () => {
    expect(settingFromStorage("")).toBeNull();
    expect(settingFromStorage("https://x.lk/logo.svg")).toBe("https://x.lk/logo.svg");
    expect(settingFromStorage(14)).toBe(14);
  });
});
