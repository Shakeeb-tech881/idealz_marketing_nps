import "server-only";
import { serverEnv } from "@/lib/env";
import { MockSmsProvider } from "./mock";
import { DialogEsmsSmsProvider } from "./dialog-esms";
import type { SmsProvider } from "./types";

export const SMS_PROVIDER_LABELS: Record<string, string> = { mock: "Test mode", dialog_esms: "Dialog eSMS" };

export function getSmsProvider(): SmsProvider {
  const env = serverEnv();
  if (env.SMS_PROVIDER === "dialog_esms") {
    // Delivery reports are only requested when a webhook secret is configured.
    // eSMS appends "campaignId=…&msisdn=…&status=…" to this URL, so it ends with "&".
    const push = env.SMS_WEBHOOK_SECRET
      ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/sms?secret=${encodeURIComponent(env.SMS_WEBHOOK_SECRET)}&`
      : null;
    return new DialogEsmsSmsProvider({
      username: env.DIALOG_ESMS_USERNAME,
      password: env.DIALOG_ESMS_PASSWORD,
      sourceAddress: env.DIALOG_ESMS_SOURCE_ADDRESS,
      paymentMethod: env.DIALOG_ESMS_PAYMENT_METHOD,
      loginUrl: env.DIALOG_ESMS_LOGIN_URL,
      apiBaseUrl: env.DIALOG_ESMS_API_BASE_URL,
      pushNotificationUrl: push,
    });
  }
  return new MockSmsProvider();
}

export function smsProviderStatus() {
  const provider = getSmsProvider();
  const problems = provider.configurationProblems?.() ?? [];
  return {
    name: provider.name,
    label: SMS_PROVIDER_LABELS[provider.name] ?? provider.name,
    isTest: provider.isTest,
    supportsDeliveryReports: provider.supportsDeliveryReports,
    ready: problems.length === 0,
    problems,
  };
}

export type { SmsProvider } from "./types";
