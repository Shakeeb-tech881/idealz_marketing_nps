import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSurveyToken, isWellFormedToken } from "@/lib/tokens";
import { nonPurchasedAnswersSchema, purchasedAnswersSchema } from "@/lib/survey/schema";
import type { SurveyType } from "@/lib/survey/definitions";

/** Showroom branding for the survey page: branch code + public brand name only. */
export type SurveyBrand = { code: string; brandName: string | null } | null;

export type SurveyState =
  | { state: "open"; surveyType: SurveyType; brand: SurveyBrand }
  | { state: "completed" | "expired"; brand: SurveyBrand }
  | { state: "invalid" | "rate_limited" | "unavailable" };

async function brandForToken(tokenHash: string): Promise<SurveyBrand> {
  try {
    const { data } = await createAdminClient()
      .from("survey_invitations")
      .select("branches(code, brand_name)")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    const b = (data?.branches ?? null) as unknown as { code: string; brand_name: string | null } | null;
    return b ? { code: b.code, brandName: b.brand_name } : null;
  } catch {
    return null; // branding is cosmetic — fall back to the company brand
  }
}

const OPEN_LIMIT = { limit: 60, windowSeconds: 600 };
const SUBMIT_LIMIT_IP = { limit: 20, windowSeconds: 600 };
const SUBMIT_LIMIT_TOKEN = { limit: 10, windowSeconds: 600 };

async function allowed(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (e) {
    console.error("[rate-limit] check failed", e instanceof Error ? e.message : e);
    return true; // fail open for customers; abuse is still bounded by 256-bit token entropy
  }
}

/** Validate a token from the public URL. Never returns customer data. */
export async function loadSurvey(token: string, clientIp: string): Promise<SurveyState> {
  if (!isWellFormedToken(token)) return { state: "invalid" };
  if (!(await allowed(`open:${clientIp}`, OPEN_LIMIT.limit, OPEN_LIMIT.windowSeconds))) {
    return { state: "rate_limited" };
  }
  try {
    const admin = createAdminClient();
    const tokenHash = hashSurveyToken(token);
    const { data, error } = await admin.rpc("open_survey_invitation", { p_token_hash: tokenHash });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { survey_type: SurveyType | null; state: string } | null;
    if (!row) return { state: "invalid" };
    if (row.state === "open" && row.survey_type) return { state: "open", surveyType: row.survey_type, brand: await brandForToken(tokenHash) };
    if (row.state === "completed" || row.state === "expired") return { state: row.state, brand: await brandForToken(tokenHash) };
    return { state: "invalid" };
  } catch (e) {
    console.error("[survey] load failed", e instanceof Error ? e.message : e);
    return { state: "unavailable" };
  }
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "expired" | "already_submitted" | "invalid_answers" | "rate_limited" | "unavailable"; fieldErrors?: Record<string, string[]> };

export async function submitSurvey(token: string, rawAnswers: unknown, clientIp: string): Promise<SubmitResult> {
  if (!isWellFormedToken(token)) return { ok: false, error: "invalid" };
  if (
    !(await allowed(`submit-ip:${clientIp}`, SUBMIT_LIMIT_IP.limit, SUBMIT_LIMIT_IP.windowSeconds)) ||
    !(await allowed(`submit-token:${hashSurveyToken(token)}`, SUBMIT_LIMIT_TOKEN.limit, SUBMIT_LIMIT_TOKEN.windowSeconds))
  ) {
    return { ok: false, error: "rate_limited" };
  }

  const tokenHash = hashSurveyToken(token);
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[survey] not configured", e instanceof Error ? e.message : e);
    return { ok: false, error: "unavailable" };
  }

  // Determine the survey type from the invitation — never from the client.
  const { data: inv, error: invError } = await admin
    .from("survey_invitations")
    .select("survey_type")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (invError) {
    console.error("[survey] lookup failed", invError.message);
    return { ok: false, error: "unavailable" };
  }
  if (!inv) return { ok: false, error: "invalid" };

  const schema = inv.survey_type === "purchased" ? purchasedAnswersSchema : nonPurchasedAnswersSchema;
  const parsed = schema.safeParse(rawAnswers);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "form");
      (fieldErrors[k] ??= []).push(issue.message);
    }
    return { ok: false, error: "invalid_answers", fieldErrors };
  }

  const { data, error } = await admin.rpc("submit_survey_response", {
    p_token_hash: tokenHash,
    p_answers: parsed.data,
  });
  if (error) {
    console.error("[survey] submit failed", error.message);
    return { ok: false, error: "unavailable" };
  }
  const result = data as { ok: boolean; error?: string };
  if (result.ok) return { ok: true };
  const known = ["invalid", "expired", "already_submitted", "invalid_answers"] as const;
  const err = known.find((k) => k === result.error) ?? "unavailable";
  return { ok: false, error: err };
}
