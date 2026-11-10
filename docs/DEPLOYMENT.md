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
   - Site URL: your app address, e.g. `https://cx.idealz.lk` (must match `NEXT_PUBLIC_APP_URL`). Redirect URLs: `https://cx.idealz.lk/**` (and `http://localhost:3000/**` for development).
   - **Email Templates** (Authentication → Emails): so invitation and password-reset links work on any phone or browser, replace the link in two templates:
     - *Invite user*: `<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite">Accept the invitation</a>`
     - *Reset Password*: `<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>`
     Links work once. Some company mail filters open links automatically and use them up; if a fresh link says "already used", ask the person to use "Forgot password?" and open the new email straight away.
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
| `SMS_PROVIDER` | yes | `mock` (test) or `dialog_esms` |
| `DIALOG_ESMS_USERNAME` / `DIALOG_ESMS_PASSWORD` | when `dialog_esms` | Your eSMS login. **Server only** |
| `DIALOG_ESMS_SOURCE_ADDRESS` | when `dialog_esms` | Approved SMS mask, ≤ 11 characters (e.g. `iDealzLanka`) |
| `DIALOG_ESMS_PAYMENT_METHOD` | no | `0` wallet (default) or `4` eSMS API package |
| `CRON_SECRET` | yes (prod) | Random string; Vercel Cron sends it as a Bearer token |
| `SMS_WEBHOOK_SECRET` | recommended | Enables delivery reports; random string (`openssl rand -hex 24`) |

## 6. Dialog eSMS integration

Implemented in `src/lib/messaging/dialog-esms.ts` from **eSMS API Document v3.2** (Adeona Technologies, 2026-07-01), section 3.1 "SMS via POST request":

| Step | Endpoint | Notes |
| --- | --- | --- |
| Log in | `POST https://esms.dialog.lk/api/v2/user/login` | Token valid 12 h; cached per server instance and renewed on expiry (errors 100/105/106) |
| Send | `POST https://e-sms.dialog.lk/api/v2/sms` | `msisdn: [{ mobile: "7XXXXXXXX" }]`, `sourceAddress` (mask), `message`, unique `transaction_id`, `payment_method` |
| Delivery report | `GET /api/webhooks/sms?secret=…&campaignId=…&msisdn=…&status=1-4` | Only requested when `SMS_WEBHOOK_SECRET` is set. 3 = delivered, 2/4 = failed, 1 = submitted (informational) |

Behaviour worth knowing:

- **Wrong password protection** — eSMS locks the account after 5 wrong passwords. After a credential error (115/116) the app stops trying to log in until the next deploy; Settings → SMS integration shows the reason.
- **Blackout period** — eSMS rejects campaigns roughly **8 PM – 8 AM** (error 118). Those sends are marked failed with a clear message; use **Retry** in Sending history the next morning.
- **Balance** — error 114 means the eSMS wallet needs a top-up; error 112 means the package is used up.
- "Sent" means eSMS accepted and charged the campaign; "Delivered" is only shown after an eSMS delivery report.

Go live:

1. In Vercel set `DIALOG_ESMS_USERNAME`, `DIALOG_ESMS_PASSWORD`, `DIALOG_ESMS_SOURCE_ADDRESS`, `DIALOG_ESMS_PAYMENT_METHOD`, `SMS_WEBHOOK_SECRET`, then `SMS_PROVIDER=dialog_esms`, and redeploy.
2. Settings → SMS integration should show **Ready to send: Yes**.
3. Between 8 AM and 8 PM, send one invitation to an internal phone; check **Messaging → Sending history** for "Accepted by Dialog eSMS · campaign …" and, shortly after, **Delivered**.

### One mask per showroom

Each branch has an **SMS sender ID (mask)** field (Settings → Branches). A customer's survey SMS is sent from the mask of the showroom they visited; a branch with no mask uses `DIALOG_ESMS_SOURCE_ADDRESS`. The mask used is shown in Sending history.

- Masks are **max 11 characters** and must be **approved by Dialog** first — an unapproved mask fails with error 108.
- The three main showrooms (iDealz Prime, iDealz Marino, iSeven Mobiles) are created by the database setup with empty masks.
- Templates can use `{{branch_name}}` (e.g. "thanks for visiting {{branch_name}}").
- **Brand shown to customers** (Settings → Branches) changes the name in the SMS (`{{brand_name}}`), survey questions, page header and thank-you page. iSeven Mobiles is set to "iSeven Mobiles"; iDealz Prime and iDealz Marino use the company name. Use **Preview survey** next to each branch to check.
- Existing databases: run `scripts/upgrade-showrooms.sql` once in the Supabase SQL editor.

To return to test mode at any time set `SMS_PROVIDER=mock` and redeploy (numbers ending `0000` simulate failures so retry can be tested).

**Consent:** only send to customers who have agreed to be contacted; use **Mark SMS opt-out** on the customer page when someone asks to stop. Opted-out customers are excluded from all sends.

### Upgrading an existing database

Run each script once in Supabase → SQL Editor (both are safe to re-run):

- `scripts/upgrade-showrooms.sql`: showroom SMS masks and brands (5 Nov 2026)
- `scripts/upgrade-rep-scorecard.sql`: sales rep scorecard fields (9 Nov 2026). Visits recorded before it are not counted in the scorecard.

## 7. Production checklist

- [ ] All migrations applied; `select count(*) from survey_templates` returns 2
- [ ] Sign-ups disabled; first Super Admin can sign in
- [ ] Branches and employees created (Settings)
- [ ] `npm run check` passes and `npm run build` succeeds
- [ ] Survey preview pages render on a phone
- [ ] One end-to-end test: add customer → send (mock) → open link → submit → appears in Feedback and Dashboard → second submit is rejected
- [ ] `CRON_SECRET` set; `/api/cron/maintenance` returns 401 without it
- [ ] One real SMS sent to an internal phone with `SMS_PROVIDER=dialog_esms` (between 8 AM and 8 PM) and shown as Delivered
- [ ] Privacy notice and retention period agreed with management (Settings → Data retention)
