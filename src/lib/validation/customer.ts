import { z } from "zod";
import { normaliseMobile } from "@/lib/phone";
import { CUSTOMER_SOURCES, GOOGLE_REVIEW_OPTIONS, SALES_STEPS } from "@/lib/types";

// The browser form validates with these schemas and sends the *parsed* values
// (blank fields already turned into null) to the server, which validates again.
// So every optional field must accept null as well as "" — otherwise a blank
// optional field (invoice, notes, email…) is rejected on the second check.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const blank = z.union([z.literal(""), z.null()]);
const optionalString = (max: number) =>
  z.union([blank, z.string().trim().max(max)]).optional().transform((v) => (v ? v : null));

export const customerContactSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(200),
  mobile: z
    .string()
    .trim()
    .min(1, "Mobile number is required")
    .transform((v, ctx) => {
      const n = normaliseMobile(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "Enter a valid mobile number, e.g. 077 123 4567" });
        return z.NEVER;
      }
      return n;
    }),
  email: z
    .union([blank, z.string().trim().max(200)]).optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address"),
});

const sourceValues = CUSTOMER_SOURCES.map((s) => s.value) as [string, ...string[]];
const stepValues = SALES_STEPS.map((s) => s.value) as [string, ...string[]];
const reviewValues = GOOGLE_REVIEW_OPTIONS.map((s) => s.value) as [string, ...string[]];

/** A whole-number count from a form field: blank means 0. */
const count = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) ? 0 : Number(v)),
    z.number({ error: "Enter a number" }).int("Whole numbers only").min(0, "Cannot be negative").max(max, `At most ${max}`),
  );
const clockTime = z
  .union([blank, z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM")]).optional()
  .transform((v) => (v ? v.slice(0, 5) : null));
/** Checkbox groups arrive as an array, a single string, or false when none is ticked. */
const steps = z.preprocess(
  (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []),
  z.array(z.enum(stepValues)).max(stepValues.length),
);

export const interactionSchema = z
  .object({
    branch_id: z.uuid("Select a branch"),
    employee_id: z.union([blank, z.uuid()]).optional().transform((v) => (v ? v : null)),
    purchase_status: z.enum(["purchased", "not_purchased"]),
    interaction_date: isoDate,
    purchase_date: z.union([blank, isoDate]).optional().transform((v) => (v ? v : null)),
    product_category: optionalString(80),
    product_model: optionalString(160),
    invoice_number: optionalString(60),
    source: z.enum(sourceValues).default("walk_in"),
    notes: optionalString(1000),
    // Rep scorecard
    android_phones: count(50).default(0),
    apple_phones: count(50).default(0),
    other_devices: count(50).default(0),
    commission_accessories: count(200).default(0),
    non_commission_accessories: count(200).default(0),
    visit_start: clockTime,
    visit_end: clockTime,
    sales_steps: steps.default([]),
    google_review: z.enum(reviewValues).default("not_asked"),
  })
  .superRefine((v, ctx) => {
    if (v.visit_start && v.visit_end && v.visit_end <= v.visit_start) {
      ctx.addIssue({ code: "custom", path: ["visit_end"], message: "End time must be after the start time" });
    }
  })
  .transform((v) => {
    const sales_steps = [...new Set(v.sales_steps)];
    return v.purchase_status === "purchased"
      ? { ...v, sales_steps, purchase_date: v.purchase_date ?? v.interaction_date }
      : {
          ...v,
          sales_steps,
          purchase_date: null,
          invoice_number: null,
          android_phones: 0,
          apple_phones: 0,
          other_devices: 0,
          commission_accessories: 0,
          non_commission_accessories: 0,
        };
  });

export const newCustomerSchema = customerContactSchema.and(interactionSchema);

export type NewCustomerInput = z.input<typeof newCustomerSchema>;
export type NewCustomer = z.output<typeof newCustomerSchema>;
