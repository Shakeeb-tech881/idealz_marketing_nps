# Testing

```bash
npm run check      # typecheck + lint + all tests
npm test           # all Vitest suites
npm run test:db    # database suite only
```

## Automated coverage

### Database (`tests/db/database.test.ts`)
Runs every migration in an in-process Postgres (PGlite) with Supabase's `auth` schema, roles and grants emulated, then exercises the real SQL:

| Area | Checks |
| --- | --- |
| Auth & roles | profiles provisioned from `app_metadata`; self-registered users inactive; inactive users see nothing |
| RLS | anon cannot read customers; branch manager can only write own branch; staff only see their own responses; branch analytics scoped |
| Customers | `ensure_customer` de-duplicates by mobile |
| Invitations | survey type must match purchase status; one live invitation per interaction; status `completed` cannot be set by users |
| Submission | valid purchased submission; duplicate rejected; missing answers rejected; out-of-range NPS rejected; “Other” reason needs text; purchased-only answers ignored on non-purchased survey; expired and unknown tokens rejected; authenticated users cannot call the public submit function |
| Rate limiting | blocks after the limit |
| Analytics | promoter/detractor counts, purchased vs non-purchased separation |
| Follow-up | status / assignment / note history is recorded; other branches cannot update |

### Unit (`tests/unit/`)
NPS maths (spec example +45, zero vs no data, rounding, bounds), survey definitions (exactly 5 questions, no mixing), answer validation, Sri Lankan mobile normalisation, customer form rules, import column guessing and date / status parsing, SMS template rendering, link redaction and segment counting, mock provider failures, Dialog eSMS adapter against a fake eSMS server (login/token reuse, token expiry, wrong-password lock protection, blackout, balance, delivery-report parsing), keyword themes, insight generation never guessing without data / below sample thresholds.

## Manual test plan (staging)

Use `SMS_PROVIDER=mock`. After **Send survey** the app shows the test survey link (test mode only) so you can open and submit it; preview pages are available for UI checks.

**Survey** — `/survey/preview/purchased` and `/survey/preview/non_purchased` on iPhone, Android and desktop:
- NPS 11 boxes, colour bands, endpoints, keyboard arrows; emoji and star selection by tap and keyboard; selected label shown
- Next blocked until required answer chosen; Previous keeps answers; progress “Question n of 5” updates
- Non-purchased: “Other” shows required text field
- Optional feedback can be left empty; submit shows the thank-you page

**Invitation flow** — add customer → Send survey → open link → submit → re-open link shows “already shared”; try a modified token → “couldn’t find”; set expiry to 1 day and back-date `expires_at` in SQL → “expired”.

**Messaging** — bulk send 3 customers incl. one number ending `0000` → 2 sent / 1 failed; Retry from Sending history; sending again to the same customers is skipped (“Already invited”); opted-out customer excluded.

**Import** — upload the template CSV with: a valid row, bad mobile, unknown branch, duplicate invoice, duplicate row in file → preview shows each status; error report downloads; only valid rows imported.

**Analytics** — compare dashboard NPS with a manual calculation from the Detractor/Overall export; change each filter and confirm KPIs and charts change; branch manager sees only their branch; staff cannot open Dashboard/Reports.

**Exports** — download each report in Excel, CSV and PDF; values match the screen; staff-masked mobiles.

**Security** — call `/api/reports` signed out (403); `/api/cron/maintenance` without secret (401); `/admin` signed out redirects to login; confirm no `SUPABASE_SERVICE_ROLE_KEY` / Dialog eSMS credentials appear in browser bundles (`grep` the `.next/static` output).
