/** Columns the customer import understands, in display order. */
export const IMPORT_FIELDS = [
  { key: "full_name", label: "Customer name", required: true, aliases: ["name", "customer", "customer name", "full name"] },
  { key: "mobile", label: "Mobile number", required: true, aliases: ["mobile", "phone", "mobile number", "contact", "tel", "phone number"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "e-mail", "email address"] },
  { key: "branch", label: "Branch (code or name)", required: true, aliases: ["branch", "branch code", "branch name", "showroom", "outlet"] },
  { key: "employee", label: "Employee / salesperson (code or name)", required: false, aliases: ["employee", "salesperson", "sales person", "staff", "employee code", "sales rep"] },
  { key: "purchase_status", label: "Purchase status", required: true, aliases: ["purchase status", "purchased", "status", "bought"] },
  { key: "interaction_date", label: "Visit / contact date", required: false, aliases: ["date", "visit date", "interaction date", "contact date"] },
  { key: "purchase_date", label: "Purchase date", required: false, aliases: ["purchase date", "invoice date", "sale date"] },
  { key: "product_category", label: "Product category", required: false, aliases: ["category", "product category"] },
  { key: "product_model", label: "Product / model", required: false, aliases: ["product", "model", "product model", "item", "device"] },
  { key: "invoice_number", label: "Invoice number", required: false, aliases: ["invoice", "invoice number", "invoice no", "bill no", "receipt"] },
  { key: "source", label: "Customer source", required: false, aliases: ["source", "customer source", "channel", "lead source"] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type MappedRow = Partial<Record<ImportFieldKey, string>>;

export const MAX_IMPORT_ROWS = 2000;

/** Guess a column mapping from header names. */
export function guessMapping(headers: string[]): Partial<Record<ImportFieldKey, string>> {
  const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  const used = new Set<string>();
  const out: Partial<Record<ImportFieldKey, string>> = {};
  for (const f of IMPORT_FIELDS) {
    const candidates = [f.key.replace(/_/g, " "), ...f.aliases];
    const hit = headers.find((h) => !used.has(h) && candidates.includes(norm(h)));
    if (hit) {
      out[f.key] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** Interpret free-text purchase status values. */
export function parsePurchaseStatus(v: string | undefined): "purchased" | "not_purchased" | null {
  if (!v) return null;
  const s = v.trim().toLowerCase().replace(/[_-]/g, " ");
  if (["purchased", "yes", "y", "bought", "sold", "1", "true", "purchase"].includes(s)) return "purchased";
  if (["not purchased", "no", "n", "non purchased", "nonpurchased", "not bought", "0", "false", "enquiry", "inquiry", "visit"].includes(s)) return "not_purchased";
  return null;
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY. Returns ISO date or null. */
export function parseDate(v: string | undefined): string | null | "invalid" {
  if (!v || !v.trim()) return null;
  const s = v.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return "invalid";
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "invalid";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseSource(v: string | undefined): string {
  if (!v) return "walk_in";
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    walk_in: "walk_in", walkin: "walk_in", showroom: "walk_in", store: "walk_in",
    phone: "phone_call", phone_call: "phone_call", call: "phone_call", hotline: "phone_call",
    whatsapp: "whatsapp", website: "website", web: "website", online: "website",
    social_media: "social_media", facebook: "social_media", instagram: "social_media", tiktok: "social_media", social: "social_media",
    referral: "referral", friend: "referral",
  };
  return map[s] ?? "other";
}
