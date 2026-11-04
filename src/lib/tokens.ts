import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** 32 bytes of CSPRNG output, base64url — 43 characters, ~256 bits of entropy. */
export function generateSurveyToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the SHA-256 hash of a token is stored in the database. */
export function hashSurveyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function surveyUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/survey/${token}`;
}
