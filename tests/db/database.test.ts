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
