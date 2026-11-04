"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, requireRole } from "@/lib/auth";
import { saveBranch, saveEmployee, saveSettings } from "@/server/services/admin";

function fail(e: unknown) {
  if (!(e instanceof AuthorisationError)) console.error("[settings]", e);
  return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
}

export async function saveSettingsAction(input: unknown) {
  try {
    const actor = await requireRole(["super_admin"]);
    const res = await saveSettings(actor, input);
    if (res.ok) revalidatePath("/admin", "layout");
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function saveBranchAction(id: string | null, input: unknown) {
  try {
    const actor = await requireRole(["super_admin"]);
    const res = await saveBranch(actor, id, input);
    if (res.ok) revalidatePath("/admin/settings");
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function saveEmployeeAction(id: string | null, input: unknown) {
  try {
    const actor = await requireRole(["super_admin"]);
    const res = await saveEmployee(actor, id, input);
    if (res.ok) revalidatePath("/admin/settings");
    return res;
  } catch (e) {
    return fail(e);
  }
}
