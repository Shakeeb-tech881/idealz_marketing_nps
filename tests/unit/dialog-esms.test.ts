import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DialogEsmsSmsProvider, __resetDialogEsmsState, newTransactionId, toEsmsMobile } from "@/lib/messaging/dialog-esms";

/**
 * A fake eSMS server that behaves as described in "eSMS API Document v3.2"
 * (login → token, POST /sms with Bearer token, documented error codes).
 * Exercised over real HTTP so headers and JSON are checked on the wire.
 */
type Req = { path: string; auth: string | null; body: Record<string, unknown> };
let server: Server;
let base = "";
let requests: Req[] = [];
let script: { login?: (b: Record<string, unknown>) => object; sms?: (r: Req, n: number) => object } = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const r: Req = { path: req.url ?? "", auth: (req.headers.authorization as string) ?? null, body: data ? JSON.parse(data) : {} };
      requests.push(r);
      res.setHeader("Content-Type", "application/json");
      if (r.path === "/api/v2/user/login") {
        res.end(JSON.stringify(script.login?.(r.body) ?? { status: "success", comment: "You have logged in", token: "tok-1", remainingCount: null, expiration: 43200, errCode: "" }));
        return;
      }
      if (r.path === "/api/v2/sms") {
        const n = requests.filter((x) => x.path === "/api/v2/sms").length;
        res.end(
          JSON.stringify(
            script.sms?.(r, n) ?? {
              status: "success",
              comment: "Campaign Created",
              data: { campaignId: 9000 + n, campaignCost: 1.2, walletBalance: 500, duplicatesRemoved: 0, invalidNumbers: 0, mask_blocked_numbers: 0 },
              errCode: "",
            },
          ),
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  __resetDialogEsmsState();
  requests = [];
  script = {};
});

const provider = (over: Partial<ConstructorParameters<typeof DialogEsmsSmsProvider>[0]> = {}) =>
  new DialogEsmsSmsProvider({
    username: "947XXXXXXXX",
    password: "secret",
    sourceAddress: "iDealzLanka",
    paymentMethod: 0,
    loginUrl: `${base}/api/v2/user/login`,
    apiBaseUrl: `${base}/api/v2`,
    ...over,
  });
const msg = { to: "+94771234567", body: "Hi Kasun, thank you for choosing iDealz Lanka!", reference: "log-1" };
const smsCalls = () => requests.filter((r) => r.path === "/api/v2/sms");
const loginCalls = () => requests.filter((r) => r.path === "/api/v2/user/login");

describe("Dialog eSMS adapter (eSMS API v3.2)", () => {
  test("number format and transaction ids", () => {
    expect(toEsmsMobile("+94771234567")).toBe("771234567");
    expect(toEsmsMobile("+94112345678")).toBeNull(); // landline
    expect(toEsmsMobile("+447700900123")).toBeNull(); // foreign
    const a = newTransactionId();
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(String(a).length).toBeLessThanOrEqual(18);
  });

  test("logs in, then sends exactly the documented request", async () => {
    const r = await provider().send(msg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.providerMessageId).toBe("9001");
      expect(r.providerStatus).toContain("Accepted by Dialog eSMS");
    }
    expect(loginCalls()[0].body).toEqual({ username: "947XXXXXXXX", password: "secret" });
    const sent = smsCalls()[0];
    expect(sent.auth).toBe("Bearer tok-1");
    expect(sent.body.msisdn).toEqual([{ mobile: "771234567" }]);
    expect(sent.body.sourceAddress).toBe("iDealzLanka");
    expect(sent.body.message).toBe(msg.body);
    expect(sent.body.payment_method).toBe(0);
    expect(typeof sent.body.transaction_id).toBe("number");
    expect(sent.body).not.toHaveProperty("push_notification_url");
  });

  test("reuses the token and uses a new transaction id for every SMS", async () => {
    const p = provider();
    await p.send(msg);
    await p.send({ ...msg, to: "+94761234567" });
    expect(loginCalls()).toHaveLength(1);
    const ids = smsCalls().map((c) => c.body.transaction_id);
    expect(new Set(ids).size).toBe(2);
  });

  test("expired token (100): logs in again and resends with a new transaction id", async () => {
    let logins = 0;
    script.login = () => ({ status: "success", token: `tok-${++logins}`, expiration: 43200, remainingCount: null, errCode: "" });
    script.sms = (r, n) =>
      n === 1
        ? { status: "failed", comment: "Invalid Token", data: "", errCode: "100" }
        : { status: "success", data: { campaignId: 77 }, errCode: "" };
    const r = await provider().send(msg);
    expect(r.ok).toBe(true);
    expect(loginCalls()).toHaveLength(2);
    expect(smsCalls()[1].auth).toBe("Bearer tok-2");
    expect(smsCalls()[0].body.transaction_id).not.toBe(smsCalls()[1].body.transaction_id);
  });

  test("wrong password (115) never retries the login, protecting the 5-attempt lock", async () => {
    script.login = () => ({ status: "failed", comment: "Invalid credentials", token: null, remainingCount: 4, expiration: null, errCode: 115 });
    const p = provider();
    const r1 = await p.send(msg);
    const r2 = await p.send(msg);
    expect(r1.ok || r2.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.errorCode).toBe("115");
      expect(r1.retryable).toBe(false);
    }
    expect(loginCalls()).toHaveLength(1);
    expect(smsCalls()).toHaveLength(0);
    expect(p.configurationProblems().join(" ")).toMatch(/redeploy/);
  });

  test("blackout period (118) is reported clearly and later sends fail fast", async () => {
    script.sms = () => ({ status: "failed", comment: "blackout", data: "", errCode: "118" });
    const p = provider();
    const r = await p.send(msg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe("118");
      expect(r.errorMessage).toMatch(/8 PM and 8 AM/);
      expect(r.retryable).toBe(true);
    }
    const again = await p.send(msg);
    expect(again.ok).toBe(false);
    expect(smsCalls()).toHaveLength(1); // second one never hit the API
  });

  test("insufficient balance (114) and blocked/invalid number (109)", async () => {
    script.sms = () => ({ status: "failed", comment: "x", data: "", errCode: "109" });
    const r = await provider().send(msg);
    expect(!r.ok && r.errorCode === "109" && r.retryable === false).toBe(true);
    __resetDialogEsmsState();
    script.sms = () => ({ status: "failed", comment: "x", data: "", errCode: "114" });
    const b = await provider().send(msg);
    expect(!b.ok && /top up/i.test(b.errorMessage)).toBe(true);
  });

  test("transaction id collision (104) is retried once with a fresh id", async () => {
    script.sms = (r, n) => (n === 1 ? { status: "failed", data: "", errCode: "104" } : { status: "success", data: { campaignId: 5 }, errCode: "" });
    const r = await provider().send(msg);
    expect(r.ok).toBe(true);
    expect(smsCalls()).toHaveLength(2);
  });

  test("network failure is reported as unknown outcome, never as sent", async () => {
    const p = provider({ apiBaseUrl: "http://127.0.0.1:1/api/v2" });
    script.login = undefined;
    const r = await p.send(msg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("NETWORK_ERROR");
  });

  test("refuses to send without configuration or to non-Sri Lankan numbers", async () => {
    const r = await provider({ password: "" }).send(msg);
    expect(!r.ok && r.errorCode === "DIALOG_ESMS_NOT_CONFIGURED").toBe(true);
    const long = provider({ sourceAddress: "iDealzLankaPvt" }).configurationProblems();
    expect(long.join(" ")).toMatch(/1–11 letters or numbers/);
    const f = await provider().send({ ...msg, to: "+447700900123" });
    expect(!f.ok && f.errorCode === "INVALID_NUMBER").toBe(true);
    expect(requests).toHaveLength(0);
  });

  test("asks for delivery reports only when a webhook URL is configured", async () => {
    const p = provider({ pushNotificationUrl: "https://cx.idealz.lk/api/webhooks/sms?secret=abc&" });
    expect(p.supportsDeliveryReports).toBe(true);
    await p.send(msg);
    expect(smsCalls()[0].body.push_notification_url).toBe("https://cx.idealz.lk/api/webhooks/sms?secret=abc&");
    expect(provider().supportsDeliveryReports).toBe(false);
  });

  test("parses delivery reports (GET query) per section 3.1.4", () => {
    const p = provider();
    const q = (s: string) => new URLSearchParams(s);
    expect(p.parseDeliveryReport(q("secret=x&campaignId=25&msisdn=94771234567&status=3"))).toMatchObject({ providerMessageId: "25", status: "delivered", recipient: "771234567" });
    expect(p.parseDeliveryReport(q("campaignId=25&msisdn=94771234567&status=1"))?.status).toBe("submitted");
    expect(p.parseDeliveryReport(q("campaignId=25&msisdn=94771234567&status=2"))?.status).toBe("failed");
    expect(p.parseDeliveryReport(q("campaignId=25&msisdn=94771234567&status=4"))?.status).toBe("failed");
    expect(p.parseDeliveryReport(q("campaignId=abc&status=3"))).toBeNull();
    expect(p.parseDeliveryReport(q("campaignId=25&status=9"))).toBeNull();
  });

  test("each SMS can use its showroom's own mask", async () => {
    const p = provider();
    const r = await p.send({ ...msg, senderId: "iDealzPrime" });
    expect(r.ok && r.providerStatus?.includes("from iDealzPrime")).toBe(true);
    await p.send({ ...msg, senderId: null });
    expect(smsCalls()[0].body.sourceAddress).toBe("iDealzPrime");
    expect(smsCalls()[1].body.sourceAddress).toBe("iDealzLanka"); // default
  });

  test("rejects an invalid mask without calling eSMS, and names the mask on error 108", async () => {
    const bad = await provider().send({ ...msg, senderId: "iDealzMarino" });
    expect(!bad.ok && bad.errorCode === "INVALID_SENDER_ID").toBe(true);
    expect(requests).toHaveLength(0);
    script.sms = () => ({ status: "failed", comment: "x", data: "", errCode: "108" });
    const r = await provider().send({ ...msg, senderId: "iSeven" });
    expect(!r.ok && r.errorMessage.includes('"iSeven"')).toBe(true);
  });
});
