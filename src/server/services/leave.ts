import "server-only";
import { z } from "zod";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { MANAGERS } from "@/lib/auth";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import type { Profile } from "@/lib/types";
import { friendlyDbError } from "./customers";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const recordSchema = z
  .object({
    employee_id: z.uuid("Choose the sales rep"),
    from: iso,
    to: iso,
    kind: z.enum(["informed", "sudden_proof", "sudden_no_proof"]),
    note: z.string().trim().max(500, "At most 500 characters").optional().transform((v) => v || null),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "The end date is before the start date" })
  .refine((v) => differenceInCalendarDays(parseISO(v.to), parseISO(v.from)) < 31, { path: ["to"], message: "Record at most 31 days at a time" });

function requireManager(actor: Profile) {
  if (!MANAGERS.includes(actor.role)) throw new Error("Only managers can record staff leave.");
}

/** Records one row per day. Re-recording a day replaces it (e.g. correcting the type). */
export async function recordLeave(actor: Profile, raw: unknown) {
  requireManager(actor);
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const days = differenceInCalendarDays(parseISO(v.to), parseISO(v.from)) + 1;
  const rows = Array.from({ length: days }, (_, i) => ({
    employee_id: v.employee_id,
    leave_date: format(addDays(parseISO(v.from), i), "yyyy-MM-dd"),
    leave_type: v.kind === "informed" ? "informed" : "sudden",
    proof_received: v.kind === "sudden_proof",
    note: v.note,
    recorded_by: actor.id,
  }));
  const supabase = await createClient();
  const { error } = await supabase.from("employee_leave").upsert(rows, { onConflict: "employee_id,leave_date" });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  await supabase.rpc("log_audit", { p_action: "leave.recorded", p_entity_type: "employees", p_entity_id: v.employee_id, p_details: { from: v.from, to: v.to, kind: v.kind } });
  return { ok: true as const, days };
}

/** Proof arrived later (or was recorded by mistake). */
export async function setLeaveProof(actor: Profile, id: string, proof: boolean) {
  requireManager(actor);
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_leave").update({ proof_received: proof }).eq("id", id).eq("leave_type", "sudden").select("id, employee_id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "Leave record not found." };
  await supabase.rpc("log_audit", { p_action: proof ? "leave.proof_received" : "leave.proof_removed", p_entity_type: "employees", p_entity_id: data[0].employee_id, p_details: { leave_id: id } });
  return { ok: true as const };
}

export async function deleteLeave(actor: Profile, id: string) {
  requireManager(actor);
  const supabase = await createClient();
  const { data, error } = await supabase.from("employee_leave").delete().eq("id", id).select("id, employee_id, leave_date");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "Leave record not found." };
  await supabase.rpc("log_audit", { p_action: "leave.deleted", p_entity_type: "employees", p_entity_id: data[0].employee_id, p_details: { date: data[0].leave_date } });
  return { ok: true as const };
}

export interface LeaveRow {
  id: string;
  employee_id: string;
  leave_date: string;
  leave_type: "informed" | "sudden";
  proof_received: boolean;
  note: string | null;
  employees: { full_name: string } | null;
  branches: { name: string } | null;
  profiles: { full_name: string } | null;
}

export async function listLeave(sb: SupabaseClient, f: AnalyticsFilters) {
  let q = sb
    .from("employee_leave")
    .select("id, employee_id, leave_date, leave_type, proof_received, note, employees(full_name), branches(name), profiles:recorded_by(full_name)")
    .gte("leave_date", f.from)
    .lte("leave_date", f.to)
    .order("leave_date", { ascending: false })
    .limit(1000);
  if (f.branch) q = q.eq("branch_id", f.branch);
  if (f.employee) q = q.eq("employee_id", f.employee);
  const { data, error } = await q;
  if (error) throw new Error(`leave: ${error.message}`);
  return (data ?? []) as unknown as LeaveRow[];
}
