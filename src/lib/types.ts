import type { SurveyType } from "@/lib/survey/definitions";

export type AppRole = "super_admin" | "management" | "branch_manager" | "staff";
export type PurchaseStatus = "purchased" | "not_purchased";
export type InvitationStatus = "created" | "pending" | "sent" | "delivered" | "failed" | "opened" | "completed" | "expired";
export type ResolutionStatus = "new" | "under_review" | "contact_required" | "resolved" | "closed";
export type MessageStatus = "queued" | "sent" | "delivered" | "failed";
export type { SurveyType };

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  branch_id: string | null;
  employee_id: string | null;
  is_active: boolean;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  /** Approved SMS mask for this showroom; null = default mask. */
  sms_sender_id: string | null;
  /** Brand customers of this showroom see (SMS, survey); null = company name. */
  brand_name: string | null;
  is_active: boolean;
}

export interface Employee {
  id: string;
  branch_id: string;
  full_name: string;
  employee_code: string | null;
  job_title: string | null;
  is_active: boolean;
  /** rep = graded personally · branch_manager = graded on the branch · not_scored = management, no grade */
  scorecard_role: ScorecardRole;
}

export type ScorecardRole = "rep" | "branch_manager" | "not_scored";
export const SCORECARD_ROLES: { value: ScorecardRole; label: string; hint: string }[] = [
  { value: "rep", label: "Sales rep", hint: "Graded on the Sales Rep Scorecard" },
  { value: "branch_manager", label: "Branch manager", hint: "Graded on the whole branch’s result" },
  { value: "not_scored", label: "Management – not graded", hint: "No grade; visits still count for the branch" },
];

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  management: "Management",
  branch_manager: "Branch Manager",
  staff: "Staff",
};

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  purchased: "Purchased",
  not_purchased: "Not purchased",
};

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  created: "Created",
  pending: "Pending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  opened: "Opened",
  completed: "Completed",
  expired: "Expired",
};

export const RESOLUTION_LABELS: Record<ResolutionStatus, string> = {
  new: "New",
  under_review: "Under Review",
  contact_required: "Contact Required",
  resolved: "Resolved",
  closed: "Closed",
};

export const CUSTOMER_SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "phone_call", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "website", label: "Website" },
  { value: "social_media", label: "Social media" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" },
] as const;
export type CustomerSource = (typeof CUSTOMER_SOURCES)[number]["value"];
export const SOURCE_LABELS = Object.fromEntries(CUSTOMER_SOURCES.map((s) => [s.value, s.label])) as Record<CustomerSource, string>;

export const PRODUCT_CATEGORIES = [
  "Smartphones",
  "Tablets",
  "Laptops",
  "Smart Watches",
  "Audio",
  "Accessories",
  "Gaming",
  "Smart Home",
  "Repairs & Services",
  "Other",
] as const;

/** Sales steps a rep can tick for each visit (rep scorecard). Order = display order. */
export const SALES_STEPS = [
  { value: "greeted", label: "Greeted the customer" },
  { value: "needs_identified", label: "Asked about needs & budget" },
  { value: "demo_given", label: "Gave a product demo" },
  { value: "trade_in_offered", label: "Offered trade-in / exchange" },
  { value: "accessories_offered", label: "Offered accessories" },
  { value: "warranty_explained", label: "Explained warranty / care plan" },
  { value: "payment_options_explained", label: "Explained payment / instalment options" },
  { value: "follow_up_arranged", label: "Arranged a follow-up" },
] as const;
export type SalesStep = (typeof SALES_STEPS)[number]["value"];

export const GOOGLE_REVIEW_OPTIONS = [
  { value: "not_asked", label: "Not asked" },
  { value: "asked", label: "Asked for a review" },
  // Set by a manager after checking Google (Google Reviews page) – never by the sales rep.
  { value: "confirmed", label: "Review found on Google (manager)" },
  { value: "not_found", label: "No review found on Google (manager)" },
] as const;
/** What a sales rep may record themselves. */
export const REP_REVIEW_VALUES = ["not_asked", "asked"] as const;
export type GoogleReviewStatus = (typeof GOOGLE_REVIEW_OPTIONS)[number]["value"];

/** Standard result shape for server actions. */
export type ActionResult<T = undefined> =
  | ({ ok: true; message?: string } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };
