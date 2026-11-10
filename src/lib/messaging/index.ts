import "server-only";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { MockSmsProvider } from "./mock";
import { DialogEsmsSmsProvider, blockedLoginMessage, type LoginBlockStore } from "./dialog-esms";
import type { SmsProvider } from "./types";

export const SMS_PROVIDER_LABELS: Record<string, string> = { mock: "Test mode", dialog_esms: "Dialog eSMS" };

/** Rejected-login record in the database, shared by every server instance (service role only). */
function dialogLoginBlockStore(): LoginBlockStore {
  const table = () => createAdminClient().from("sms_provider_state");
  return {
    async get() {
      const { data, error } = await table().select("credential_fingerprint, error_code, message, created_at").eq("provider", "dialog_esms").maybeSingle();
      if (error) throw new Error(`sms_provider_state: ${error.message}`);
      return data ? { fingerprint: data.credential_fingerprint, code: data.error_code, message: data.message, at: data.created_at } : null;
    },
    async set(b) {
      const { error } = await table().upsert({
        provider: "dialog_esms",
        credential_fingerprint: b.fingerprint,
        error_code: b.code.slice(0, 40),
        message: b.message.slice(0, 600),
        created_at: b.at,
      });
      if (error) throw new Error(`sms_provider_state: ${error.message}`);
    },
    async clear() {
      const { error } = await table().delete().eq("provider", "dialog_esms");
      if (error) throw new Error(`sms_provider_state: ${error.message}`);
    },
  };
}

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
      loginBlockStore: dialogLoginBlockStore(),
      fingerprintSecret: env.SUPABASE_SERVICE_ROLE_KEY,
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

/**
 * Status plus the shared login block (one small database read). Use on pages
 * that show whether sending works; the admin layout uses the cheaper sync version.
 */
export async function smsProviderStatusWithLogin() {
  const status = smsProviderStatus();
  const provider = getSmsProvider();
  let loginBlocked = false;
  const problems = [...status.problems];
  if (provider instanceof DialogEsmsSmsProvider) {
    try {
      const block = await provider.loginBlock();
      if (block) {
        loginBlocked = true;
        problems.push(blockedLoginMessage(block));
      }
    } catch {
      problems.push("Could not check the eSMS login status (database). Run scripts/upgrade-sms-login-block.sql if you have not yet.");
    }
  }
  return { ...status, problems, ready: problems.length === 0, loginBlocked };
}

/** Super Admin: allow one new eSMS login attempt after Dialog confirms the problem is fixed. */
export async function allowNewSmsLoginAttempt() {
  const provider = getSmsProvider();
  if (provider instanceof DialogEsmsSmsProvider) await provider.allowNewLoginAttempt();
}

export type { SmsProvider } from "./types";
