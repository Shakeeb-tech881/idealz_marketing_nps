"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorisationError, requireRole } from "@/lib/auth";
import { createAndSendInvitations, resendInvitation } from "@/server/services/invitations";
import { saveMessageTemplate } from "@/server/services/admin";

const sendSchema = z.object({
  interactionIds: z.array(z.uuid()).min(1, "Select at least one customer").max(200, "Send to at most 200 customers at a time"),
  surveyType: z.enum(["purchased", "non_purchased"]),
  templateId: z.uuid().nullable().optional(),
});

function fail(e: unknown) {
  if (!(e instanceof AuthorisationError)) console.error("[messaging]", e);
  return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
}

export async function sendInvitationsAction(input: unknown) {
  try {
    const actor = await requireRole();
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const summary = await createAndSendInvitations(actor, parsed.data);
    revalidatePath("/admin/messaging");
    revalidatePath("/admin/customers");
    return { ok: true as const, data: summary };
  } catch (e) {
    return fail(e);
  }
}

export async function resendInvitationAction(invitationId: string, onlyIfFailed = false) {
  try {
    const actor = await requireRole();
    if (!z.uuid().safeParse(invitationId).success) return { ok: false as const, error: "Invalid invitation" };
    const res = await resendInvitation(actor, invitationId, { onlyIfFailed });
    revalidatePath("/admin/messaging/history");
    revalidatePath("/admin/customers", "layout");
    return { ok: true as const, data: res };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTemplateAction(id: string | null, input: unknown) {
  try {
    const actor = await requireRole(["super_admin", "management"]);
    const res = await saveMessageTemplate(actor, id, input);
    if (res.ok) revalidatePath("/admin/messaging/templates");
    return res;
  } catch (e) {
    return fail(e);
  }
}
