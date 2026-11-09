export const REPORT_TYPES = [
  { value: "overall_nps", label: "Overall NPS Report", description: "NPS by segment and month with promoter / passive / detractor breakdown." },
  { value: "purchased_feedback", label: "Purchased Customer Feedback", description: "Every purchased-customer response with ratings and comments." },
  { value: "non_purchased_feedback", label: "Non-Purchased Customer Feedback", description: "Every non-purchased response including the reason for not purchasing." },
  { value: "branch_performance", label: "Branch Performance", description: "Invitations, response rate, NPS and staff rating for each branch." },
  { value: "employee_service", label: "Employee Service Quality", description: "Customer feedback linked to each employee, with sample-size flags." },
  { value: "rep_scorecard", label: "Sales Rep Scorecard", description: "A+ to Fail grade per salesperson with every KPI, sales counts and Low activity flags." },
  { value: "detractors", label: "Detractor Report", description: "All detractor responses (score 0–6) with follow-up status." },
  { value: "monthly_cx", label: "Monthly Customer Experience", description: "Month-by-month NPS, responses and response rate." },
  { value: "non_purchase_reasons", label: "Reasons for Not Purchasing", description: "Frequency of each reason customers gave for not purchasing." },
  { value: "invitation_delivery", label: "Survey Invitation & Delivery", description: "Each invitation with its sending, delivery and completion status." },
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]["value"];
export type ReportFormat = "csv" | "xlsx" | "pdf";

export interface ReportColumn {
  key: string;
  label: string;
  width?: number;
}

export interface ReportData {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  notes?: string[];
  /** Per-row emphasis, same order as `rows`: "danger" prints the row in red (PDF / Excel). */
  rowTone?: ("danger" | null)[];
}
