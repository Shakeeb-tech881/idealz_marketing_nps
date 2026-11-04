import type { SendSmsInput, SendSmsResult, SmsProvider } from "./types";

/**
 * Reachout.lk (Hutch) SMS adapter.
 *
 * IMPORTANT: Reachout.lk does not publish its developer API specification
 * publicly. The request/response mapping below is deliberately isolated in
 * `buildRequest` and `interpretResponse` and MUST be completed from the
 * official API documentation supplied with your Reachout.lk account before
 * SMS_PROVIDER=reachout is enabled. Until then this adapter refuses to send
 * (it never guesses an endpoint) and every attempt is logged as failed with
 * error code REACHOUT_NOT_CONFIGURED.
 *
 * Checklist to complete from the official docs:
 *   - authentication method (header / token / basic auth)
 *   - send endpoint path and HTTP method
 *   - payload field names (recipient format, sender ID / mask, message)
 *   - success response shape and message-ID field
 *   - error codes, rate limits and whether delivery reports (DLR) are pushed
 */
export interface ReachoutConfig {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  senderId?: string;
}

/** Fill in from the official Reachout.lk API docs. */
export const REACHOUT_SPEC = {
  /** e.g. "/sms/send" — set once verified against the official docs. */
  sendPath: null as string | null,
  method: "POST" as const,
  verified: false,
};

export class ReachoutSmsProvider implements SmsProvider {
  readonly name = "reachout";
  readonly isTest = false;
  readonly supportsDeliveryReports = false; // set true once DLR support is confirmed

  constructor(private readonly config: ReachoutConfig) {}

  configurationProblems(): string[] {
    const problems: string[] = [];
    if (!this.config.baseUrl) problems.push("REACHOUT_API_BASE_URL is not set");
    if (!this.config.apiKey) problems.push("REACHOUT_API_KEY is not set");
    if (!this.config.senderId) problems.push("REACHOUT_SENDER_ID is not set");
    if (!REACHOUT_SPEC.verified || !REACHOUT_SPEC.sendPath) {
      problems.push("Request mapping not yet verified against the official Reachout.lk API documentation");
    }
    return problems;
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const problems = this.configurationProblems();
    if (problems.length > 0) {
      return {
        ok: false,
        errorCode: "REACHOUT_NOT_CONFIGURED",
        errorMessage: problems.join("; "),
        retryable: false,
        raw: null,
      };
    }
    const req = this.buildRequest(input);
    let res: Response;
    try {
      res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      return {
        ok: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: e instanceof Error ? e.message : "Network error",
        retryable: true,
        raw: null,
      };
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* non-JSON response kept as text */
    }
    return this.interpretResponse(res.status, body);
  }

  /** Map our input to the provider request. Complete from official docs. */
  private buildRequest(input: SendSmsInput): { url: string; init: RequestInit } {
    const url = new URL(REACHOUT_SPEC.sendPath!, this.config.baseUrl).toString();
    return {
      url,
      init: {
        method: REACHOUT_SPEC.method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ to: input.to, message: input.body, sender: this.config.senderId }),
      },
    };
  }

  /** Interpret the provider response. Complete from official docs. */
  private interpretResponse(httpStatus: number, body: unknown): SendSmsResult {
    if (httpStatus >= 200 && httpStatus < 300) {
      return { ok: true, providerMessageId: null, providerStatus: `HTTP ${httpStatus}`, raw: body };
    }
    return {
      ok: false,
      errorCode: `HTTP_${httpStatus}`,
      errorMessage: typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300),
      retryable: httpStatus === 429 || httpStatus >= 500,
      raw: body,
    };
  }
}
