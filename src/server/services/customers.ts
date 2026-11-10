import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { customerContactSchema, interactionSchema, newCustomerSchema } from "@/lib/validation/customer";
import type { Profile } from "@/lib/types";
import type { z } from "zod";

export function friendlyDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    if (error.message.includes("interactions_invoice_key")) return "This invoice number is already recorded for this branch.";
    if (error.message.includes("customers_mobile_key")) return "A customer with this mobile number already exists.";
    return "This record already exists.";
  }
  if (error.code === "42501" || /row-level security/i.test(error.message)) return "You do not have permission to do this for the selected branch.";
  if (error.code === "23514") return error.message.replace(/^.*?:\s*/, "") || "The data did not pass validation.";
  return "Something went wrong while saving. Please try again.";
}

export async function insertInteraction(
  supabase: SupabaseClient,
  actor: Profile,
  customerId: string,
  i: z.output<typeof interactionSchema>,
  /** Bulk imports carry no rep KPI data, so they are left out of the scorecard. */
  opts: { kpiTracked?: boolean } = {},
) {
  // Staff can only record visits for themselves — they count towards their own scorecard.
  // (Also enforced by row-level security.)
  const employee_id = actor.role === "staff" ? (actor.employee_id ?? null) : i.employee_id;
  return supabase
    .from("customer_interactions")
    .insert({ ...i, employee_id, customer_id: customerId, created_by: actor.id, kpi_tracked: opts.kpiTracked ?? true })
    .select("id")
    .single();
}

export async function createCustomerWithInteraction(actor: Profile, raw: unknown) {
  const parsed = newCustomerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: customerId, error: cErr } = await supabase.rpc("ensure_customer", {
    p_full_name: v.full_name,
    p_mobile: v.mobile,
    p_email: v.email,
  });
  if (cErr || !customerId) return { ok: false as const, error: friendlyDbError(cErr ?? { message: "No customer" }) };
  const { full_name: _n, mobile: _m, email: _e, ...interaction } = v;
  void _n; void _m; void _e;
  const { data, error } = await insertInteraction(supabase, actor, customerId as string, interaction);
  if (error || !data) return { ok: false as const, error: friendlyDbError(error ?? { message: "Insert failed" }) };
  await supabase.rpc("log_audit", { p_action: "customer.interaction_created", p_entity_type: "customer_interactions", p_entity_id: data.id, p_details: { customer_id: customerId } });
  return { ok: true as const, customerId: customerId as string, interactionId: data.id as string };
}

export async function addInteraction(actor: Profile, customerId: string, raw: unknown) {
  const parsed = interactionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const supabase = await createClient();
  const { data, error } = await insertInteraction(supabase, actor, customerId, parsed.data);
  if (error || !data) return { ok: false as const, error: friendlyDbError(error ?? { message: "Insert failed" }) };
  return { ok: true as const, interactionId: data.id as string };
}

export async function updateCustomerContact(actor: Profile, customerId: string, raw: unknown) {
  const parsed = customerContactSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update(parsed.data).eq("id", customerId).select("id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "You do not have permission to edit this customer." };
  await supabase.rpc("log_audit", { p_action: "customer.updated", p_entity_type: "customers", p_entity_id: customerId, p_details: {} });
  return { ok: true as const };
}

export async function setSmsOptOut(actor: Profile, customerId: string, optOut: boolean) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ sms_opt_out: optOut, sms_opt_out_at: optOut ? new Date().toISOString() : null })
    .eq("id", customerId)
    .select("id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "You do not have permission to edit this customer." };
  await supabase.rpc("log_audit", { p_action: optOut ? "customer.sms_opt_out" : "customer.sms_opt_in", p_entity_type: "customers", p_entity_id: customerId, p_details: {} });
  return { ok: true as const };
}
