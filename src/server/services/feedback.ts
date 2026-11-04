import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { friendlyDbError } from "./customers";

export const feedbackUpdateSchema = z.object({
  resolution_status: z.enum(["new", "under_review", "contact_required", "resolved", "closed"]).optional(),
  assigned_to: z.uuid().nullable().optional(),
  follow_up_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function updateFeedback(actor: Profile, responseId: string, raw: unknown) {
  if (actor.role === "staff") return { ok: false as const, error: "Only managers can update the follow-up workflow." };
  const parsed = feedbackUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Invalid update." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("survey_responses").update(parsed.data).eq("id", responseId).select("id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "You cannot manage feedback for this branch." };
  return { ok: true as const };
}

export async function addFeedbackNote(actor: Profile, responseId: string, body: string) {
  const text = body.trim();
  if (!text) return { ok: false as const, error: "Note cannot be empty." };
  if (text.length > 4000) return { ok: false as const, error: "Note is too long (max 4000 characters)." };
  const supabase = await createClient();
  const { error } = await supabase.from("feedback_notes").insert({ response_id: responseId, body: text, created_by: actor.id });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  return { ok: true as const };
}
