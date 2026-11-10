/**
 * Messaging provider abstraction. Providers must only report the states they
 * actually know: "sent" means the provider accepted the message, never that
 * it was delivered. "delivered" is only set from a provider delivery report.
 */
export interface SendSmsInput {
  to: string; // E.164
  body: string;
  reference: string; // our message log id, for correlation
  /** SMS mask for this message (e.g. the showroom's). Null/empty = provider default. */
  senderId?: string | null;
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
      /** True when no SMS request reached the provider (setup problem, blocked login…): the send is not counted against the invitation's 5-send limit. */
      notAttempted?: boolean;
    };

export interface DeliveryReport {
  providerMessageId: string;
  /** "submitted" is informational (handed to the network) and never overrides a final state. */
  status: "submitted" | "delivered" | "failed";
  providerStatus: string;
  occurredAt: Date;
  /** Local part of the recipient number if the provider sends it, for cross-checking. */
  recipient?: string | null;
  raw: unknown;
}

export interface SmsProvider {
  readonly name: string;
  /** True for providers that never contact a real network (development / testing). */
  readonly isTest: boolean;
  /** Whether the provider can push delivery reports to our webhook. */
  readonly supportsDeliveryReports: boolean;
  send(input: SendSmsInput): Promise<SendSmsResult>;
  /** Parse a delivery-report webhook payload (JSON body or URL query), or null if not recognised. */
  parseDeliveryReport?(payload: unknown): DeliveryReport | null;
  /** Missing / invalid configuration, shown on Settings → SMS integration. */
  configurationProblems?(): string[];
}
