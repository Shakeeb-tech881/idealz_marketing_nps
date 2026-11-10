import { randomInt } from "node:crypto";

// No look-alike characters (0/O, 1/l/I) so it can be read out or typed from WhatsApp.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * One-time password a Super Admin hands to a new user, e.g. "Kx7m-Qp4t-Wz9h".
 * 12 random characters (~70 bits) plus dashes; always has upper, lower and a digit.
 * The user must replace it on first sign-in.
 */
export function generateTemporaryPassword(): string {
  for (;;) {
    const pw = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}
