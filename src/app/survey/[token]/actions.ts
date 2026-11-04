"use server";

import { headers } from "next/headers";
import { submitSurvey, type SubmitResult } from "@/server/services/public-survey";

async function clientIp() {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function submitSurveyAction(token: string, answers: unknown): Promise<SubmitResult> {
  return submitSurvey(token, answers, await clientIp());
}
