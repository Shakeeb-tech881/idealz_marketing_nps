/**
 * Messaging provider abstraction. Providers must only report the states they
 * actually know: "sent" means the provider accepted the message, never that
 * it was delivered. "delivered" is only set from a provider delivery report.
 */
export interface SendSmsInput {
  to: string; // E.164
  body: string;
  reference: string; // our message log id, for correlation
}

export type SendSmsResult =
  | {
      ok: true;
      providerMessageId: string | null;
      providerStatus: string | null;
      raw: unknown;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      raw: unknown;
    };

export interface DeliveryReport {
  providerMessageId: string;
  status: "delivered" | "failed";
  providerStatus: string;
  occurredAt: Date;
  raw: unknown;
}

export interface SmsProvider {
  readonly name: string;
  /** True for providers that never contact a real network (development / testing). */
  readonly isTest: boolean;
  /** Whether the provider can push delivery reports to our webhook. */
  readonly supportsDeliveryReports: boolean;
  send(input: SendSmsInput): Promise<SendSmsResult>;
  /** Parse a delivery-report webhook payload, or null if not recognised. */
  parseDeliveryReport?(payload: unknown): DeliveryReport | null;
}
