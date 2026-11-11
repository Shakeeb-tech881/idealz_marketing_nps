import { beforeAll, describe, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { as, createTestDb } from "./harness";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const U = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  mgmt: "00000000-0000-0000-0000-0000000000a2",
  bmA: "00000000-0000-0000-0000-0000000000a3",
  bmB: "00000000-0000-0000-0000-0000000000a4",
  staffA: "00000000-0000-0000-0000-0000000000a5",
  rogue: "00000000-0000-0000-0000-0000000000a6",
};
let db: PGlite;
let branchA: string, branchB: string, empA1: string, empA2: string;

async function one<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}

/** Create interaction + invitation as superuser (fixture helper). */
async function fixtureInvitation(opts: {
  branch: string; employee: string | null; purchased: boolean; mobile: string; token: string; expiresInDays?: number; sent?: boolean;
}) {
  const c = await one<{ id: string }>(
    `insert into customers (full_name, mobile) values ('Test Customer', $1)
     on conflict (mobile) where mobile is not null do update set full_name = excluded.full_name returning id`, [opts.mobile]);
  const i = await one<{ id: string }>(
    `insert into customer_interactions (customer_id, branch_id, employee_id, purchase_status, purchase_date)
     values ($1, $2, $3, $4::purchase_status, case when $4::purchase_status = 'purchased' then current_date end) returning id`,
    [c.id, opts.branch, opts.employee, opts.purchased ? "purchased" : "not_purchased"]);
  const inv = await one<{ id: string }>(
    `insert into survey_invitations (interaction_id, survey_type, token_hash, expires_at, status, sent_at)
     values ($1, $2::survey_type, $3, now() + make_interval(days => $4::int), $5::invitation_status, $6::timestamptz) returning id`,
    [i.id, opts.purchased ? "purchased" : "non_purchased", sha(opts.token), opts.expiresInDays ?? 14,
     opts.sent === false ? "created" : "sent", opts.sent === false ? null : new Date().toISOString()]);
  return { customerId: c.id, interactionId: i.id, invitationId: inv.id };
}

const submit = (token: string, answers: Record<string, unknown>) =>
  as(db, "service_role", null, async (q) =>
    (await q<{ r: { ok: boolean; error?: string } }>(
      "select public.submit_survey_response($1, $2::jsonb) r", [sha(token), JSON.stringify(answers)])).rows[0].r);

const purchasedAnswers = (nps: number) => ({
  nps_score: nps, product_satisfaction: 5, staff_service_rating: 4, overall_experience_rating: 5, additional_feedback: "Great",
});

beforeAll(async () => {
  db = await createTestDb();
  branchA = (await one<{ id: string }>(`insert into branches (name, code) values ('Colombo 03', 'COL03') returning id`)).id;
  branchB = (await one<{ id: string }>(`insert into branches (name, code) values ('Kandy', 'KDY') returning id`)).id;
  empA1 = (await one<{ id: string }>(`insert into employees (branch_id, full_name) values ($1, 'Staff A1') returning id`, [branchA])).id;
  empA2 = (await one<{ id: string }>(`insert into employees (branch_id, full_name) values ($1, 'Staff A2') returning id`, [branchA])).id;
  const users: [string, string, string | null, boolean][] = [
    [U.admin, "super_admin", null, true], [U.mgmt, "management", null, true],
    [U.bmA, "branch_manager", branchA, true], [U.bmB, "branch_manager", branchB, true],
    [U.staffA, "staff", branchA, true], [U.rogue, "super_admin", null, false],
  ];
  for (const [id, role, branch, provisioned] of users) {
    const meta: Record<string, unknown> = { role };
    if (branch) meta.branch_id = branch;
    if (provisioned) meta.provisioned = true;
    await db.query(`insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)`, [id, `${role}@x.lk`, JSON.stringify(meta)]);
  }
  await db.query(`update profiles set employee_id = $1 where id = $2`, [empA1, U.staffA]);
});

describe("profiles & roles", () => {
  test("auth trigger provisions profiles from app_metadata", async () => {
    const rows = (await db.query<{ id: string; role: string; is_active: boolean }>(`select id, role, is_active from profiles`)).rows;
    expect(rows.find((r) => r.id === U.bmA)).toMatchObject({ role: "branch_manager", is_active: true });
    // Users created without the provisioned flag (e.g. self sign-up) get no access.
    expect(rows.find((r) => r.id === U.rogue)?.is_active).toBe(false);
  });

  test("inactive users see nothing", async () => {
    const n = await as(db, "authenticated", U.rogue, async (q) => (await q(`select * from branches`)).rows.length);
    expect(n).toBe(0);
  });
});

describe("row level security", () => {
  test("anonymous users cannot read customers", async () => {
    await expect(as(db, "anon", null, (q) => q(`select * from customers`))).rejects.toThrow(/permission denied/);
  });

  test("branch manager can create customers and interactions only in own branch", async () => {
    const ok = await as(db, "authenticated", U.bmA, async (q) => {
      const c = (await q<{ id: string }>(`select public.ensure_customer('Nimal', '+94771111111') id`)).rows[0].id;
      await q(`insert into customer_interactions (customer_id, branch_id, purchase_status, created_by) values ($1, $2, 'not_purchased', $3)`, [c, branchA, U.bmA]);
      return (await q(`select * from customers where id = $1`, [c])).rows.length;
    });
    expect(ok).toBe(1);
    await expect(as(db, "authenticated", U.bmA, async (q) => {
      const c = (await q<{ id: string }>(`select public.ensure_customer('Kamal', '+94772222222') id`)).rows[0].id;
      await q(`insert into customer_interactions (customer_id, branch_id, purchase_status, created_by) values ($1, $2, 'not_purchased', $3)`, [c, branchB, U.bmA]);
    })).rejects.toThrow(/row-level security/);
  });

  test("ensure_customer de-duplicates by mobile", async () => {
    const [a, b] = await as(db, "authenticated", U.mgmt, async (q) => [
      (await q<{ id: string }>(`select public.ensure_customer('A', '+94773333333') id`)).rows[0].id,
      (await q<{ id: string }>(`select public.ensure_customer('A again', '+94773333333') id`)).rows[0].id,
    ]);
    expect(a).toBe(b);
  });

  test("authenticated users cannot mark invitations completed or call the public submit", async () => {
    const f = await fixtureInvitation({ branch: branchA, employee: empA1, purchased: true, mobile: "+94774444444", token: "guard" });
    await expect(as(db, "authenticated", U.admin, (q) =>
      q(`update survey_invitations set status = 'completed' where id = $1`, [f.invitationId]))).rejects.toThrow(/only be set by the system/);
    await expect(as(db, "authenticated", U.admin, (q) =>
      q(`select public.submit_survey_response($1, '{}'::jsonb)`, [sha("guard")]))).rejects.toThrow(/permission denied/);
    await expect(as(db, "authenticated", U.admin, (q) =>
      q(`update survey_responses set nps_score = 10`))).rejects.toThrow(/permission denied/);
  });
});

describe("invitations", () => {
  test("survey type must match purchase status", async () => {
    const c = await one<{ id: string }>(`insert into customers (full_name, mobile) values ('X', '+94775555555') returning id`);
    const i = await one<{ id: string }>(`insert into customer_interactions (customer_id, branch_id, purchase_status, purchase_date) values ($1, $2, 'purchased', current_date) returning id`, [c.id, branchA]);
    await expect(db.query(`insert into survey_invitations (interaction_id, survey_type, token_hash, expires_at) values ($1, 'non_purchased', $2, now() + interval '1 day')`, [i.id, sha("mismatch")]))
      .rejects.toThrow(/does not match/);
  });

  test("only one live invitation per interaction", async () => {
    const f = await fixtureInvitation({ branch: branchA, employee: null, purchased: true, mobile: "+94776666666", token: "dup1" });
    await expect(db.query(`insert into survey_invitations (interaction_id, survey_type, token_hash, expires_at) values ($1, 'purchased', $2, now() + interval '1 day')`, [f.interactionId, sha("dup2")]))
      .rejects.toThrow(/duplicate key/);
  });
});

describe("public survey submission", () => {
  test("valid purchased submission, then duplicate is rejected", async () => {
    await fixtureInvitation({ branch: branchA, employee: empA1, purchased: true, mobile: "+94770000001", token: "t1" });
    const opened = await as(db, "service_role", null, async (q) =>
      (await q<{ survey_type: string; state: string }>(`select * from public.open_survey_invitation($1)`, [sha("t1")])).rows[0]);
    expect(opened).toMatchObject({ survey_type: "purchased", state: "open" });
    expect(await submit("t1", purchasedAnswers(10))).toEqual({ ok: true });
    expect(await submit("t1", purchasedAnswers(3))).toEqual({ ok: false, error: "already_submitted" });
    const row = await one<{ nps_category: string; n: number }>(
      `select r.nps_category, (select count(*)::int from survey_answers a where a.response_id = r.id) n
       from survey_responses r join survey_invitations i on i.id = r.invitation_id where i.token_hash = $1`, [sha("t1")]);
    expect(row).toEqual({ nps_category: "promoter", n: 5 });
  });

  test("missing required answers are rejected", async () => {
    await fixtureInvitation({ branch: branchA, employee: empA1, purchased: true, mobile: "+94770000002", token: "t2" });
    expect(await submit("t2", { nps_score: 8, staff_service_rating: 4 })).toEqual({ ok: false, error: "invalid_answers" });
    expect(await submit("t2", { ...purchasedAnswers(11) })).toEqual({ ok: false, error: "invalid_answers" });
  });

  test("non-purchased 'other' reason requires a description", async () => {
    await fixtureInvitation({ branch: branchA, employee: empA2, purchased: false, mobile: "+94770000003", token: "t3" });
    const base = { nps_score: 4, staff_service_rating: 2, product_pricing_satisfaction: 2, non_purchase_reason: "other" };
    expect(await submit("t3", base)).toEqual({ ok: false, error: "invalid_answers" });
    // Purchased-only answers sent to a non-purchased survey are ignored, not stored.
    expect(await submit("t3", { ...base, other_reason_description: "Needed EMI", product_satisfaction: 5 })).toEqual({ ok: true });
    const r = await one<{ product_satisfaction: number | null; non_purchase_reason: string }>(
      `select product_satisfaction, non_purchase_reason from survey_responses r join survey_invitations i on i.id = r.invitation_id where i.token_hash = $1`, [sha("t3")]);
    expect(r).toEqual({ product_satisfaction: null, non_purchase_reason: "other" });
  });

  test("expired and unknown tokens are rejected", async () => {
    await fixtureInvitation({ branch: branchB, employee: null, purchased: true, mobile: "+94770000004", token: "t4", expiresInDays: -1 });
    expect(await submit("t4", purchasedAnswers(9))).toEqual({ ok: false, error: "expired" });
    expect(await submit("nope", purchasedAnswers(9))).toEqual({ ok: false, error: "invalid" });
  });

  test("rate limiter blocks after the limit", async () => {
    const results = await as(db, "service_role", null, async (q) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) out.push((await q<{ ok: boolean }>(`select public.check_rate_limit('ip:1', 3, 60) ok`)).rows[0].ok);
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("analytics & feedback workflow", () => {
  test("NPS counts are scoped by RLS", async () => {
    await fixtureInvitation({ branch: branchB, employee: null, purchased: true, mobile: "+94770000005", token: "t5" });
    expect(await submit("t5", purchasedAnswers(2))).toEqual({ ok: true });

    type O = { responses_total: string; promoters: string; detractors: string; purchased_total: string; non_purchased_total: string };
    const all = await as(db, "authenticated", U.mgmt, async (q) => (await q<O>(`select * from public.analytics_overview()`)).rows[0]);
    expect(Number(all.responses_total)).toBe(3);
    expect(Number(all.promoters)).toBe(1);
    expect(Number(all.detractors)).toBe(2);
    expect(Number(all.non_purchased_total)).toBe(1);

    const bmB = await as(db, "authenticated", U.bmB, async (q) => (await q<O>(`select * from public.analytics_overview()`)).rows[0]);
    expect(Number(bmB.responses_total)).toBe(1);

    // Staff A1 sees only responses linked to their own employee record.
    const staff = await as(db, "authenticated", U.staffA, async (q) => (await q<O>(`select * from public.analytics_overview()`)).rows[0]);
    expect(Number(staff.responses_total)).toBe(1);

    const branches = await as(db, "authenticated", U.bmA, async (q) =>
      (await q<{ branch_code: string }>(`select * from public.analytics_branch_performance()`)).rows.map((r) => r.branch_code));
    expect(branches).toEqual(["COL03"]);
  });

  test("status changes, assignments and notes are recorded in action history", async () => {
    const rid = (await one<{ id: string }>(`select r.id from survey_responses r join survey_invitations i on i.id = r.invitation_id where i.token_hash = $1`, [sha("t5")])).id;
    await as(db, "authenticated", U.bmB, async (q) => {
      await q(`update survey_responses set resolution_status = 'contact_required', assigned_to = $2 where id = $1`, [rid, U.bmB]);
      await q(`insert into feedback_notes (response_id, body, created_by) values ($1, 'Called customer', $2)`, [rid, U.bmB]);
    });
    const types = (await db.query<{ action_type: string }>(`select action_type from feedback_actions where response_id = $1 order by created_at, action_type`, [rid])).rows.map((r) => r.action_type);
    expect(types.sort()).toEqual(["assignment", "note_added", "received", "status_change"]);
    // Branch manager A cannot manage branch B feedback.
    const updated = await as(db, "authenticated", U.bmA, async (q) =>
      (await q(`update survey_responses set resolution_status = 'closed' where id = $1`, [rid])).affectedRows);
    expect(updated).toBe(0);
  });

  test("expire_stale_invitations marks only open, past-due invitations", async () => {
    const n = await as(db, "service_role", null, async (q) => (await q<{ n: number }>(`select public.expire_stale_invitations() n`)).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(0);
    const completedExpired = await one<{ n: number }>(`select count(*)::int n from survey_invitations where status = 'expired' and completed_at is not null`);
    expect(completedExpired.n).toBe(0);
  });
});

describe("showroom SMS masks", () => {
  test("the three main showrooms exist with no mask yet, and re-running the upgrade adds no duplicates", async () => {
    const before = await db.query<{ code: string; sms_sender_id: string | null }>(
      `select code, sms_sender_id from branches where code in ('PRIME','MARINO','ISEVEN') order by code`);
    expect(before.rows.map((r) => r.code)).toEqual(["ISEVEN", "MARINO", "PRIME"]);
    expect(before.rows.every((r) => r.sms_sender_id === null)).toBe(true);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.exec(readFileSync(join(__dirname, "../../scripts/upgrade-showrooms.sql"), "utf8"));
    const after = await one<{ n: number }>(`select count(*)::int as n from branches where code in ('PRIME','MARINO','ISEVEN')`);
    expect(after.n).toBe(3);
  });
  test("masks are limited to 11 valid characters", async () => {
    await db.exec(`update branches set sms_sender_id = 'iDealzPrime' where code = 'PRIME'`);
    await expect(db.exec(`update branches set sms_sender_id = 'iDealzMarino' where code = 'MARINO'`)).rejects.toThrow();
    await expect(db.exec(`update branches set sms_sender_id = 'iSeven!' where code = 'ISEVEN'`)).rejects.toThrow();
    await db.exec(`update branches set sms_sender_id = 'iSeven' where code = 'ISEVEN'`);
    const m = await one<{ sms_sender_id: string }>(`select sms_sender_id from branches where code = 'PRIME'`);
    expect(m.sms_sender_id).toBe("iDealzPrime");
  });
  test("only a Super Admin can change a showroom's mask", async () => {
    const res = await as(db, "authenticated", U.mgmt, (q) =>
      q(`update branches set sms_sender_id = 'Hacked' where code = 'PRIME' returning id`));
    expect(res.rows).toHaveLength(0);
    const ok = await as(db, "authenticated", U.admin, (q) =>
      q(`update branches set sms_sender_id = 'iDealzPrm' where code = 'PRIME' returning id`));
    expect(ok.rows).toHaveLength(1);
  });
  test("iSeven Mobiles has its own brand; iDealz showrooms use the company brand", async () => {
    const rows = await db.query<{ code: string; brand_name: string | null }>(
      `select code, brand_name from branches where code in ('PRIME','MARINO','ISEVEN') order by code`);
    expect(rows.rows).toEqual([
      { code: "ISEVEN", brand_name: "iSeven Mobiles" },
      { code: "MARINO", brand_name: null },
      { code: "PRIME", brand_name: null },
    ]);
  });
  test("SMS templates use {{brand_name}} instead of a fixed company name", async () => {
    const t = await db.query<{ body: string }>(`select body from message_templates`);
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.rows.every((r) => !r.body.includes("iDealz Lanka"))).toBe(true);
    expect(t.rows.some((r) => r.body.includes("{{brand_name}}"))).toBe(true);
    expect(t.rows.every((r) => r.body.includes("{{survey_link}}"))).toBe(true);
  });
  test("message logs record which mask was used", async () => {
    const col = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.columns where table_name = 'message_logs' and column_name = 'sender_id'`);
    expect(col.n).toBe(1);
  });
});

describe("sales rep scorecard", () => {
  test("visits recorded before the upgrade are not tracked; new ones are", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const old = await createTestDb({ before: "20261109000009" });
    const b = (await old.query<{ id: string }>(`insert into branches (name, code) values ('Old', 'OLD') returning id`)).rows[0].id;
    const c = (await old.query<{ id: string }>(`insert into customers (full_name, mobile) values ('Old', '+94770000900') returning id`)).rows[0].id;
    await old.query(`insert into customer_interactions (customer_id, branch_id, purchase_status) values ($1, $2, 'not_purchased')`, [c, b]);
    await old.exec(readFileSync(join(__dirname, "../../scripts/upgrade-rep-scorecard.sql"), "utf8"));
    await old.query(`insert into customer_interactions (customer_id, branch_id, purchase_status) values ($1, $2, 'not_purchased')`, [c, b]);
    const rows = await old.query<{ kpi_tracked: boolean; google_review: string; sales_steps: string[] }>(
      `select kpi_tracked, google_review, sales_steps from customer_interactions order by created_at, kpi_tracked`);
    expect(rows.rows).toEqual([
      { kpi_tracked: false, google_review: "not_asked", sales_steps: [] },
      { kpi_tracked: true, google_review: "not_asked", sales_steps: [] },
    ]);
    await old.close();
  });

  test("bad KPI values are rejected", async () => {
    const c = await one<{ id: string }>(`insert into customers (full_name, mobile) values ('KPI', '+94770000901') returning id`);
    const ins = (cols: string, vals: string) =>
      db.query(`insert into customer_interactions (customer_id, branch_id, purchase_status, ${cols}) values ($1, $2, ${vals})`, [c.id, branchA]);
    await expect(ins("apple_phones", "'not_purchased', 1")).rejects.toThrow(/interactions_sales_need_purchase/);
    await expect(ins("apple_phones", "'purchased', -1")).rejects.toThrow(/interactions_sales_counts/);
    await expect(ins("visit_start, visit_end", "'not_purchased', '11:00', '10:00'")).rejects.toThrow(/interactions_visit_time/);
    await expect(ins("sales_steps", "'not_purchased', array['bribed']")).rejects.toThrow(/interactions_sales_steps/);
    await expect(ins("google_review", "'not_purchased', 'maybe'")).rejects.toThrow(/interactions_google_review/);
  });

  test("analytics_rep_kpis totals tracked visits per rep, scoped by RLS", async () => {
    const c = await one<{ id: string }>(`insert into customers (full_name, mobile) values ('KPI buyer', '+94770000902') returning id`);
    const empK = (await one<{ id: string }>(`insert into employees (branch_id, full_name) values ($1, 'Rep K') returning id`, [branchA])).id;
    // First visit 3 days ago (no purchase), then a purchase today: conversion = 3 days, 30 minutes.
    await db.query(
      `insert into customer_interactions (customer_id, branch_id, employee_id, purchase_status, interaction_date, sales_steps, google_review)
       values ($1, $2, $3, 'not_purchased', current_date - 3, array['greeted','demo_given'], 'asked')`, [c.id, branchA, empK]);
    await db.query(
      `insert into customer_interactions (customer_id, branch_id, employee_id, purchase_status, purchase_date, android_phones, apple_phones,
         commission_accessories, non_commission_accessories, visit_start, visit_end, sales_steps, google_review)
       values ($1, $2, $3, 'purchased', current_date, 1, 2, 3, 1, '10:00', '10:30', array['greeted','needs_identified','demo_given','accessories_offered'], 'confirmed')`,
      [c.id, branchA, empK]);
    const fetch = (user: string) => as(db, "authenticated", user, async (q) =>
      (await q<Record<string, unknown>>(`select * from public.analytics_rep_kpis(current_date - 30, current_date, null) where employee_id = $1`, [empK])).rows[0]);
    const r = await fetch(U.bmA);
    expect(r).toMatchObject({
      visits: 2, sales: 1, android_phones: 1, apple_phones: 2, commission_accessories: 3, non_commission_accessories: 1,
      timed_visits: 1, measured_conversions: 1, reviews_asked: 2, reviews_confirmed: 1,
    });
    expect(Number(r.avg_visit_minutes)).toBe(30);
    expect(Number(r.avg_conversion_days)).toBe(3);
    expect(Number(r.avg_sales_steps)).toBe(3);
    // Another showroom's manager sees none of these visits.
    expect(Number((await fetch(U.bmB))?.visits ?? 0)).toBe(0);
    await expect(as(db, "anon", null, (q) => q(`select * from public.analytics_rep_kpis()`))).rejects.toThrow(/permission denied/);
  });

  test("the upgrade script can be run again safely", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const before = await one<{ n: number }>(`select count(*)::int n from customer_interactions where kpi_tracked`);
    await db.exec(readFileSync(join(__dirname, "../../scripts/upgrade-rep-scorecard.sql"), "utf8"));
    const after = await one<{ n: number }>(`select count(*)::int n from customer_interactions where kpi_tracked`);
    expect(after.n).toBe(before.n);
  });
});

describe("shared eSMS login block", () => {
  test("only the server (service role) can read or change it", async () => {
    const fp = "a".repeat(64);
    await as(db, "service_role", null, (q) =>
      q(`insert into sms_provider_state (provider, credential_fingerprint, error_code, message) values ('dialog_esms', $1, '115', 'Invalid credentials')`, [fp]));
    for (const user of [U.admin, U.mgmt]) {
      await expect(as(db, "authenticated", user, (q) => q(`select * from sms_provider_state`))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, "anon", null, (q) => q(`delete from sms_provider_state`))).rejects.toThrow(/permission denied/);
    await expect(db.query(`insert into sms_provider_state (provider, credential_fingerprint, error_code, message) values ('dialog_esms', 'not-hex', '115', 'x')`)).rejects.toThrow();
    const n = await as(db, "service_role", null, async (q) => (await q<{ n: number }>(`select count(*)::int n from sms_provider_state`)).rows[0].n);
    expect(n).toBe(1);
  });

  test("the upgrade script can be run again safely", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.exec(readFileSync(join(__dirname, "../../scripts/upgrade-sms-login-block.sql"), "utf8"));
    const n = await one<{ n: number }>(`select count(*)::int n from sms_provider_state`);
    expect(n.n).toBe(1);
  });
});

describe("staff record visits only for themselves", () => {
  const visit = (q: (sql: string, p?: unknown[]) => Promise<unknown>, employee: string | null) =>
    q(`insert into customer_interactions (customer_id, branch_id, employee_id, purchase_status, created_by)
       values ((select public.ensure_customer('Own visit', '+94770000950')), $1, $2, 'not_purchased', $3)`, [branchA, employee, U.staffA]);

  test("staff can credit themselves or leave it empty, but not a colleague", async () => {
    await as(db, "authenticated", U.staffA, (q) => visit(q, empA1));
    await as(db, "authenticated", U.staffA, (q) => visit(q, null));
    await expect(as(db, "authenticated", U.staffA, (q) => visit(q, empA2))).rejects.toThrow(/row-level security/);
  });

  test("staff cannot move their own visit to a colleague", async () => {
    await expect(as(db, "authenticated", U.staffA, (q) =>
      q(`update customer_interactions set employee_id = $1 where created_by = $2`, [empA2, U.staffA]))).rejects.toThrow(/row-level security/);
  });

  test("branch managers can still record visits for any rep in their showroom", async () => {
    await as(db, "authenticated", U.bmA, (q) =>
      q(`insert into customer_interactions (customer_id, branch_id, employee_id, purchase_status, created_by)
         values ((select public.ensure_customer('Mgr visit', '+94770000951')), $1, $2, 'not_purchased', $3)`, [branchA, empA2, U.bmA]));
  });

  test("the upgrade script can be run again safely", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.exec(readFileSync(join(__dirname, "../../scripts/upgrade-staff-own-visits.sql"), "utf8"));
    await expect(as(db, "authenticated", U.staffA, (q) => visit(q, empA2))).rejects.toThrow(/row-level security/);
  });
});

describe("customer insights and offers", () => {
  const insights = (user: string, args: Record<string, unknown>) =>
    as(db, "authenticated", user, async (q) =>
      (await q<{ full_name: string; models: string[]; purchases: number; latest_nps_category: string | null; offers_opt_out: boolean; total_count: number }>(
        `select * from public.customer_insights(p_q => $1, p_model => $2, p_brand => $3, p_last_purchase_before => $4::date, p_nps => $5, p_offers => $6, p_branch => $7::uuid, p_limit => 100)`,
        [args.q ?? null, args.model ?? null, args.brand ?? null, args.before ?? null, args.nps ?? null, args.offers ?? null, args.branch ?? null])).rows);
  let cOld: string;

  beforeAll(async () => {
    const mk = async (name: string, mobile: string, branch: string, model: string, daysAgo: number, optOut = false) => {
      const c = await one<{ id: string }>(`insert into customers (full_name, mobile, offers_opt_out) values ($1, $2, $3) returning id`, [name, mobile, optOut]);
      await db.query(
        `insert into customer_interactions (customer_id, branch_id, purchase_status, interaction_date, purchase_date, product_model)
         values ($1, $2, 'purchased', current_date - $3::int, current_date - $3::int, $4)`, [c.id, branch, daysAgo, model]);
      return c.id;
    };
    cOld = await mk("Insight Apple Old", "+94770000801", branchA, "iPhone 13 Pro 128GB", 400);
    await mk("Insight Android New", "+94770000802", branchB, "Samsung Galaxy S22", 30);
    await mk("Insight Opted Out", "+94770000803", branchA, "iPhone 14", 500, true);
    // A survey answer for the old Apple customer (visit today, non-purchased survey).
    await fixtureInvitation({ branch: branchA, employee: null, purchased: false, mobile: "+94770000801", token: "ins1" });
    expect(await submit("ins1", { nps_score: 3, staff_service_rating: 2, product_pricing_satisfaction: 2, non_purchase_reason: "price_too_high" })).toEqual({ ok: true });
    // The fixture helper renames customers it reuses; restore the name.
    await db.query(`update customers set full_name = 'Insight Apple Old' where mobile = '+94770000801'`);
  });

  test("filters by model, brand, last purchase age, feedback and offer permission", async () => {
    const names = (rows: { full_name: string }[]) => rows.map((r) => r.full_name).filter((n) => n.startsWith("Insight")).sort();
    expect(names(await insights(U.admin, { model: "iphone 1" }))).toEqual(["Insight Apple Old", "Insight Opted Out"]);
    expect(names(await insights(U.admin, { brand: "android" }))).toEqual(["Insight Android New"]);
    expect(names(await insights(U.admin, { brand: "apple", before: new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10) }))).toEqual(["Insight Apple Old", "Insight Opted Out"]);
    expect(names(await insights(U.admin, { model: "iphone", offers: "allowed" }))).toEqual(["Insight Apple Old"]);
    expect(names(await insights(U.admin, { q: "Insight", nps: "detractor" }))).toEqual(["Insight Apple Old"]);
    const row = (await insights(U.admin, { q: "Insight Apple Old" }))[0];
    expect(row).toMatchObject({ models: ["iPhone 13 Pro 128GB"], purchases: 1, latest_nps_category: "detractor", total_count: 1 });
  });

  test("row-level security: a branch manager only sees customers of their showroom", async () => {
    const rows = await insights(U.bmB, { q: "Insight" });
    expect(rows.map((r) => r.full_name)).toEqual(["Insight Android New"]);
  });

  test("offers: only Super Admin / Management can create, claim never hands out a customer twice", async () => {
    await expect(as(db, "authenticated", U.bmA, (q) =>
      q(`insert into offer_campaigns (name, body, created_by) values ('x', 'Hi {{optout_link}}', $1)`, [U.bmA]))).rejects.toThrow(/row-level security/);
    await expect(db.query(`insert into offer_campaigns (name, body) values ('x', 'no stop link')`)).rejects.toThrow(/check/);
    const camp = await as(db, "authenticated", U.mgmt, async (q) => {
      const c = (await q<{ id: string }>(`insert into offer_campaigns (name, body, created_by, recipient_count) values ('Upgrade', 'Hi {{optout_link}}', $1, 3) returning id`, [U.mgmt])).rows[0].id;
      for (const m of ["+94770000801", "+94770000802", "+94770000803"]) {
        await q(`insert into offer_recipients (campaign_id, customer_id) select $1, id from customers where mobile = $2`, [c, m]);
      }
      return c;
    });
    const claim = (n: number) => as(db, "authenticated", U.mgmt, async (q) => (await q<{ customer_id: string }>(`select * from public.claim_offer_recipients($1, $2)`, [camp, n])).rows);
    const first = await claim(2);
    const second = await claim(5);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((r) => r.customer_id)).size).toBe(3);
    expect(await claim(5)).toHaveLength(0);
    await expect(as(db, "authenticated", U.bmA, (q) => q(`select * from public.claim_offer_recipients($1, 5)`, [camp]))).rejects.toThrow(/not allowed/);
    // A batch that crashed long ago is marked failed (never re-sent: the SMS may already have gone out).
    await db.query(`update offer_recipients set claimed_at = now() - interval '1 hour' where campaign_id = $1 and customer_id = $2`, [camp, cOld]);
    await claim(5);
    const st = await one<{ status: string }>(`select status from offer_recipients where campaign_id = $1 and customer_id = $2`, [camp, cOld]);
    expect(st.status).toBe("failed");
  });

  test("offer SMS logs can only be written by Super Admin / Management", async () => {
    const camp = (await one<{ id: string }>(`select id from offer_campaigns limit 1`)).id;
    await expect(as(db, "authenticated", U.bmA, (q) =>
      q(`insert into message_logs (campaign_id, branch_id, provider, recipient, body_redacted, sent_by) values ($1, $2, 'mock', '+94770000801', 'x', $3)`, [camp, branchA, U.bmA]))).rejects.toThrow(/row-level security/);
    await as(db, "authenticated", U.mgmt, (q) =>
      q(`insert into message_logs (campaign_id, branch_id, provider, recipient, body_redacted, sent_by) values ($1, $2, 'mock', '+94770000801', 'x', $3)`, [camp, branchA, U.mgmt]));
  });

  test("the upgrade script can be run again safely", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await db.exec(readFileSync(join(__dirname, "../../scripts/upgrade-insights-offers.sql"), "utf8"));
    const n = await one<{ n: number }>(`select count(*)::int n from offer_recipients`);
    expect(n.n).toBe(3);
  });
});

describe("staff leave register", () => {
  let empB: string;
  beforeAll(async () => {
    empB = (await one<{ id: string }>(`insert into employees (branch_id, full_name) values ($1, 'Kandy Rep') returning id`, [branchB])).id;
  });
  const record = (user: string, employee: string, date: string, type = "sudden", proof = false) =>
    as(db, "authenticated", user, (q) =>
      q(`insert into employee_leave (employee_id, branch_id, leave_date, leave_type, proof_received) values ($1, $2, $3, $4, $5)`, [employee, branchB, date, type, proof]));

  test("branch managers record leave only for their showroom; the showroom comes from the employee", async () => {
    await record(U.bmA, empA1, "2026-11-03");
    const row = await one<{ branch_id: string; recorded_by: string }>(`select branch_id, recorded_by from employee_leave where employee_id = $1 and leave_date = '2026-11-03'`, [empA1]);
    expect(row).toEqual({ branch_id: branchA, recorded_by: U.bmA });
    await expect(record(U.bmA, empB, "2026-11-03")).rejects.toThrow(/row-level security/);
    await record(U.mgmt, empB, "2026-11-03");
  });

  test("staff cannot record leave and only see their own", async () => {
    await expect(record(U.staffA, empA1, "2026-11-04")).rejects.toThrow(/row-level security/);
    await record(U.bmA, empA2, "2026-11-04", "informed");
    const seen = await as(db, "authenticated", U.staffA, async (q) => (await q<{ employee_id: string }>(`select employee_id from employee_leave`)).rows);
    expect(seen.every((r) => r.employee_id === empA1)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });

  test("one row per rep per day; proof only for sudden leave", async () => {
    await expect(record(U.bmA, empA1, "2026-11-03")).rejects.toThrow(/employee_leave_one_per_day/);
    await expect(record(U.bmA, empA1, "2026-11-05", "informed", true)).rejects.toThrow(/employee_leave_proof_only_sudden/);
  });

  test("leave totals per rep for the scorecard", async () => {
    await record(U.bmA, empA1, "2026-11-06", "sudden", true);
    const rows = await as(db, "authenticated", U.bmA, async (q) =>
      (await q<{ employee_id: string; informed_days: number; sudden_proof_days: number; sudden_no_proof_days: number }>(
        `select * from public.analytics_rep_leave('2026-11-01', '2026-11-30', null)`)).rows);
    const a1 = rows.find((r) => r.employee_id === empA1)!;
    expect(a1).toMatchObject({ informed_days: 0, sudden_proof_days: 1, sudden_no_proof_days: 1 });
    expect(rows.find((r) => r.employee_id === empB)).toBeUndefined(); // other showroom
  });

  test("the upgrade script can be run again safely", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const before = await one<{ n: number }>(`select count(*)::int n from employee_leave`);
    await db.exec(readFileSync(join(__dirname, "../../scripts/upgrade-staff-leave.sql"), "utf8"));
    const after = await one<{ n: number }>(`select count(*)::int n from employee_leave`);
    expect(after.n).toBe(before.n);
    expect(after.n).toBe(4);
  });
});
