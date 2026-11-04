import { z } from "zod";
import { MAX_FEEDBACK_LENGTH, MAX_OTHER_REASON_LENGTH, NON_PURCHASE_REASONS } from "./definitions";

const rating = z.number().int().min(1).max(5);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const purchasedAnswersSchema = z.object({
  nps_score: z.number().int().min(0).max(10),
  product_satisfaction: rating,
  staff_service_rating: rating,
  overall_experience_rating: rating,
  additional_feedback: optionalText(MAX_FEEDBACK_LENGTH),
});

const reasonValues = NON_PURCHASE_REASONS.map((r) => r.value) as [string, ...string[]];

export const nonPurchasedAnswersSchema = z
  .object({
    nps_score: z.number().int().min(0).max(10),
    non_purchase_reason: z.enum(reasonValues),
    other_reason_description: optionalText(MAX_OTHER_REASON_LENGTH),
    staff_service_rating: rating,
    product_pricing_satisfaction: rating,
    additional_feedback: optionalText(MAX_FEEDBACK_LENGTH),
  })
  .superRefine((v, ctx) => {
    if (v.non_purchase_reason === "other" && !v.other_reason_description) {
      ctx.addIssue({ code: "custom", path: ["other_reason_description"], message: "Please tell us the reason" });
    }
  })
  .transform((v) => ({
    ...v,
    other_reason_description: v.non_purchase_reason === "other" ? v.other_reason_description : undefined,
  }));

export type PurchasedAnswers = z.infer<typeof purchasedAnswersSchema>;
export type NonPurchasedAnswers = z.infer<typeof nonPurchasedAnswersSchema>;
