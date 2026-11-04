# Deployment guide

Target: **Vercel** (Next.js) + **Supabase Cloud** (Postgres, Auth). Suggested domain: `feedback.idealzlanka.com`.

## 1. GitHub repository

```bash
git init && git add . && git commit -m "Initial commit"
git remote add origin git@github.com:<org>/idealz-cx.git
git push -u origin main
```

`.env*` files are git-ignored. Never commit real keys.

## 2. Supabase project

1. Create a project in the **Singapore (ap-southeast-1)** region (closest to Sri Lanka).
2. **Apply migrations** — either:
   - Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`, or
   - Dashboard → SQL editor: run each file in `supabase/migrations/` in filename order.
3. **Auth settings** (Authentication → Providers / Settings):
   - Email provider **enabled**, **“Allow new users to sign up” disabled** (users are invited by a Super Admin).
   - Site URL: `https://feedback.idealzlanka.com`; Redirect URLs: `https://feedback.idealzlanka.com/auth/callback` (and `http://localhost:3000/auth/callback` for development).
   - Configure custom SMTP (Authentication → SMTP) so invitation / reset emails come from an iDealz address.
4. **Bootstrap the first Super Admin** — create the user in Authentication → Users, then run `scripts/create-super-admin.sql`.
5. Optional logo: create a public Storage bucket (e.g. `branding`), upload the logo, paste its public URL in Settings → General.

## 3. Vercel project

1. Import the GitHub repository in Vercel (framework preset: Next.js).
2. Add the environment variables below for **Production** (and Preview if used).
3. Deploy. `vercel.json` registers the daily maintenance cron (`/api/cron/maintenance`, 02:00 Asia/Colombo) which expires stale invitations and applies the data-retention policy.

## 4. Custom domain

1. Vercel → Project → Settings → Domains → add `feedback.idealzlanka.com`.
2. At your DNS provider add the CNAME record Vercel shows (`cname.vercel-dns.com`).
3. After the certificate is issued, set `NEXT_PUBLIC_APP_URL=https://feedback.idealzlanka.com` and redeploy — survey links in SMS are built from this value, so only switch it once DNS works.

## 5. Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server only.** Never expose to the browser |
| `NEXT_PUBLIC_APP_URL` | yes | Base URL for survey links, no trailing slash |
| `SMS_PROVIDER` | yes | `mock` (test) or `reachout` |
| `REACHOUT_API_BASE_URL` / `REACHOUT_API_KEY` / `REACHOUT_API_SECRET` / `REACHOUT_SENDER_ID` | when `reachout` | From Reachout.lk; set only what their API requires |
| `CRON_SECRET` | yes (prod) | Random string; Vercel Cron sends it as a Bearer token |
| `SMS_WEBHOOK_SECRET` | if DLR used | Shared secret for `/api/webhooks/sms?secret=…` |

## 6. Reachout.lk integration

Reachout.lk (a Hutch product) does not publish its API documentation publicly; it is provided to account holders. The adapter therefore ships **locked**:

1. Obtain from Reachout.lk: API documentation, API key/credentials, and an approved **sender ID / SMS mask** (e.g. `iDealz`).
2. In `src/lib/messaging/reachout.ts` complete `REACHOUT_SPEC.sendPath`, `buildRequest()` (auth header, payload field names, recipient number format) and `interpretResponse()` (success flag, message-ID field, error codes). Set `REACHOUT_SPEC.verified = true`.
3. If Reachout supports delivery reports, implement `parseDeliveryReport()`, set `supportsDeliveryReports = true`, and register `https://feedback.idealzlanka.com/api/webhooks/sms?secret=<SMS_WEBHOOK_SECRET>` with Reachout.
4. Add a unit test with a recorded sample response, then set `SMS_PROVIDER=reachout` in Vercel and redeploy.
5. Send one invitation to an internal phone; check **Survey Messaging → Sending history** for the provider response.

Until then, `SMS_PROVIDER=mock` logs messages with a TEST badge (numbers ending `0000` simulate failures so retry can be tested).

**Consent:** only send to customers who have agreed to be contacted; use **Mark SMS opt-out** on the customer page when someone asks to stop. Opted-out customers are excluded from all sends.

## 7. Production checklist

- [ ] All migrations applied; `select count(*) from survey_templates` returns 2
- [ ] Sign-ups disabled; first Super Admin can sign in
- [ ] Branches and employees created (Settings)
- [ ] `npm run check` passes and `npm run build` succeeds
- [ ] Survey preview pages render on a phone
- [ ] One end-to-end test: add customer → send (mock) → open link → submit → appears in Feedback and Dashboard → second submit is rejected
- [ ] `CRON_SECRET` set; `/api/cron/maintenance` returns 401 without it
- [ ] Reachout adapter verified before switching `SMS_PROVIDER=reachout`
- [ ] Privacy notice and retention period agreed with management (Settings → Data retention)
