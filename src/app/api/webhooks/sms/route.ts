import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSmsProvider } from "@/lib/messaging";
import { serverEnv } from "@/lib/env";
import type { DeliveryReport } from "@/lib/messaging/types";

/**
 * Delivery-report webhook: /api/webhooks/sms?secret=SMS_WEBHOOK_SECRET
 *
 * Dialog eSMS calls it with GET …&campaignId=…&msisdn=…&status=1|2|3|4.
 * POST with a JSON body is also accepted for providers that push JSON.
 *
 * Delivery status is never inferred — it is only recorded from an explicit
 * provider report. Reports can arrive in any order, so a final state
 * (delivered / failed) is never overwritten, and "submitted" only adds detail.
 */
export async function GET(req: NextRequest) {
  return handle(req, req.nextUrl.searchParams);
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  return handle(req, payload);
}

function authorised(req: NextRequest, secret: string | undefined) {
  const given = req.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

async function handle(req: NextRequest, payload: unknown) {
  const env = serverEnv();
  const provider = getSmsProvider();
  if (!provider.supportsDeliveryReports || !provider.parseDeliveryReport) {
    return NextResponse.json({ error: "Delivery reports are not enabled for this provider" }, { status: 404 });
  }
  if (!authorised(req, env.SMS_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const report = provider.parseDeliveryReport(payload);
  if (!report) return NextResponse.json({ error: "Unrecognised payload" }, { status: 422 });

  const result = await applyReport(provider.name, report);
  // Always 200 for a well-formed, authorised report so the provider does not keep retrying.
  return NextResponse.json({ ok: true, ...result });
}

async function applyReport(providerName: string, report: DeliveryReport) {
  const admin = createAdminClient();
  const { data: log } = await admin
    .from("message_logs")
    .select("id, status, recipient, invitation_id, created_at")
    .eq("provider", providerName)
    .eq("provider_message_id", report.providerMessageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!log) return { matched: false };
  if (report.recipient && !String(log.recipient ?? "").endsWith(report.recipient)) return { matched: false };

  if (report.status === "submitted") {
    // Informational only; keep it from replacing a final state that arrived first.
    await admin.from("message_logs").update({ provider_status: report.providerStatus }).eq("id", log.id).in("status", ["queued", "sent"]);
    return { matched: true, updated: false };
  }

  const { data: changed } = await admin
    .from("message_logs")
    .update({ status: report.status, provider_status: report.providerStatus, provider_response: report.raw as object })
    .eq("id", log.id)
    .in("status", ["queued", "sent"])
    .select("id")
    .maybeSingle();
  if (!changed || !log.invitation_id) return { matched: true, updated: !!changed };

  // Only the newest message for an invitation may change it (an older, resent
  // link must not overwrite the status of the current one).
  const { data: latest } = await admin
    .from("message_logs")
    .select("id")
    .eq("invitation_id", log.invitation_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.id !== log.id) return { matched: true, updated: true };

  const at = report.occurredAt.toISOString();
  if (report.status === "delivered") {
    await admin.from("survey_invitations").update({ status: "delivered", delivered_at: at }).eq("id", log.invitation_id).in("status", ["sent", "pending"]);
    await admin.from("survey_invitations").update({ delivered_at: at }).eq("id", log.invitation_id).is("delivered_at", null);
  } else {
    await admin
      .from("survey_invitations")
      .update({ status: "failed", failed_at: at, last_error: `Delivery failed: ${report.providerStatus}`.slice(0, 500) })
      .eq("id", log.invitation_id)
      .in("status", ["sent", "pending"]);
  }
  return { matched: true, updated: true };
}
