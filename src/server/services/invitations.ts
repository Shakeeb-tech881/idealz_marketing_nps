import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { getSmsProvider } from "@/lib/messaging";
import { redactLink, renderTemplate } from "@/lib/messaging/template";
import { generateSurveyToken, hashSurveyToken, surveyUrl } from "@/lib/tokens";
import { getSettings } from "@/lib/settings";
import type { Profile } from "@/lib/types";
import type { SurveyType } from "@/lib/survey/definitions";

export interface DispatchOutcome {
  interactionId: string;
  customerName: string;
  status: "sent" | "failed" | "skipped";
  reason?: string;
  /**
   * TEST MODE ONLY (mock SMS provider): the survey link that would have been
   * texted, returned once to the sender so the survey can be tried end to end.
   * Never stored, never set when a real SMS provider is active.
   */
  testLink?: string;
}

export interface DispatchSummary {
  sent: number;
  failed: number;
  skipped: number;
  isTest: boolean;
  outcomes: DispatchOutcome[];
}

interface InteractionRow {
  id: string;
  purchase_status: "purchased" | "not_purchased";
  branch_id: string;
  branches: { name: string; sms_sender_id: string | null; brand_name: string | null } | null;
  customers: { id: string; full_name: string; mobile: string | null; sms_opt_out: boolean } | null;
  survey_invitations: { id: string; status: string; expires_at: string }[];
}

const MAX_BATCH = 200;

function surveyTypeFor(purchaseStatus: InteractionRow["purchase_status"]): SurveyType {
  return purchaseStatus === "purchased" ? "purchased" : "non_purchased";
}

async function templateBody(supabase: SupabaseClient, surveyType: SurveyType, templateId?: string | null) {
  let q = supabase.from("message_templates").select("id, body, survey_type").eq("is_active", true).eq("survey_type", surveyType);
  q = templateId ? q.eq("id", templateId) : q.eq("is_default", true);
  const { data } = await q.maybeSingle();
  if (!data) throw new Error(`No active ${surveyType === "purchased" ? "purchased" : "non-purchased"} SMS template found.`);
  return data.body as string;
}

export async function sentToday(supabase: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from("message_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .eq("is_test", false);
  return count ?? 0;
}

/**
 * Send one SMS for an invitation that already exists. Rotates the token on
 * every send so the only valid link is the one in the latest message
 * (raw tokens are never stored, so a previous link cannot be re-sent).
 */
async function sendForInvitation(
  supabase: SupabaseClient,
  actor: Profile,
  args: {
    invitationId: string;
    customerId: string;
    branchId: string;
    branchName: string | null;
    /** Customer-facing brand for {{brand_name}}. */
    brandName: string;
    /** The showroom's SMS mask; null = provider default mask. */
    senderId: string | null;
    mobile: string;
    customerName: string;
    body: string;
    expiryDays: number;
    previousSendCount: number;
  },
): Promise<{ ok: boolean; reason?: string; isTest: boolean; testLink?: string }> {
  const env = serverEnv();
  const provider = getSmsProvider();
  const token = generateSurveyToken();
  const link = surveyUrl(env.NEXT_PUBLIC_APP_URL, token);
  const message = renderTemplate(args.body, { customerName: args.customerName, surveyLink: link, branchName: args.branchName, brandName: args.brandName });
  const expiresAt = new Date(Date.now() + args.expiryDays * 24 * 3600 * 1000).toISOString();

  const { error: rotateError } = await supabase
    .from("survey_invitations")
    .update({ token_hash: hashSurveyToken(token), expires_at: expiresAt, status: "pending" })
    .eq("id", args.invitationId);
  if (rotateError) return { ok: false, reason: rotateError.message, isTest: provider.isTest };

  const { data: log, error: logError } = await supabase
    .from("message_logs")
    .insert({
      invitation_id: args.invitationId,
      customer_id: args.customerId,
      branch_id: args.branchId,
      provider: provider.name,
      is_test: provider.isTest,
      sender_id: args.senderId,
      recipient: args.mobile,
      body_redacted: redactLink(message, link),
      status: "queued",
      attempt: args.previousSendCount + 1,
      sent_by: actor.id,
    })
    .select("id")
    .single();
  if (logError || !log) return { ok: false, reason: logError?.message ?? "Could not create message log", isTest: provider.isTest };

  const result = await provider.send({ to: args.mobile, body: message, reference: log.id, senderId: args.senderId });
  const now = new Date().toISOString();
  if (result.ok) {
    await supabase
      .from("message_logs")
      .update({
        status: "sent",
        provider_message_id: result.providerMessageId,
        provider_status: result.providerStatus,
        provider_response: result.raw as object,
      })
      .eq("id", log.id);
    await supabase
      .from("survey_invitations")
      .update({ status: "sent", sent_at: now, last_error: null, send_count: args.previousSendCount + 1 })
      .eq("id", args.invitationId);
    // The mock provider never delivers anything, so hand the link back to the
    // signed-in sender instead. A real provider never gets here with a link.
    return { ok: true, isTest: provider.isTest, testLink: provider.isTest ? link : undefined };
  }
  await supabase
    .from("message_logs")
    .update({
      status: "failed",
      error_code: result.errorCode,
      error_message: result.errorMessage,
      provider_response: (result.raw ?? null) as object | null,
    })
    .eq("id", log.id);
  await supabase
    .from("survey_invitations")
    .update({
      status: "failed",
      failed_at: now,
      last_error: `${result.errorCode}: ${result.errorMessage}`.slice(0, 500),
      // Nothing reached the SMS provider (e.g. login blocked): don't use up one of the 5 sends.
      send_count: result.notAttempted ? args.previousSendCount : args.previousSendCount + 1,
    })
    .eq("id", args.invitationId);
  return { ok: false, reason: result.errorMessage, isTest: provider.isTest };
}

/**
 * Create invitations for interactions and send the survey SMS.
 * Duplicate-send protection: interactions that already have a live invitation
 * (anything except expired) are skipped — use resend/retry for those.
 */
export async function createAndSendInvitations(
  actor: Profile,
  input: { interactionIds: string[]; surveyType: SurveyType; templateId?: string | null },
): Promise<DispatchSummary> {
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const ids = [...new Set(input.interactionIds)].slice(0, MAX_BATCH);
  const provider = getSmsProvider();

  if (!provider.isTest) {
    const used = await sentToday(supabase);
    if (used + ids.length > settings.sms_daily_limit) {
      throw new Error(`Daily SMS limit of ${settings.sms_daily_limit} would be exceeded (${used} sent in the last 24 hours).`);
    }
  }

  const body = await templateBody(supabase, input.surveyType, input.templateId);
  const { data, error } = await supabase
    .from("customer_interactions")
    .select("id, purchase_status, branch_id, branches(name, sms_sender_id, brand_name), customers(id, full_name, mobile, sms_opt_out), survey_invitations(id, status, expires_at)")
    .in("id", ids);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as InteractionRow[];
  const outcomes: DispatchOutcome[] = [];

  for (const row of rows) {
    const c = row.customers;
    const name = c?.full_name ?? "Unknown";
    const skip = (reason: string) => outcomes.push({ interactionId: row.id, customerName: name, status: "skipped", reason });

    if (!c || !c.mobile) { skip("Customer has no mobile number"); continue; }
    if (c.sms_opt_out) { skip("Customer opted out of SMS"); continue; }
    if (surveyTypeFor(row.purchase_status) !== input.surveyType) { skip("Purchase status does not match the selected survey"); continue; }

    const live = row.survey_invitations.filter((i) => i.status !== "expired" && !(i.status !== "completed" && new Date(i.expires_at) <= new Date()));
    if (live.length > 0) { skip(`Already invited (${live[0].status})`); continue; }

    // Expire any past-due invitation still marked live so the unique index allows a new one.
    const stale = row.survey_invitations.filter((i) => i.status !== "expired" && i.status !== "completed" && new Date(i.expires_at) <= new Date());
    for (const s of stale) await supabase.from("survey_invitations").update({ status: "expired" }).eq("id", s.id);

    const placeholderToken = generateSurveyToken();
    const { data: inv, error: invError } = await supabase
      .from("survey_invitations")
      .insert({
        interaction_id: row.id,
        survey_type: input.surveyType,
        token_hash: hashSurveyToken(placeholderToken),
        expires_at: new Date(Date.now() + settings.survey_expiry_days * 86400000).toISOString(),
        status: "created",
        created_by: actor.id,
      })
      .select("id")
      .single();
    if (invError || !inv) {
      const dup = invError?.code === "23505";
      outcomes.push({ interactionId: row.id, customerName: name, status: dup ? "skipped" : "failed", reason: dup ? "Already invited" : invError?.message });
      continue;
    }

    const res = await sendForInvitation(supabase, actor, {
      invitationId: inv.id,
      customerId: c.id,
      branchId: row.branch_id,
      branchName: row.branches?.name ?? null,
      brandName: row.branches?.brand_name || settings.company_display_name,
      senderId: row.branches?.sms_sender_id ?? null,
      mobile: c.mobile,
      customerName: c.full_name,
      body,
      expiryDays: settings.survey_expiry_days,
      previousSendCount: 0,
    });
    outcomes.push({ interactionId: row.id, customerName: name, status: res.ok ? "sent" : "failed", reason: res.reason, testLink: res.testLink });
  }

  for (const id of ids) {
    if (!rows.some((r) => r.id === id)) outcomes.push({ interactionId: id, customerName: "—", status: "skipped", reason: "Not found or not accessible" });
  }

  await supabase.rpc("log_audit", {
    p_action: "sms.bulk_send",
    p_entity_type: "survey_invitations",
    p_entity_id: null,
    p_details: { survey_type: input.surveyType, requested: ids.length, sent: outcomes.filter((o) => o.status === "sent").length, provider: provider.name },
  });

  return {
    sent: outcomes.filter((o) => o.status === "sent").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    isTest: provider.isTest,
    outcomes,
  };
}

/** Re-send (or retry a failed send) for an existing, not-completed invitation. */
export async function resendInvitation(actor: Profile, invitationId: string, opts: { onlyIfFailed?: boolean } = {}) {
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const { data: inv, error } = await supabase
    .from("survey_invitations")
    .select("id, status, survey_type, send_count, branch_id, branches(name, sms_sender_id, brand_name), customers(id, full_name, mobile, sms_opt_out)")
    .eq("id", invitationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw new Error("Invitation not found.");
  if (inv.status === "completed") throw new Error("This customer has already completed the survey.");
  if (opts.onlyIfFailed && inv.status !== "failed") throw new Error("Only failed messages can be retried.");
  if (inv.send_count >= 5) throw new Error("This invitation has reached the maximum of 5 send attempts.");
  const c = inv.customers as unknown as InteractionRow["customers"];
  if (!c?.mobile) throw new Error("Customer has no mobile number.");
  if (c.sms_opt_out) throw new Error("Customer has opted out of SMS.");

  const body = await templateBody(supabase, inv.survey_type as SurveyType);
  const res = await sendForInvitation(supabase, actor, {
    invitationId: inv.id,
    customerId: c.id,
    branchId: inv.branch_id,
    branchName: (inv.branches as unknown as InteractionRow["branches"])?.name ?? null,
    brandName: (inv.branches as unknown as InteractionRow["branches"])?.brand_name || settings.company_display_name,
    senderId: (inv.branches as unknown as InteractionRow["branches"])?.sms_sender_id ?? null,
    mobile: c.mobile,
    customerName: c.full_name,
    body,
    expiryDays: settings.survey_expiry_days,
    previousSendCount: inv.send_count,
  });
  await supabase.rpc("log_audit", {
    p_action: opts.onlyIfFailed ? "sms.retry" : "sms.resend",
    p_entity_type: "survey_invitations",
    p_entity_id: inv.id,
    p_details: { ok: res.ok },
  });
  if (!res.ok) throw new Error(res.reason ?? "Message could not be sent.");
  return { isTest: res.isTest, testLink: res.testLink };
}
