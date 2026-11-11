"use server";

import { revalidatePath } from "next/cache";
import { AuthorisationError, ORG_WIDE, requireRole } from "@/lib/auth";
import { cancelCampaign, createCampaign, pauseCampaign, previewAudience, sendCampaignBatch } from "@/server/services/offers";

function fail(e: unknown) {
  if (!(e instanceof AuthorisationError)) console.error("[offers]", e);
  return { ok: false as const, error: e instanceof Error ? e.message : "Unexpected error" };
}

export async function previewAudienceAction(filters: Record<string, string>, body: string) {
  try {
    const actor = await requireRole(ORG_WIDE);
    return { ok: true as const, data: await previewAudience(actor, filters, body) };
  } catch (e) {
    return fail(e);
  }
}

export async function createCampaignAction(input: unknown) {
  try {
    const actor = await requireRole(ORG_WIDE);
    const res = await createCampaign(actor, input);
    if (res.ok) revalidatePath("/admin/offers");
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function sendCampaignBatchAction(campaignId: string) {
  try {
    const actor = await requireRole(ORG_WIDE);
    return await sendCampaignBatch(actor, campaignId);
  } catch (e) {
    return fail(e);
  }
}

export async function pauseCampaignAction(campaignId: string) {
  try {
    const actor = await requireRole(ORG_WIDE);
    const res = await pauseCampaign(actor, campaignId);
    revalidatePath(`/admin/offers/${campaignId}`);
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function cancelCampaignAction(campaignId: string) {
  try {
    const actor = await requireRole(ORG_WIDE);
    const res = await cancelCampaign(actor, campaignId);
    revalidatePath(`/admin/offers/${campaignId}`);
    revalidatePath("/admin/offers");
    return res;
  } catch (e) {
    return fail(e);
  }
}
