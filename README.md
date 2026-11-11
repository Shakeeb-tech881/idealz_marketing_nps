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
- **Rep Scorecard** (`/admin/scorecard`) grades each salesperson A+ to Fail from device sales, accessories (commission ×1.5), conversion rate, Google reviews, sales steps and customer feedback. No targets: each rep is compared with the showroom average (average = 75). Reps with fewer than 10 tracked visits are flagged red as **Low activity** (not graded) for follow-up. Download as PDF from the page, or as PDF/Excel/CSV from Reports → Sales Rep Scorecard. Logic in `src/lib/kpi.ts`.

## Staff leave

- **Staff Leave** (`/admin/leave`, managers): record days off per sales rep as *informed in advance*, *sudden – proof received* or *sudden – no proof* (tick + note; documents stay in the HR file).
- Rep Scorecard: device sales and accessories are compared **per working day** (days off don't count against a rep); each sudden day **without proof** takes 5 points off the final score (max 25). Proof received later removes the penalty.
- Upgrade an existing database with `scripts/upgrade-staff-leave.sql`.

## Customer Insights & Offers

- **Customer Insights** (`/admin/insights`, managers): one row per customer with showrooms, models bought, purchases, latest NPS, staff rating and comment. Filter by model (e.g. “iPhone 15”), brand, category, showroom, last-purchase age, feedback group and offer permission; export to Excel/PDF.
- **Customer page**: 360° summary, every survey answer, and all SMS sent (survey and offers).
- **Offers** (`/admin/offers`, Super Admin / Management): bulk SMS to a filtered audience. The audience is fixed when the offer is saved; sending runs in batches and pauses on account problems (8 PM–8 AM blackout, wallet balance, login, daily limit). Every offer must contain `{{optout_link}}` — a one-tap “Stop offers” page (`/u/<token>`). Customers who stopped offers or SMS are always excluded.
- Upgrade an existing database with `scripts/upgrade-insights-offers.sql`.

## SMS provider (Dialog eSMS)

SMS are sent through **Dialog eSMS** (`src/lib/messaging/dialog-esms.ts`, built from the official eSMS API document v3.2). With `SMS_PROVIDER=mock` (the default) the app logs every message with a **TEST** badge, never sends, and shows the survey link to the sender so the survey can be tested end to end. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-dialog-esms-integration) to go live.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run check` | Typecheck + lint + all tests |
| `npm test` | Unit + database tests (Vitest) |
| `npm run test:db` | Database tests only (migrations, RLS, survey submission in PGlite) |

More: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/TESTING.md](docs/TESTING.md) · [docs/DATABASE.md](docs/DATABASE.md)
