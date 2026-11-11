"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, MANAGERS, requireRole } from "@/lib/auth";
import { deleteLeave, recordLeave, setLeaveProof } from "@/server/services/leave";

function fail(e: unknown) {
  if (!(e instanceof AuthorisationError)) console.error("[leave]", e);
  return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
}

function refresh() {
  revalidatePath("/admin/leave");
  revalidatePath("/admin/scorecard");
}

export async function recordLeaveAction(input: unknown) {
  try {
    const res = await recordLeave(await requireRole(MANAGERS), input);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function setLeaveProofAction(id: string, proof: boolean) {
  try {
    const res = await setLeaveProof(await requireRole(MANAGERS), id, proof);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLeaveAction(id: string) {
  try {
    const res = await deleteLeave(await requireRole(MANAGERS), id);
    if (res.ok) refresh();
    return res;
  } catch (e) {
    return fail(e);
  }
}
