"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, requireRole } from "@/lib/auth";
import { inviteUser, updateUser } from "@/server/services/admin";

function fail(e: unknown) {
  if (!(e instanceof AuthorisationError)) console.error("[users]", e);
  return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
}

export async function inviteUserAction(input: unknown) {
  try {
    const actor = await requireRole(["super_admin"]);
    const res = await inviteUser(actor, input);
    if (res.ok) revalidatePath("/admin/users");
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function updateUserAction(userId: string, input: unknown) {
  try {
    const actor = await requireRole(["super_admin"]);
    const res = await updateUser(actor, userId, input);
    if (res.ok) revalidatePath("/admin/users");
    return res;
  } catch (e) {
    return fail(e);
  }
}
