import type { SendSmsInput, SendSmsResult, SmsProvider } from "./types";

/**
 * Development / test provider. Never sends a real SMS. Every log written by
 * it is flagged is_test = true and shown with a TEST badge in the UI.
 * Numbers ending in 0000 simulate a provider rejection so failure handling and
 * retries can be exercised.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly isTest = true;
  readonly supportsDeliveryReports = false;

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    if (input.to.endsWith("0000")) {
      return {
        ok: false,
        errorCode: "MOCK_REJECTED",
        errorMessage: "Simulated provider rejection (test number ending in 0000)",
        retryable: true,
        raw: { mock: true, to: input.to },
      };
    }
    return {
      ok: true,
      providerMessageId: `mock-${input.reference}`,
      providerStatus: "accepted (test – not sent)",
      raw: { mock: true, to: input.to, length: input.body.length },
    };
  }
}
