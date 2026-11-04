import { test, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The combined setup file must apply cleanly, in one run, on a fresh Supabase-like database.
test("setup_all_in_one.sql applies in one run", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(join(__dirname, "../../supabase/setup_all_in_one.sql"), "utf8"));
  const r = await db.query<{ n: number; fns: number }>(
    "select (select count(*)::int from public.survey_templates) n, (select count(*)::int from pg_proc where proname like 'analytics_%') fns",
  );
  expect(r.rows[0].n).toBe(2);
  expect(r.rows[0].fns).toBe(10);
});
