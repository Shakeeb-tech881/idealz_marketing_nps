import { createHash, createHmac, randomInt } from "node:crypto";
import type { DeliveryReport, SendSmsInput, SendSmsResult, SmsProvider } from "./types";

/**
 * Dialog eSMS (Adeona Technologies) — implemented from "eSMS API Document v3.2"
 * (2026-07-01), section 3.1 "SMS via POST request":
 *
 *   Login   POST https://esms.dialog.lk/api/v2/user/login   { username, password } → { token, expiration }
 *   Send    POST https://e-sms.dialog.lk/api/v2/sms          Authorization: Bearer <token>
 *           { msisdn: [{ mobile: "7XXXXXXXX" }], message, sourceAddress, transaction_id, payment_method, push_notification_url? }
 *   DLR     GET  <push_notification_url>campaignId=…&msisdn=…&status=1|2|3|4
 *
 * Notes from the document that shape this adapter:
 *  - Tokens last 12 h; log in only initially and on expiry (codes 100/105/106).
 *  - 5 wrong passwords lock the account, so after a credential error (102/115/116)
 *    no further login is attempted with the same username and password. The block
 *    is kept in a shared LoginBlockStore (the database) so every server instance
 *    respects it — not only the one that saw the error.
 *  - transaction_id must be unique for every request, even retries (error 104).
 *  - Campaigns cannot be created during the blackout period, generally 8 PM – 8 AM (error 118).
 *  - "success" means the campaign was created and paid for — not that the SMS was delivered.
 */

export interface DialogEsmsConfig {
  username?: string;
  password?: string;
  /** SMS mask shown to the customer, e.g. "iDealzLanka" (max 11 characters). */
  sourceAddress?: string;
  /** 0 = pay from eSMS wallet (default), 4 = pay from an eSMS API package. */
  paymentMethod?: number;
  loginUrl?: string;
  apiBaseUrl?: string;
  /** Full delivery-report URL ending in "?" or "&" (eSMS appends campaignId=…). */
  pushNotificationUrl?: string | null;
  /** Shared record of a rejected login, so all server instances stop trying. */
  loginBlockStore?: LoginBlockStore | null;
  /** Server-side secret used to fingerprint the credentials (HMAC), so the stored block never contains anything password-derived that could be guessed offline. */
  fingerprintSecret?: string;
  fetchImpl?: typeof fetch;
}

/** A rejected login for one specific username + password (identified by fingerprint). */
export interface LoginBlock {
  fingerprint: string;
  code: string;
  message: string;
  at: string;
}

export interface LoginBlockStore {
  get(): Promise<LoginBlock | null>;
  set(block: LoginBlock): Promise<void>;
  clear(): Promise<void>;
}

export const DIALOG_ESMS_DEFAULTS = {
  loginUrl: "https://esms.dialog.lk/api/v2/user/login",
  apiBaseUrl: "https://e-sms.dialog.lk/api/v2",
} as const;

const TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

/** Error codes from section 3.1.5 → message shown to staff and whether a later retry can succeed. */
const ERROR_CODES: Record<string, { message: string; retryable: boolean }> = {
  "100": { message: "Access token expired", retryable: true },
  "101": { message: "Invalid request parameters", retryable: false },
  "102": { message: "eSMS user account not found or not valid", retryable: false },
  "103": { message: "No campaign found for this transaction ID", retryable: false },
  "104": { message: "Transaction ID already used", retryable: true },
  "105": { message: "Invalid token signature", retryable: true },
  "106": { message: "Token missing from request", retryable: true },
  "107": { message: "A mandatory parameter is missing or invalid", retryable: false },
  "108": { message: "The sender ID (mask) is not active on this eSMS account", retryable: false },
  "109": { message: "Mobile number is invalid or has blocked messages from this sender ID", retryable: false },
  "110": { message: "Account is not eligible to use an eSMS package – set DIALOG_ESMS_PAYMENT_METHOD=0", retryable: false },
  "111": { message: "Package payments can only be used for campaigns scheduled for this month", retryable: false },
  "112": { message: "Not enough SMS left in the eSMS package", retryable: true },
  "113": { message: "eSMS package maintenance downtime – try again later", retryable: true },
  "114": { message: "Not enough eSMS wallet balance – top up the account, then retry", retryable: true },
  "115": { message: "eSMS username or password is wrong", retryable: false },
  "116": { message: "eSMS account is locked", retryable: false },
  "117": { message: "Too many requests to eSMS – wait a minute, then retry", retryable: true },
  "118": { message: "Dialog eSMS does not send between 8 PM and 8 AM – retry after 8 AM", retryable: true },
  "119": { message: "Postpaid wallet limit reached on the eSMS account", retryable: true },
  "999": { message: "Dialog eSMS internal server error – retry later", retryable: true },
};

const TOKEN_ERRORS = new Set(["100", "105", "106"]);
const CREDENTIAL_ERRORS = new Set(["102", "115", "116"]);
/** Account-wide conditions: stop calling the API for a while so a bulk send fails fast. */
const PAUSE_MS: Record<string, number> = { "113": 5 * 60_000, "114": 2 * 60_000, "117": 60_000, "118": 10 * 60_000, "119": 5 * 60_000 };

// Process-wide state (one per server instance). Never sent to the browser.
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
let loginInFlight: Promise<LoginResult> | null = null;
let credentialsRejected: LoginBlock | null = null;
let pausedUntil: { until: number; code: string; message: string } | null = null;

/** Test helper: reset process-wide state. */
export function __resetDialogEsmsState() {
  tokenCache = null;
  loginInFlight = null;
  credentialsRejected = null;
  pausedUntil = null;
}

type LoginResult = { ok: true; token: string } | { ok: false; code: string; message: string; retryable: boolean; raw?: Record<string, unknown> | null };

/** Message shown while a rejected login is blocking further attempts. */
export function blockedLoginMessage(b: Pick<LoginBlock, "message" | "at">): string {
  const when = new Date(b.at);
  const at = Number.isNaN(when.getTime())
    ? ""
    : ` on ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when)}`;
  return (
    `Login blocked to protect the eSMS account: Dialog rejected the username or password${at} (${b.message}). ` +
    "Correct DIALOG_ESMS_USERNAME / DIALOG_ESMS_PASSWORD in Vercel and redeploy, or – if Dialog fixed it on their side – a Super Admin can allow one new attempt in Settings → Integrations."
  );
}

/** +94771234567 → "771234567" (the 9-digit format eSMS requires). Null if not a Sri Lankan mobile. */
export function toEsmsMobile(e164: string): string | null {
  const m = /^\+94(7\d{8})$/.exec(e164.trim());
  return m ? m[1] : null;
}

/** Dialog masks: up to 11 characters, starting with a letter or number. */
export function isValidMask(mask: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9 .&-]{0,10}$/.test(mask);
}

/** Unique positive integer, 16 digits (within the 18-digit limit and JS safe-integer range). */
export function newTransactionId(): number {
  return Date.now() * 1000 + randomInt(0, 1000);
}

function errorFor(code: string, fallback?: string) {
  const known = ERROR_CODES[code];
  return known ?? { message: fallback || `eSMS error ${code}`, retryable: true };
}

export class DialogEsmsSmsProvider implements SmsProvider {
  readonly name = "dialog_esms";
  readonly isTest = false;
  readonly supportsDeliveryReports: boolean;
  private readonly cfg: Required<Omit<DialogEsmsConfig, "fetchImpl" | "pushNotificationUrl" | "loginBlockStore">> & { pushNotificationUrl: string | null };
  private readonly store: LoginBlockStore | null;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DialogEsmsConfig) {
    this.cfg = {
      username: config.username?.trim() ?? "",
      password: config.password ?? "",
      sourceAddress: config.sourceAddress?.trim() ?? "",
      paymentMethod: config.paymentMethod ?? 0,
      loginUrl: config.loginUrl || DIALOG_ESMS_DEFAULTS.loginUrl,
      apiBaseUrl: (config.apiBaseUrl || DIALOG_ESMS_DEFAULTS.apiBaseUrl).replace(/\/$/, ""),
      pushNotificationUrl: config.pushNotificationUrl ?? null,
      fingerprintSecret: config.fingerprintSecret ?? "",
    };
    this.store = config.loginBlockStore ?? null;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.supportsDeliveryReports = !!this.cfg.pushNotificationUrl;
  }

  configurationProblems(): string[] {
    const p: string[] = [];
    if (!this.cfg.username) p.push("DIALOG_ESMS_USERNAME is not set");
    if (!this.cfg.password) p.push("DIALOG_ESMS_PASSWORD is not set");
    if (!this.cfg.sourceAddress) p.push("DIALOG_ESMS_SOURCE_ADDRESS (SMS mask, e.g. iDealzLanka) is not set");
    else if (!isValidMask(this.cfg.sourceAddress)) p.push("DIALOG_ESMS_SOURCE_ADDRESS must be 1–11 letters or numbers (e.g. iDealzLanka)");
    if (![0, 4].includes(this.cfg.paymentMethod)) p.push("DIALOG_ESMS_PAYMENT_METHOD must be 0 (wallet) or 4 (API package)");
    // With a shared store the block is checked asynchronously (loginBlock()).
    if (!this.store && credentialsRejected?.fingerprint === this.credentialKey()) p.push(blockedLoginMessage(credentialsRejected));
    return p;
  }

  private credentialKey() {
    const data = `${this.cfg.username}\u0000${this.cfg.password}`;
    return this.cfg.fingerprintSecret
      ? createHmac("sha256", this.cfg.fingerprintSecret).update(data).digest("hex")
      : createHash("sha256").update(data).digest("hex");
  }

  /** The block that applies to the current username + password, if any. The shared store is authoritative. */
  async loginBlock(): Promise<LoginBlock | null> {
    const key = this.credentialKey();
    if (!this.store) return credentialsRejected?.fingerprint === key ? credentialsRejected : null;
    const b = await this.store.get();
    if (b?.fingerprint === key) {
      credentialsRejected = b;
      return b;
    }
    // Cleared by a Super Admin, or the credentials were changed: forget any local copy.
    if (credentialsRejected?.fingerprint === key) credentialsRejected = null;
    return null;
  }

  /** Super Admin action once Dialog confirms the problem is fixed: permits one new login attempt. */
  async allowNewLoginAttempt(): Promise<void> {
    credentialsRejected = null;
    tokenCache = null;
    if (this.store) await this.store.clear();
  }

  private async postJson(url: string, body: unknown, token?: string): Promise<{ httpOk: boolean; status: number; json: Record<string, unknown> | null }> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { httpOk: res.ok, status: res.status, json };
  }

  private async login(): Promise<LoginResult> {
    const key = this.credentialKey();
    if (tokenCache?.key === key && tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return { ok: true, token: tokenCache.token };
    }
    if (loginInFlight) return loginInFlight;
    loginInFlight = (async (): Promise<LoginResult> => {
      try {
        let block: LoginBlock | null;
        try {
          block = await this.loginBlock();
        } catch (e) {
          // Can't confirm it is safe to try the password: don't risk a lock-out.
          console.error("[dialog-esms] login block check failed", e);
          return { ok: false, code: "ESMS_LOGIN_CHECK_FAILED", message: "Could not check the eSMS login status – try again in a minute", retryable: true };
        }
        if (block) return { ok: false, code: "ESMS_LOGIN_BLOCKED", message: blockedLoginMessage(block), retryable: false };

        const { json, status } = await this.postJson(this.cfg.loginUrl, { username: this.cfg.username, password: this.cfg.password });
        const token = typeof json?.token === "string" ? json.token : null;
        if (json?.status === "success" && token) {
          const seconds = Number(json.expiration) > 0 ? Number(json.expiration) : 43_200;
          tokenCache = { key, token, expiresAt: Date.now() + seconds * 1000 };
          return { ok: true, token };
        }
        const code = String(json?.errCode ?? "").trim() || `HTTP_${status}`;
        const comment = typeof json?.comment === "string" ? json.comment.trim().slice(0, 160) : "";
        const remaining = typeof json?.remainingCount === "number" ? json.remainingCount : null;
        const err = errorFor(code, comment || undefined);
        // Dialog's own wording and the attempts left, so staff know where they stand.
        const detail = [
          err.message,
          comment && comment.toLowerCase() !== err.message.toLowerCase() ? `Dialog says: "${comment}"` : null,
          remaining !== null ? `${remaining} login attempt${remaining === 1 ? "" : "s"} left before Dialog locks the account` : null,
        ].filter(Boolean).join(" – ");
        // The token is never part of a failed reply, but only keep the documented fields.
        const raw = { stage: "login", errCode: json?.errCode ?? null, comment: comment || null, remainingCount: remaining, httpStatus: status };
        // A wrong password counts towards the 5-attempt lock: never retry with the same credentials.
        // eSMS returns remainingCount (a number) only when a password attempt was counted.
        if (CREDENTIAL_ERRORS.has(code) || remaining !== null) {
          const b: LoginBlock = { fingerprint: key, code, message: detail, at: new Date().toISOString() };
          credentialsRejected = b;
          try {
            await this.store?.set(b);
          } catch (e) {
            console.error("[dialog-esms] could not save login block", e);
          }
          return { ok: false, code, message: detail, retryable: false, raw };
        }
        return { ok: false, code, message: `eSMS login failed: ${detail}`, retryable: true, raw };
      } catch (e) {
        return { ok: false, code: "NETWORK_ERROR", message: `Could not reach Dialog eSMS to log in (${(e as Error).name})`, retryable: true };
      } finally {
        loginInFlight = null;
      }
    })();
    return loginInFlight;
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const problems = this.configurationProblems();
    if (problems.length) {
      return { ok: false, errorCode: "DIALOG_ESMS_NOT_CONFIGURED", errorMessage: problems.join("; "), retryable: false, raw: null, notAttempted: true };
    }
    const mobile = toEsmsMobile(input.to);
    if (!mobile) {
      return { ok: false, errorCode: "INVALID_NUMBER", errorMessage: "Dialog eSMS only sends to Sri Lankan mobile numbers (+947…)", retryable: false, raw: null };
    }
    const sourceAddress = input.senderId?.trim() || this.cfg.sourceAddress;
    if (!isValidMask(sourceAddress)) {
      return { ok: false, errorCode: "INVALID_SENDER_ID", errorMessage: `SMS mask "${sourceAddress}" is not valid – use 1–11 letters or numbers (Settings → Branches)`, retryable: false, raw: null };
    }
    if (pausedUntil && pausedUntil.until > Date.now()) {
      return { ok: false, errorCode: pausedUntil.code, errorMessage: pausedUntil.message, retryable: true, raw: { skipped: "account temporarily paused after previous error" }, notAttempted: true };
    }

    let tokenRetried = false;
    let txnRetried = false;
    for (;;) {
      const auth = await this.login();
      if (!auth.ok) return { ok: false, errorCode: auth.code, errorMessage: auth.message, retryable: auth.retryable, raw: auth.raw ?? null, notAttempted: true };

      const transactionId = newTransactionId();
      const body: Record<string, unknown> = {
        msisdn: [{ mobile }],
        sourceAddress,
        message: input.body,
        transaction_id: transactionId,
        payment_method: this.cfg.paymentMethod,
      };
      if (this.cfg.pushNotificationUrl) body.push_notification_url = this.cfg.pushNotificationUrl;

      let reply: Awaited<ReturnType<DialogEsmsSmsProvider["postJson"]>>;
      try {
        reply = await this.postJson(`${this.cfg.apiBaseUrl}/sms`, body, auth.token);
      } catch (e) {
        // The request may or may not have reached eSMS — say so rather than guess.
        return {
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: `No response from Dialog eSMS (${(e as Error).name}). The SMS may or may not have been sent – check the eSMS portal before retrying.`,
          retryable: true,
          raw: { transaction_id: transactionId },
        };
      }

      const json = reply.json;
      const raw = { transaction_id: transactionId, http_status: reply.status, response: json };
      if (json?.status === "success") {
        const data = (json.data && typeof json.data === "object" ? json.data : {}) as Record<string, unknown>;
        const campaignId = data.campaignId != null ? String(data.campaignId) : null;
        const cost = data.campaignCost != null ? ` · cost LKR ${data.campaignCost}` : "";
        return { ok: true, providerMessageId: campaignId, providerStatus: `Accepted by Dialog eSMS · from ${sourceAddress}${campaignId ? ` · campaign ${campaignId}` : ""}${cost}`, raw };
      }

      const code = String(json?.errCode ?? "").trim() || (reply.httpOk ? "UNKNOWN" : `HTTP_${reply.status}`);
      if (TOKEN_ERRORS.has(code) && !tokenRetried) {
        tokenRetried = true;
        tokenCache = null;
        continue; // log in again and resend with a new transaction ID
      }
      if (code === "104" && !txnRetried) {
        txnRetried = true;
        continue; // our freshly generated ID collided — use a new one
      }
      const base = errorFor(code, typeof json?.comment === "string" ? json.comment : undefined);
      const err = code === "108" ? { ...base, message: `The SMS mask "${sourceAddress}" is not approved/active on your eSMS account` } : base;
      if (PAUSE_MS[code]) pausedUntil = { until: Date.now() + PAUSE_MS[code], code, message: err.message };
      return { ok: false, errorCode: code, errorMessage: err.message, retryable: err.retryable, raw };
    }
  }

  /**
   * Delivery report pushed by eSMS as a GET request (section 3.1.4):
   * campaignId, msisdn, status — 1 submitted to SMSC, 2 submission failed,
   * 3 delivered, 4 delivery failed. Order is not guaranteed.
   */
  parseDeliveryReport(payload: unknown): DeliveryReport | null {
    const get = (k: string): string | null => {
      if (payload instanceof URLSearchParams) return payload.get(k);
      if (payload && typeof payload === "object" && k in payload) {
        const v = (payload as Record<string, unknown>)[k];
        return v == null ? null : String(v);
      }
      return null;
    };
    const campaignId = get("campaignId")?.trim();
    const status = get("status")?.trim();
    const msisdn = get("msisdn")?.trim() ?? "";
    if (!campaignId || !/^\d+$/.test(campaignId) || !status) return null;
    const map: Record<string, { status: DeliveryReport["status"]; label: string }> = {
      "1": { status: "submitted", label: "Submitted to network (SMSC)" },
      "2": { status: "failed", label: "Submission failed – number not valid or connectivity failure" },
      "3": { status: "delivered", label: "Delivered" },
      "4": { status: "failed", label: "Delivery failed" },
    };
    const m = map[status];
    if (!m) return null;
    return {
      providerMessageId: campaignId,
      status: m.status,
      providerStatus: `${m.label} (eSMS status ${status})`,
      occurredAt: new Date(),
      recipient: msisdn ? msisdn.replace(/\D/g, "").slice(-9) : null,
      raw: { campaignId, msisdn, status },
    };
  }
}
