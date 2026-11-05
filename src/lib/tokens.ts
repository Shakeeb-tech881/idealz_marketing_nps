import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * 16 bytes of CSPRNG output, base64url — 22 characters, 128 bits of entropy.
 * That is far beyond guessable (links also expire, are single-use and
 * rate-limited) while keeping the SMS short enough for a single message.
 */
export function generateSurveyToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Only the SHA-256 hash of a token is stored in the database. */
export function hashSurveyToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 22 chars (current) or 43 chars (links sent before the short-link change). */
export function isWellFormedToken(token: string): boolean {
  return /^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/.test(token);
}

/** Short public link, e.g. https://cx.idealz.lk/s/Ab3dE…  (rewritten to /survey/…). */
export function surveyUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/s/${token}`;
}
