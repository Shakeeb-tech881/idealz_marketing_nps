import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSmsProvider } from "@/lib/messaging";
import { serverEnv } from "@/lib/env";

/**
 * Delivery-report webhook. Only active when the configured provider supports
 * delivery reports and implements parseDeliveryReport. Requests must carry
 * ?secret=SMS_WEBHOOK_SECRET. Delivery status is never inferred — it is only
 * recorded from an explicit provider report.
 */
export async function POST(req: NextRequest) {
  const env = serverEnv();
  const provider = getSmsProvider();
  if (!provider.supportsDeliveryReports || !provider.parseDeliveryReport) {
    return NextResponse.json({ error: "Delivery reports are not enabled for this provider" }, { status: 404 });
  }
  const given = req.nextUrl.searchParams.get("secret") ?? "";
  const secret = env.SMS_WEBHOOK_SECRET ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const report = provider.parseDeliveryReport(payload);
  if (!report) return NextResponse.json({ error: "Unrecognised payload" }, { status: 422 });

  const admin = createAdminClient();
  const { data: log } = await admin
    .from("message_logs")
    .update({ status: report.status, provider_status: report.providerStatus, provider_response: report.raw as object })
    .eq("provider", provider.name)
    .eq("provider_message_id", report.providerMessageId)
    .select("invitation_id")
    .maybeSingle();
  if (log?.invitation_id) {
    if (report.status === "delivered") {
      await admin
        .from("survey_invitations")
        .update({ delivered_at: report.occurredAt.toISOString(), status: "delivered" })
        .eq("id", log.invitation_id)
        .in("status", ["sent", "pending"]);
      await admin.from("survey_invitations").update({ delivered_at: report.occurredAt.toISOString() }).eq("id", log.invitation_id).is("delivered_at", null);
    } else {
      await admin
        .from("survey_invitations")
        .update({ status: "failed", failed_at: report.occurredAt.toISOString(), last_error: `Delivery failed: ${report.providerStatus}` })
        .eq("id", log.invitation_id)
        .in("status", ["sent", "pending"]);
    }
  }
  return NextResponse.json({ ok: true });
}
