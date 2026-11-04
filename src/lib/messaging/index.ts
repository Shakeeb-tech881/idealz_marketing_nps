import "server-only";
import { serverEnv } from "@/lib/env";
import { MockSmsProvider } from "./mock";
import { ReachoutSmsProvider } from "./reachout";
import type { SmsProvider } from "./types";

export function getSmsProvider(): SmsProvider {
  const env = serverEnv();
  if (env.SMS_PROVIDER === "reachout") {
    return new ReachoutSmsProvider({
      baseUrl: env.REACHOUT_API_BASE_URL,
      apiKey: env.REACHOUT_API_KEY,
      apiSecret: env.REACHOUT_API_SECRET,
      senderId: env.REACHOUT_SENDER_ID,
    });
  }
  return new MockSmsProvider();
}

export function smsProviderStatus() {
  const provider = getSmsProvider();
  const problems = provider instanceof ReachoutSmsProvider ? provider.configurationProblems() : [];
  return {
    name: provider.name,
    isTest: provider.isTest,
    supportsDeliveryReports: provider.supportsDeliveryReports,
    ready: problems.length === 0,
    problems,
  };
}

export type { SmsProvider } from "./types";
