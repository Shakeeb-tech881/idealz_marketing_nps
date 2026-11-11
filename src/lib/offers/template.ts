import { firstName, smsSegments } from "@/lib/messaging/template";

/** Variables an offer SMS may use. {{optout_link}} is required in every offer. */
export const OFFER_VARIABLES = ["{{customer_name}}", "{{last_model}}", "{{branch_name}}", "{{brand_name}}", "{{optout_link}}"] as const;

/** Problems with an offer text, empty when it can be sent. */
export function offerBodyProblems(body: string): string[] {
  const p: string[] = [];
  const text = body.trim();
  if (!text) p.push("Write the message.");
  if (text.length > 1000) p.push("At most 1000 characters.");
  if (!text.includes("{{optout_link}}")) p.push("The message must include {{optout_link}} so customers can stop offers with one tap.");
  const unknown = [...new Set(text.match(/\{\{[^}]*\}\}/g) ?? [])].filter((v) => !(OFFER_VARIABLES as readonly string[]).includes(v));
  if (unknown.length) p.push(`Unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Use ${OFFER_VARIABLES.join(", ")}.`);
  return p;
}

export interface OfferVars {
  customerName: string;
  lastModel?: string | null;
  branchName?: string | null;
  brandName?: string | null;
  optoutLink: string;
}

export function renderOffer(body: string, v: OfferVars): string {
  return body
    .trim()
    .replaceAll("{{customer_name}}", firstName(v.customerName))
    .replaceAll("{{last_model}}", v.lastModel?.trim() || "your phone")
    .replaceAll("{{branch_name}}", v.branchName?.trim() || "our showroom")
    .replaceAll("{{brand_name}}", v.brandName?.trim() || "iDealz Lanka")
    .replaceAll("{{optout_link}}", v.optoutLink);
}

/** The opt-out token is a secret: never write it to logs. */
export function redactOptoutLink(message: string, optoutLink: string): string {
  return message.replaceAll(optoutLink, "[stop-offers-link]");
}

export function offerOptoutUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/u/${token}`;
}

/** Worst-case size: the longest name / model / showroom in the audience with a full-length opt-out link. */
export function worstCaseSegments(body: string, sample: { names: string[]; models: string[]; branches: string[]; brands: string[] }, appUrl: string) {
  const longest = (xs: string[], fallback: string) => xs.reduce((a, b) => (b.length > a.length ? b : a), fallback);
  const text = renderOffer(body, {
    customerName: longest(sample.names.map(firstName), "Customer"),
    lastModel: longest(sample.models, "your phone"),
    branchName: longest(sample.branches, "our showroom"),
    brandName: longest(sample.brands, "iDealz Lanka"),
    optoutLink: offerOptoutUrl(appUrl, "x".repeat(22)),
  });
  return { text, ...smsSegments(text) };
}
