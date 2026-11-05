export const TEMPLATE_VARIABLES = ["{{customer_name}}", "{{survey_link}}", "{{branch_name}}", "{{brand_name}}"] as const;

/** First name only, to keep messages short and personal. */
export function firstName(fullName: string): string {
  const n = fullName.trim().split(/\s+/)[0] ?? "";
  return n || "Customer";
}

/**
 * {{branch_name}} = the showroom visited (e.g. "iDealz Marino");
 * {{brand_name}}  = that showroom's customer-facing brand (e.g. "iSeven Mobiles", else "iDealz Lanka").
 */
export function renderTemplate(
  body: string,
  vars: { customerName: string; surveyLink: string; branchName?: string | null; brandName?: string | null },
): string {
  return body
    .replaceAll("{{customer_name}}", firstName(vars.customerName))
    .replaceAll("{{branch_name}}", vars.branchName?.trim() || "our showroom")
    .replaceAll("{{brand_name}}", vars.brandName?.trim() || "iDealz Lanka")
    .replaceAll("{{survey_link}}", vars.surveyLink);
}

/** Replace the survey link so raw tokens are never written to logs. */
export function redactLink(message: string, surveyLink: string): string {
  return message.replaceAll(surveyLink, "[survey-link]");
}

/** GSM-7 messages: 160 chars single / 153 per segment; UCS-2: 70 / 67. */
export function smsSegments(message: string): { characters: number; segments: number; encoding: "GSM-7" | "UCS-2" } {
  const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[\]~|]*$/.test(message);
  const len = [...message].length;
  if (gsm) return { characters: len, segments: len <= 160 ? 1 : Math.ceil(len / 153), encoding: "GSM-7" };
  return { characters: len, segments: len <= 70 ? 1 : Math.ceil(len / 67), encoding: "UCS-2" };
}
