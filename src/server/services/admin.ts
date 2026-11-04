import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import type { Profile } from "@/lib/types";
import { friendlyDbError } from "./customers";

const roleEnum = z.enum(["super_admin", "management", "branch_manager", "staff"]);
const optionalUuid = z.uuid().nullable().optional().or(z.literal("")).transform((v) => (v ? v : null));

// ---------------------------------------------------------------- branches
export const branchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, "2–20 letters, numbers, - or _"),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  address: z.string().trim().max(300).optional().transform((v) => v || null),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  is_active: z.boolean().default(true),
});

export async function saveBranch(actor: Profile, id: string | null, raw: unknown) {
  const parsed = branchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const supabase = await createClient();
  const q = id ? supabase.from("branches").update(parsed.data).eq("id", id) : supabase.from("branches").insert(parsed.data);
  const { data, error } = await q.select("id");
  if (error) return { ok: false as const, error: error.code === "23505" ? "A branch with this name or code already exists." : friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "Only Super Admins can manage branches." };
  await supabase.rpc("log_audit", { p_action: id ? "branch.updated" : "branch.created", p_entity_type: "branches", p_entity_id: data[0].id, p_details: parsed.data });
  return { ok: true as const };
}

// ---------------------------------------------------------------- employees
export const employeeSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required").max(160),
  branch_id: z.uuid("Select a branch"),
  employee_code: z.string().trim().max(30).regex(/^[A-Za-z0-9_-]*$/, "Letters, numbers, - or _ only").optional().transform((v) => v || null),
  job_title: z.string().trim().max(80).optional().transform((v) => v || null),
  is_active: z.boolean().default(true),
});

export async function saveEmployee(actor: Profile, id: string | null, raw: unknown) {
  const parsed = employeeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const supabase = await createClient();
  const q = id ? supabase.from("employees").update(parsed.data).eq("id", id) : supabase.from("employees").insert(parsed.data);
  const { data, error } = await q.select("id");
  if (error) return { ok: false as const, error: error.code === "23505" ? "This employee code is already in use." : friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "Only Super Admins can manage employees." };
  await supabase.rpc("log_audit", { p_action: id ? "employee.updated" : "employee.created", p_entity_type: "employees", p_entity_id: data[0].id, p_details: parsed.data });
  return { ok: true as const };
}

// ---------------------------------------------------------------- users
export const inviteUserSchema = z
  .object({
    email: z.email("Enter a valid email").transform((v) => v.toLowerCase()),
    full_name: z.string().trim().min(1, "Name is required").max(160),
    role: roleEnum,
    branch_id: optionalUuid,
    employee_id: optionalUuid,
  })
  .refine((v) => v.role === "super_admin" || v.role === "management" || v.branch_id, {
    path: ["branch_id"],
    message: "Branch managers and staff must be assigned to a branch",
  });

/** Super-admin only: invite a user by email (Supabase sends the invitation). */
export async function inviteUser(actor: Profile, raw: unknown) {
  if (actor.role !== "super_admin") return { ok: false as const, error: "Only Super Admins can manage users." };
  const parsed = inviteUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const v = parsed.data;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, {
    data: { full_name: v.full_name },
    redirectTo: `${serverEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/set-password`,
  });
  if (error || !data.user) return { ok: false as const, error: error?.message ?? "Invitation failed." };
  // Role / branch are written by the server (app_metadata is not user-editable).
  await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: v.role, branch_id: v.branch_id, provisioned: true } });
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, email: v.email, full_name: v.full_name, role: v.role, branch_id: v.branch_id, employee_id: v.employee_id, is_active: true });
  if (pErr) return { ok: false as const, error: friendlyDbError(pErr) };
  const supabase = await createClient();
  await supabase.rpc("log_audit", { p_action: "user.invited", p_entity_type: "profiles", p_entity_id: data.user.id, p_details: { email: v.email, role: v.role } });
  return { ok: true as const };
}

export const updateUserSchema = z
  .object({
    full_name: z.string().trim().min(1).max(160),
    role: roleEnum,
    branch_id: optionalUuid,
    employee_id: optionalUuid,
    is_active: z.boolean(),
  })
  .refine((v) => v.role === "super_admin" || v.role === "management" || v.branch_id || !v.is_active, {
    path: ["branch_id"],
    message: "Branch managers and staff must be assigned to a branch",
  });

export async function updateUser(actor: Profile, userId: string, raw: unknown) {
  if (actor.role !== "super_admin") return { ok: false as const, error: "Only Super Admins can manage users." };
  const parsed = updateUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  if (userId === actor.id && (parsed.data.role !== "super_admin" || !parsed.data.is_active)) {
    return { ok: false as const, error: "You cannot remove your own Super Admin access." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update(parsed.data).eq("id", userId).select("id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "User not found." };
  await createAdminClient().auth.admin.updateUserById(userId, {
    app_metadata: { role: parsed.data.role, branch_id: parsed.data.branch_id, provisioned: true },
    ban_duration: parsed.data.is_active ? "none" : "876000h",
  });
  await supabase.rpc("log_audit", { p_action: "user.updated", p_entity_type: "profiles", p_entity_id: userId, p_details: { role: parsed.data.role, is_active: parsed.data.is_active } });
  return { ok: true as const };
}

// ---------------------------------------------------------------- settings
export const settingsSchema = z.object({
  company_name: z.string().trim().min(1).max(160),
  company_display_name: z.string().trim().min(1).max(80),
  company_logo_url: z.union([z.url(), z.literal("")]).transform((v) => v || null),
  support_phone: z.string().trim().max(30).transform((v) => v || null),
  survey_expiry_days: z.coerce.number().int().min(1).max(90),
  min_employee_sample: z.coerce.number().int().min(1).max(500),
  min_branch_sample: z.coerce.number().int().min(1).max(1000),
  data_retention_months: z.coerce.number().int().min(0).max(120),
  sms_daily_limit: z.coerce.number().int().min(1).max(100000),
});

export async function saveSettings(actor: Profile, raw: unknown) {
  if (actor.role !== "super_admin") return { ok: false as const, error: "Only Super Admins can change settings." };
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const supabase = await createClient();
  const rows = Object.entries(parsed.data).map(([key, value]) => ({ key, value, updated_by: actor.id }));
  const { error } = await supabase.from("system_settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  await supabase.rpc("log_audit", { p_action: "settings.updated", p_entity_type: "system_settings", p_entity_id: null, p_details: parsed.data });
  return { ok: true as const };
}

// ---------------------------------------------------------------- SMS templates
export const messageTemplateSchema = z.object({
  survey_type: z.enum(["purchased", "non_purchased"]),
  name: z.string().trim().min(1).max(120),
  body: z
    .string()
    .trim()
    .min(10)
    .max(640)
    .refine((b) => b.includes("{{survey_link}}"), "The message must include {{survey_link}}"),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export async function saveMessageTemplate(actor: Profile, id: string | null, raw: unknown) {
  const parsed = messageTemplateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const supabase = await createClient();
  const v = parsed.data;
  if (v.is_default) {
    // Clear the previous default for this survey type first (unique partial index).
    let clear = supabase.from("message_templates").update({ is_default: false }).eq("survey_type", v.survey_type).eq("is_default", true);
    if (id) clear = clear.neq("id", id);
    const { error: clearErr } = await clear;
    if (clearErr) return { ok: false as const, error: friendlyDbError(clearErr) };
  }
  const q = id
    ? supabase.from("message_templates").update(v).eq("id", id)
    : supabase.from("message_templates").insert({ ...v, created_by: actor.id });
  const { data, error } = await q.select("id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "You do not have permission to manage templates." };
  await supabase.rpc("log_audit", { p_action: id ? "template.updated" : "template.created", p_entity_type: "message_templates", p_entity_id: data[0].id, p_details: { name: v.name } });
  return { ok: true as const };
}
