"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, MANAGERS, requireRole } from "@/lib/auth";
import { setReviewStatus, type ReviewCheckStatus } from "@/server/services/reviews";

export async function setReviewStatusAction(interactionId: string, status: ReviewCheckStatus) {
  try {
    const res = await setReviewStatus(await requireRole(MANAGERS), interactionId, status);
    if (res.ok) {
      revalidatePath("/admin/reviews");
      revalidatePath("/admin/scorecard");
    }
    return res;
  } catch (e) {
    if (!(e instanceof AuthorisationError)) console.error("[reviews]", e);
    return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
  }
}
