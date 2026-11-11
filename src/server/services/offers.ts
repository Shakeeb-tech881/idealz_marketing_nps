import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { getSmsProvider } from "@/lib/messaging";
import { generateSurveyToken, hashSurveyToken, isWellFormedToken } from "@/lib/tokens";
import { describeInsightFilters, parseInsightFilters, type InsightFilters } from "@/lib/insights/filters";
import { offerBodyProblems, offerOptoutUrl, redactOptoutLink, renderOffer, worstCaseSegments } from "@/lib/offers/template";
import { isOrgWide } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { getAllCustomerInsights } from "./insights";
import { sentToday } from "./invitations";

/** Largest audience one offer may have. */
export const MAX_OFFER_RECIPIENTS = 5000;
/** Recipients per send request (keeps each request well inside the server time limit). */
const BATCH_SIZE = 15;
/** Provider errors that affect the whole account: pause the campaign instead of failing customers. */
const ACCOUNT_ERRORS = new Set(["112", "113", "114", "117", "118", "119", "ESMS_LOGIN_BLOCKED", "ESMS_LOGIN_CHECK_FAILED", "DIALOG_ESMS_NOT_CONFIGURED", "NETWORK_ERROR", "102", "115", "116"]);

export type CampaignStatus = "draft" | "sending" | "paused" | "completed" | "cancelled";

function requireOrgWide(actor: Profile) {
  if (!isOrgWide(actor)) throw new Error("Only Super Admins and Management can send offers.");
}

async function branchInfo(sb: SupabaseClient) {
  const settings = await getSettings(sb);
  const { data } = await sb.from("branches").select("id, name, brand_name, sms_sender_id");
  const map = new Map((data ?? []).map((b) => [b.id as string, { name: b.name as string, brand: (b.brand_name as string | null) ?? settings.company_display_name, mask: (b.sms_sender_id as string | null) ?? null }]));
  return { map, defaultBrand: settings.company_display_name };
}

/** The audience is always limited to customers who may receive offers. */
function audienceFilters(raw: unknown): InsightFilters {
  const f = parseInsightFilters((raw ?? {}) as Record<string, string>);
  return { ...f, offers: "allowed" };
}

export async function previewAudience(actor: Profile, rawFilters: unknown, body: string) {
  requireOrgWide(actor);
  const sb = await createClient();
  const f = audienceFilters(rawFilters);
  const { rows, total } = await getAllCustomerInsights(sb, f, MAX_OFFER_RECIPIENTS);
  const { map } = await branchInfo(sb);
  const branches = rows.map((r) => (r.lastBranchId ? map.get(r.lastBranchId) : undefined)).filter((b): b is NonNullable<typeof b> => !!b);
  const size = worstCaseSegments(body || "{{optout_link}}", {
    names: rows.map((r) => r.fullName),
    models: rows.map((r) => r.lastModel ?? ""),
    branches: branches.map((b) => b.name),
    brands: branches.map((b) => b.brand),
  }, serverEnv().NEXT_PUBLIC_APP_URL);
  const recipients = Math.min(total, MAX_OFFER_RECIPIENTS);
  return {
    total,
    recipients,
    capped: total > MAX_OFFER_RECIPIENTS,
    sample: rows.slice(0, 5).map((r) => ({ name: r.fullName, model: r.lastModel })),
    segments: size.segments,
    encoding: size.encoding,
    characters: size.characters,
    exampleText: size.text,
    estimatedSms: recipients * size.segments,
    problems: offerBodyProblems(body),
    description: describeInsightFilters(f),
  };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the offer a name").max(120),
  body: z.string().max(1000),
  filters: z.record(z.string(), z.string()).default({}),
});

/** Saves the offer with a fixed snapshot of who will receive it. Nothing is sent yet. */
export async function createCampaign(actor: Profile, raw: unknown) {
  requireOrgWide(actor);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const problems = offerBodyProblems(parsed.data.body);
  if (problems.length) return { ok: false as const, error: problems[0] };
  const sb = await createClient();
  const f = audienceFilters(parsed.data.filters);
  const { rows } = await getAllCustomerInsights(sb, f, MAX_OFFER_RECIPIENTS);
  if (!rows.length) return { ok: false as const, error: "No customers match these filters (customers who stopped offers or SMS are always left out)." };

  const { data: campaign, error } = await sb
    .from("offer_campaigns")
    .insert({
      name: parsed.data.name,
      body: parsed.data.body.trim(),
      audience: { filters: parsed.data.filters, description: describeInsightFilters(f) },
      recipient_count: rows.length,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error || !campaign) return { ok: false as const, error: error?.message ?? "Could not save the offer." };
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ campaign_id: campaign.id, customer_id: r.customerId, branch_id: r.lastBranchId }));
    const { error: rErr } = await sb.from("offer_recipients").insert(chunk);
    if (rErr) return { ok: false as const, error: `Could not save the recipients: ${rErr.message}` };
  }
  await sb.rpc("log_audit", { p_action: "offer.created", p_entity_type: "offer_campaigns", p_entity_id: campaign.id, p_details: { recipients: rows.length, filters: parsed.data.filters } });
  return { ok: true as const, id: campaign.id as string };
}

export async function campaignCounts(sb: SupabaseClient, campaignId: string) {
  const statuses = ["pending", "sending", "sent", "failed", "skipped"] as const;
  const counts = await Promise.all(
    statuses.map(async (s) => {
      const { count } = await sb.from("offer_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", s);
      return [s, count ?? 0] as const;
    }),
  );
  const { count: delivered } = await sb.from("message_logs").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "delivered");
  const { count: stopped } = await sb
    .from("offer_recipients")
    .select("id, customers!inner(offers_opt_out)", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
    .eq("customers.offers_opt_out", true);
  return { ...Object.fromEntries(counts), delivered: delivered ?? 0, stopped: stopped ?? 0 } as Record<(typeof statuses)[number] | "delivered" | "stopped", number>;
}

async function setStatus(sb: SupabaseClient, id: string, status: CampaignStatus, extra: Record<string, unknown> = {}) {
  await sb.from("offer_campaigns").update({ status, ...extra }).eq("id", id);
}

/**
 * Sends the next batch. The browser calls this repeatedly (with a progress bar)
 * until `done` or `paused`. Account-wide problems (8 PM–8 AM blackout, low balance,
 * blocked login, daily limit) pause the campaign; the remaining customers stay
 * pending and nobody is sent the offer twice.
 */
export async function sendCampaignBatch(actor: Profile, campaignId: string) {
  requireOrgWide(actor);
  const sb = await createClient();
  const { data: c } = await sb.from("offer_campaigns").select("id, body, status, started_at").eq("id", campaignId).maybeSingle();
  if (!c) return { ok: false as const, error: "Offer not found." };
  if (c.status === "completed" || c.status === "cancelled") return { ok: true as const, done: true, paused: null, counts: await campaignCounts(sb, campaignId) };
  if (c.status !== "sending") await setStatus(sb, campaignId, "sending", { pause_reason: null, ...(c.started_at ? {} : { started_at: new Date().toISOString() }) });

  const provider = getSmsProvider();
  const settings = await getSettings(sb);
  let allowance = BATCH_SIZE;
  if (!provider.isTest) {
    const left = settings.sms_daily_limit - (await sentToday(sb));
    if (left <= 0) {
      const reason = `Daily SMS limit of ${settings.sms_daily_limit} reached (Settings → General). Resume later.`;
      await setStatus(sb, campaignId, "paused", { pause_reason: reason });
      return { ok: true as const, done: false, paused: reason, counts: await campaignCounts(sb, campaignId) };
    }
    allowance = Math.min(BATCH_SIZE, left);
  }

  const { data: claimed, error: claimErr } = await sb.rpc("claim_offer_recipients", { p_campaign: campaignId, p_limit: allowance });
  if (claimErr) return { ok: false as const, error: claimErr.message };
  const batch = (claimed ?? []) as { id: string; customer_id: string; branch_id: string | null }[];

  let paused: string | null = null;
  if (batch.length) {
    const ids = batch.map((r) => r.customer_id);
    const [{ data: customers }, { data: purchases }, info] = await Promise.all([
      sb.from("customers").select("id, full_name, mobile, sms_opt_out, offers_opt_out, anonymised_at").in("id", ids),
      sb
        .from("customer_interactions")
        .select("customer_id, product_model, purchase_date, interaction_date")
        .in("customer_id", ids)
        .eq("purchase_status", "purchased")
        .not("product_model", "is", null)
        .order("interaction_date", { ascending: false }),
      branchInfo(sb),
    ]);
    const cust = new Map((customers ?? []).map((x) => [x.id as string, x]));
    const lastModel = new Map<string, string>();
    for (const p of purchases ?? []) if (!lastModel.has(p.customer_id as string)) lastModel.set(p.customer_id as string, p.product_model as string);
    const appUrl = serverEnv().NEXT_PUBLIC_APP_URL;

    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      const cu = cust.get(r.customer_id);
      // Re-checked at send time: a customer may have opted out after the offer was created.
      if (!cu || !cu.mobile || cu.anonymised_at || cu.sms_opt_out || cu.offers_opt_out) {
        await sb.from("offer_recipients").update({ status: "skipped", error: "Opted out or no mobile number" }).eq("id", r.id);
        continue;
      }
      const branch = r.branch_id ? info.map.get(r.branch_id) : undefined;
      const token = generateSurveyToken();
      const link = offerOptoutUrl(appUrl, token);
      const message = renderOffer(c.body, { customerName: cu.full_name, lastModel: lastModel.get(cu.id), branchName: branch?.name, brandName: branch?.brand ?? info.defaultBrand, optoutLink: link });
      const { data: log, error: logErr } = await sb
        .from("message_logs")
        .insert({
          campaign_id: campaignId,
          customer_id: cu.id,
          branch_id: r.branch_id,
          provider: provider.name,
          is_test: provider.isTest,
          sender_id: branch?.mask ?? null,
          recipient: cu.mobile,
          body_redacted: redactOptoutLink(message, link),
          status: "queued",
          sent_by: actor.id,
        })
        .select("id")
        .single();
      if (logErr || !log) {
        await sb.from("offer_recipients").update({ status: "failed", error: `Could not log the message: ${logErr?.message ?? "unknown"}`.slice(0, 500) }).eq("id", r.id);
        continue;
      }
      await sb.from("offer_recipients").update({ optout_token_hash: hashSurveyToken(token), message_log_id: log.id }).eq("id", r.id);

      const result = await provider.send({ to: cu.mobile, body: message, reference: log.id, senderId: branch?.mask ?? null });
      if (result.ok) {
        await sb.from("message_logs").update({ status: "sent", provider_message_id: result.providerMessageId, provider_status: result.providerStatus, provider_response: result.raw as object }).eq("id", log.id);
        await sb.from("offer_recipients").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
        continue;
      }
      await sb
        .from("message_logs")
        .update({ status: "failed", error_code: result.errorCode, error_message: result.errorMessage, provider_response: (result.raw ?? null) as object | null })
        .eq("id", log.id);
      if (result.notAttempted || ACCOUNT_ERRORS.has(result.errorCode)) {
        // Not this customer's fault: put them (and the rest of the batch) back in the queue and pause.
        const back = batch.slice(i).map((x) => x.id);
        await sb.from("offer_recipients").update({ status: "pending", claimed_at: null }).in("id", back);
        paused = `${result.errorCode}: ${result.errorMessage}`.slice(0, 300);
        await setStatus(sb, campaignId, "paused", { pause_reason: paused });
        break;
      }
      await sb.from("offer_recipients").update({ status: "failed", error: `${result.errorCode}: ${result.errorMessage}`.slice(0, 500) }).eq("id", r.id);
    }
  }

  const counts = await campaignCounts(sb, campaignId);
  const done = !paused && counts.pending === 0 && counts.sending === 0;
  if (done) {
    await setStatus(sb, campaignId, "completed", { completed_at: new Date().toISOString(), pause_reason: null });
    await sb.rpc("log_audit", { p_action: "offer.completed", p_entity_type: "offer_campaigns", p_entity_id: campaignId, p_details: { sent: counts.sent, failed: counts.failed, skipped: counts.skipped } });
  }
  return { ok: true as const, done, paused, counts };
}

export async function pauseCampaign(actor: Profile, campaignId: string) {
  requireOrgWide(actor);
  const sb = await createClient();
  await sb.from("offer_campaigns").update({ status: "paused", pause_reason: "Paused by a user" }).eq("id", campaignId).in("status", ["sending", "draft"]);
  return { ok: true as const };
}

/** Stops for good: customers not yet sent are marked skipped. */
export async function cancelCampaign(actor: Profile, campaignId: string) {
  requireOrgWide(actor);
  const sb = await createClient();
  await sb.from("offer_recipients").update({ status: "skipped", error: "Offer cancelled" }).eq("campaign_id", campaignId).eq("status", "pending");
  await sb.from("offer_campaigns").update({ status: "cancelled", pause_reason: null }).eq("id", campaignId).in("status", ["draft", "sending", "paused"]);
  await sb.rpc("log_audit", { p_action: "offer.cancelled", p_entity_type: "offer_campaigns", p_entity_id: campaignId, p_details: {} });
  return { ok: true as const };
}

// ------------------------------------------------------------ opt-out (public)

async function recipientForToken(token: string) {
  if (!isWellFormedToken(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("offer_recipients")
    .select("id, campaign_id, customer_id, branch_id, customers(offers_opt_out, anonymised_at), branches(brand_name)")
    .eq("optout_token_hash", hashSurveyToken(token))
    .maybeSingle();
  return data as unknown as {
    id: string; campaign_id: string; customer_id: string; branch_id: string | null;
    customers: { offers_opt_out: boolean; anonymised_at: string | null } | null;
    branches: { brand_name: string | null } | null;
  } | null;
}

/** For the public /u/<token> page. Reveals nothing about the customer. */
export async function optoutLinkState(token: string): Promise<{ valid: boolean; alreadyStopped: boolean; brandName: string | null }> {
  const r = await recipientForToken(token);
  if (!r || !r.customers) return { valid: false, alreadyStopped: false, brandName: null };
  return { valid: true, alreadyStopped: r.customers.offers_opt_out, brandName: r.branches?.brand_name ?? null };
}

export async function optOutWithToken(token: string, clientKey: string) {
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("check_rate_limit", { p_key: `offers-optout:${clientKey}`, p_limit: 20, p_window_seconds: 600 });
  if (allowed === false) return { ok: false as const, error: "Too many attempts. Please try again in a few minutes." };
  const r = await recipientForToken(token);
  if (!r) return { ok: false as const, error: "This link is not valid." };
  if (!r.customers?.offers_opt_out) {
    const { error } = await admin.from("customers").update({ offers_opt_out: true, offers_opt_out_at: new Date().toISOString() }).eq("id", r.customer_id);
    if (error) return { ok: false as const, error: "Something went wrong. Please try again." };
    await admin.from("audit_logs").insert({ action: "customer.offers_opt_out", entity_type: "customers", entity_id: r.customer_id, details: { via: "sms_link", campaign_id: r.campaign_id } });
  }
  return { ok: true as const };
}

// ------------------------------------------------------------ staff toggle

export async function setOffersOptOut(actor: Profile, customerId: string, optOut: boolean) {
  const sb = await createClient();
  const { data, error } = await sb
    .from("customers")
    .update({ offers_opt_out: optOut, offers_opt_out_at: optOut ? new Date().toISOString() : null })
    .eq("id", customerId)
    .select("id");
  if (error) return { ok: false as const, error: "Could not update the customer." };
  if (!data?.length) return { ok: false as const, error: "You do not have permission to edit this customer." };
  await sb.rpc("log_audit", { p_action: optOut ? "customer.offers_opt_out" : "customer.offers_opt_in", p_entity_type: "customers", p_entity_id: customerId, p_details: { by: actor.id } });
  return { ok: true as const };
}
