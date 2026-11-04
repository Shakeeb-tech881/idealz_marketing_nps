import { z } from "zod";
import { normaliseMobile } from "@/lib/phone";
import { CUSTOMER_SOURCES } from "@/lib/types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalString = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));

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
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address"),
});

const sourceValues = CUSTOMER_SOURCES.map((s) => s.value) as [string, ...string[]];

export const interactionSchema = z
  .object({
    branch_id: z.uuid("Select a branch"),
    employee_id: z.uuid().optional().or(z.literal("")).transform((v) => (v ? v : null)),
    purchase_status: z.enum(["purchased", "not_purchased"]),
    interaction_date: isoDate,
    purchase_date: isoDate.optional().or(z.literal("")).transform((v) => (v ? v : null)),
    product_category: optionalString(80),
    product_model: optionalString(160),
    invoice_number: optionalString(60),
    source: z.enum(sourceValues).default("walk_in"),
    notes: optionalString(1000),
  })
  .transform((v) =>
    v.purchase_status === "purchased"
      ? { ...v, purchase_date: v.purchase_date ?? v.interaction_date }
      : { ...v, purchase_date: null, invoice_number: null },
  );

export const newCustomerSchema = customerContactSchema.and(interactionSchema);

export type NewCustomerInput = z.input<typeof newCustomerSchema>;
export type NewCustomer = z.output<typeof newCustomerSchema>;
