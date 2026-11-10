import { describe, expect, test } from "vitest";
import { parseAuthFragment, parseOtpType, safeNext } from "@/lib/auth-links";

describe("email sign-in links", () => {
  test("invites and password resets always go to set-password", () => {
    expect(safeNext("/admin", "invite")).toBe("/auth/set-password");
    expect(safeNext(null, "recovery")).toBe("/auth/set-password");
  });

  test("only same-site admin paths are allowed as the next page", () => {
    expect(safeNext("/admin/customers")).toBe("/admin/customers");
    expect(safeNext("/auth/set-password")).toBe("/auth/set-password");
    expect(safeNext("//evil.example")).toBe("/admin");
    expect(safeNext("https://evil.example/admin")).toBe("/admin");
    expect(safeNext("/administrator-phish")).toBe("/admin");
    expect(safeNext(null)).toBe("/admin");
  });

  test("only known Supabase link types are accepted", () => {
    expect(parseOtpType("invite")).toBe("invite");
    expect(parseOtpType("recovery")).toBe("recovery");
    expect(parseOtpType("admin")).toBeNull();
    expect(parseOtpType(null)).toBeNull();
  });

  test("reads the default invite link fragment and Supabase's expired-link error", () => {
    expect(parseAuthFragment("#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=invite")).toEqual({
      accessToken: "a.b.c", refreshToken: "r1", type: "invite", errorCode: null,
    });
    expect(parseAuthFragment("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired").errorCode).toBe("otp_expired");
    expect(parseAuthFragment("")).toEqual({ accessToken: null, refreshToken: null, type: null, errorCode: null });
  });
});
