import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily maintenance (Vercel Cron, see vercel.json):
 *  - mark past-due invitations as expired
 *  - apply the data-retention policy
 * Protected by CRON_SECRET (Vercel sends it as a Bearer token).
 */
export async function GET(req: NextRequest) {
  // Checked before anything else so unauthenticated calls never touch the database.
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const admin = createAdminClient();
  const expired = await admin.rpc("expire_stale_invitations");
  const retention = await admin.rpc("apply_data_retention");
  if (expired.error || retention.error) {
    console.error("[cron]", expired.error?.message, retention.error?.message);
    return NextResponse.json({ error: "Maintenance failed" }, { status: 500 });
  }
  return NextResponse.json({ expiredInvitations: expired.data, anonymisedCustomers: retention.data });
}
