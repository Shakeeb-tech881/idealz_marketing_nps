# iDealz Lanka — Customer Experience & NPS Platform

Production web application for measuring customer loyalty (NPS), satisfaction and service quality across iDealz Lanka branches.

- **Public survey** — `/survey/{token}`: a 5-question, one-question-per-screen survey sent by SMS. The invitation token decides which questionnaire (purchased / non-purchased) is shown. No login.
- **Management app** — `/admin`: dashboard, customers & imports, SMS invitations, feedback inbox with follow-up workflow, NPS / marketing insights, branch & employee analytics, reports (Excel / CSV / PDF), users & roles, settings, audit log.

Stack: Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui (Base UI) · Supabase (Postgres, Auth, RLS) · Recharts · Zod · React Hook Form · Vitest · Vercel.

## Quick start (development)

```bash
npm install
cp .env.example .env.local   # fill in Supabase values; keep SMS_PROVIDER=mock
npm run dev
```

1. Create a Supabase project and apply the migrations in `supabase/migrations/` in order (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
2. Bootstrap your first Super Admin with `scripts/create-super-admin.sql`.
3. Sign in at `/login`, add branches and employees under **Settings**, then add or import customers.
4. Preview the customer survey without any data at `/survey/preview/purchased` and `/survey/preview/non_purchased`.

## Project layout

```
supabase/migrations/   SQL schema, RLS policies, survey + analytics functions, reference data
src/app/survey/        public survey (token page, thank-you, preview)
src/app/admin/         management application (server components + server actions)
src/app/api/           reports export, cron maintenance, SMS delivery webhook
src/server/services/   business logic (survey, invitations, customers, import, analytics, admin)
src/server/reports/    report datasets and CSV / Excel / PDF rendering
src/lib/               NPS engine, survey definitions & validation, messaging adapters, utilities
src/components/        survey rating components, admin UI, charts
tests/unit/            unit tests (NPS maths, validation, import parsing, templates, insights)
tests/db/              database tests: migrations + RLS + submission run in PGlite
```

## Key rules implemented

- NPS = %promoters (9–10) − %detractors (0–6) from **completed** surveys only; `N/A` when there are no responses (never shown as 0). One implementation: `src/lib/nps.ts`.
- Purchased and non-purchased questionnaires are separate; the database rejects mixed answer shapes (check constraint) and invitations whose survey type does not match the purchase status.
- One response per invitation (unique index + row lock + idempotent submit function). Tokens are 256-bit random, stored only as SHA-256 hashes, expire, and are rotated on resend.
- Every table has Row Level Security. Branch managers and staff are scoped in the database, so analytics functions (security invoker) automatically aggregate only what the user may see.
- SMS status is never overstated: “Sent” = accepted by the provider; “Delivered” only from a provider delivery report; “Opened” only when the survey page loads.
- Employees are only ranked with at least the configured minimum sample; others are listed as “insufficient sample”.

## Reachout.lk status

Reachout.lk does not publish its developer API publicly, so the adapter in `src/lib/messaging/reachout.ts` deliberately refuses to send (`REACHOUT_NOT_CONFIGURED`) until the request mapping is completed from the official documentation you receive with your account. Until then the app runs with `SMS_PROVIDER=mock`, which logs every message with a **TEST** badge and never sends. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-reachoutlk-integration).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run check` | Typecheck + lint + all tests |
| `npm test` | Unit + database tests (Vitest) |
| `npm run test:db` | Database tests only (migrations, RLS, survey submission in PGlite) |

More: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/TESTING.md](docs/TESTING.md) · [docs/DATABASE.md](docs/DATABASE.md)
