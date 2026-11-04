/**
 * Questionnaire definitions. Purchased and non-purchased surveys are kept
 * strictly separate; the invitation record decides which one is rendered.
 */
export type SurveyType = "purchased" | "non_purchased";

export type QuestionKind = "nps" | "emoji" | "stars" | "single_select" | "text";

export type AnswerKey =
  | "nps_score"
  | "product_satisfaction"
  | "staff_service_rating"
  | "overall_experience_rating"
  | "product_pricing_satisfaction"
  | "non_purchase_reason"
  | "additional_feedback";

export interface ScaleOption {
  value: number;
  emoji?: string;
  label: string;
}

export interface QuestionDef {
  key: AnswerKey;
  kind: QuestionKind;
  required: boolean;
  text: string;
  options?: ScaleOption[];
  placeholder?: string;
}

export const SATISFACTION_SCALE: ScaleOption[] = [
  { value: 1, emoji: "😡", label: "Very Dissatisfied" },
  { value: 2, emoji: "🙁", label: "Dissatisfied" },
  { value: 3, emoji: "😐", label: "Neutral" },
  { value: 4, emoji: "😊", label: "Satisfied" },
  { value: 5, emoji: "😍", label: "Very Satisfied" },
];

export const EXPERIENCE_SCALE: ScaleOption[] = [
  { value: 1, emoji: "😡", label: "Very Poor" },
  { value: 2, emoji: "🙁", label: "Poor" },
  { value: 3, emoji: "😐", label: "Average" },
  { value: 4, emoji: "😊", label: "Good" },
  { value: 5, emoji: "😍", label: "Excellent" },
];

export const STAR_SCALE: ScaleOption[] = [
  { value: 1, label: "Very Poor" },
  { value: 2, label: "Poor" },
  { value: 3, label: "Average" },
  { value: 4, label: "Good" },
  { value: 5, label: "Excellent" },
];

export const NON_PURCHASE_REASONS = [
  { value: "price_too_high", label: "Product price was too high" },
  { value: "product_unavailable", label: "Product was unavailable" },
  { value: "other_brands_models", label: "Looking for other brands or models" },
  { value: "better_offer_elsewhere", label: "Found a better offer elsewhere" },
  { value: "still_comparing", label: "Still comparing products" },
  { value: "not_ready", label: "Not ready to purchase" },
  { value: "payment_financing", label: "Payment or financing issues" },
  { value: "customer_service", label: "Customer service experience" },
  { value: "other", label: "Other" },
] as const;

export type NonPurchaseReason = (typeof NON_PURCHASE_REASONS)[number]["value"];

export const NON_PURCHASE_REASON_LABELS: Record<NonPurchaseReason, string> = Object.fromEntries(
  NON_PURCHASE_REASONS.map((r) => [r.value, r.label]),
) as Record<NonPurchaseReason, string>;

export const SURVEYS: Record<SurveyType, QuestionDef[]> = {
  purchased: [
    {
      key: "nps_score",
      kind: "nps",
      required: true,
      text: "How likely are you to recommend iDealz Lanka to your friends or family based on your purchasing experience?",
    },
    {
      key: "product_satisfaction",
      kind: "emoji",
      required: true,
      text: "How satisfied are you with the product you purchased from iDealz Lanka?",
      options: SATISFACTION_SCALE,
    },
    {
      key: "staff_service_rating",
      kind: "stars",
      required: true,
      text: "How would you rate the service and assistance provided by our staff?",
      options: STAR_SCALE,
    },
    {
      key: "overall_experience_rating",
      kind: "emoji",
      required: true,
      text: "How would you rate your overall purchasing experience at iDealz Lanka?",
      options: EXPERIENCE_SCALE,
    },
    {
      key: "additional_feedback",
      kind: "text",
      required: false,
      text: "Is there anything we could improve to make your experience better?",
      placeholder: "Compliments, suggestions, complaints, product or service feedback…",
    },
  ],
  non_purchased: [
    {
      key: "nps_score",
      kind: "nps",
      required: true,
      text: "Based on your interaction with iDealz Lanka, how likely are you to recommend us to your friends or family?",
    },
    {
      key: "non_purchase_reason",
      kind: "single_select",
      required: true,
      text: "What was the main reason you decided not to purchase from iDealz Lanka?",
    },
    {
      key: "staff_service_rating",
      kind: "stars",
      required: true,
      text: "How would you rate the assistance and service provided by our staff?",
      options: STAR_SCALE,
    },
    {
      key: "product_pricing_satisfaction",
      kind: "emoji",
      required: true,
      text: "How satisfied were you with our product availability, pricing and available offers?",
      options: SATISFACTION_SCALE,
    },
    {
      key: "additional_feedback",
      kind: "text",
      required: false,
      text: "What could iDealz Lanka do to improve your experience and encourage you to purchase from us in the future?",
      placeholder: "Tell us what would help you choose iDealz Lanka next time…",
    },
  ],
};

export const SURVEY_TYPE_LABELS: Record<SurveyType, string> = {
  purchased: "Purchased",
  non_purchased: "Non-purchased",
};

export const MAX_FEEDBACK_LENGTH = 2000;
export const MAX_OTHER_REASON_LENGTH = 500;
