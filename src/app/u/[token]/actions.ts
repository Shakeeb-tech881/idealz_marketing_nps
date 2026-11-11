"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { optOutWithToken } from "@/server/services/offers";

export async function stopOffersAction(token: string) {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Only a hash of the address is used for rate limiting.
  const key = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  try {
    return await optOutWithToken(String(token), key);
  } catch (e) {
    console.error("[stop-offers]", e);
    return { ok: false as const, error: "Something went wrong. Please try again." };
  }
}
