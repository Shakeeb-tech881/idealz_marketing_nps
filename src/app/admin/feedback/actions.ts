"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, requireRole } from "@/lib/auth";
import { addFeedbackNote, updateFeedback } from "@/server/services/feedback";

function fail(e: unknown) {
  if (!(e instanceof AuthorisationError)) console.error("[feedback]", e);
  return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
}

export async function updateFeedbackAction(responseId: string, input: unknown) {
  try {
    const actor = await requireRole();
    const res = await updateFeedback(actor, responseId, input);
    if (res.ok) revalidatePath(`/admin/feedback/${responseId}`);
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function addNoteAction(responseId: string, body: string) {
  try {
    const actor = await requireRole();
    const res = await addFeedbackNote(actor, responseId, body);
    if (res.ok) revalidatePath(`/admin/feedback/${responseId}`);
    return res;
  } catch (e) {
    return fail(e);
  }
}
