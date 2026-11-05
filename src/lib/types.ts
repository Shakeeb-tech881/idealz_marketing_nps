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
}

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

/** Standard result shape for server actions. */
export type ActionResult<T = undefined> =
  | ({ ok: true; message?: string } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };
