/**
 * Normalise a phone number to E.164. Sri Lankan local formats are converted:
 *   0771234567, 771234567, 94771234567, +94 77 123 4567 → +94771234567
 * Returns null if the number cannot be interpreted.
 */
export function normaliseMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/[^\d+]/g, "");
  let d = digits.startsWith("+") ? digits.slice(1) : digits;
  if (d.startsWith("00")) d = d.slice(2);
  if (/^0\d{9}$/.test(d)) d = "94" + d.slice(1);
  else if (/^7\d{8}$/.test(d)) d = "94" + d;
  if (/^94\d{9}$/.test(d)) {
    // Sri Lankan mobile numbers start with 7 after the country code.
    return d[2] === "7" ? `+${d}` : null;
  }
  if (digits.startsWith("+") && /^[1-9]\d{7,14}$/.test(d)) return `+${d}`;
  return null;
}

export function maskMobile(mobile: string | null | undefined): string {
  if (!mobile) return "—";
  return mobile.length > 6 ? `${mobile.slice(0, 5)}•••${mobile.slice(-2)}` : "•••";
}

/** Display +94771234567 as 077 123 4567. */
export function formatMobile(mobile: string | null | undefined): string {
  if (!mobile) return "—";
  const m = /^\+94(\d{2})(\d{3})(\d{4})$/.exec(mobile);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : mobile;
}
