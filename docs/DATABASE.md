# Database design

All tables live in `public`, use UUID primary keys (except `audit_logs`), `timestamptz` (UTC) and have RLS enabled.

```
branches 1─* employees
branches 1─* customer_interactions *─1 customers
employees 1─* customer_interactions
customer_interactions 1─* survey_invitations   (max one non-expired at a time)
survey_invitations 1─0..1 survey_responses     (unique invitation_id)
survey_responses 1─* survey_answers / feedback_notes / feedback_actions
survey_invitations 1─* message_logs
profiles (1:1 auth.users) ─ branch_id, employee_id
survey_templates / message_templates / system_settings / audit_logs / rate_limits
```

| Table | Purpose |
| --- | --- |
| `profiles` | App users: role (`super_admin`, `management`, `branch_manager`, `staff`), branch, linked employee, active flag |
| `branches`, `employees` | Organisation structure |
| `customers` | One row per person, unique E.164 mobile; SMS opt-out; anonymised by retention |
| `customer_interactions` | Each purchase / visit (status, dates, product, invoice unique per branch, source, employee) |
| `survey_templates` | Versioned question copy for each survey type |
| `message_templates` | SMS templates; must contain `{{survey_link}}`; one default per type |
| `survey_invitations` | SHA-256 token hash, expiry, status lifecycle, send count; snapshot of customer / branch / employee |
| `survey_responses` | One wide row per completed survey; generated `nps_category`; check constraint enforces the purchased / non-purchased shape; follow-up status & assignee |
| `survey_answers` | Normalised per-question answers |
| `message_logs` | Every SMS attempt, provider response, test flag; links redacted |
| `feedback_notes`, `feedback_actions` | Internal notes and automatic action history |
| `audit_logs` | Administrative actions (exports, sends, settings, users) |
| `system_settings` | Key/value configuration (expiry, thresholds, retention…) |
| `rate_limits` | Fixed-window counters for public endpoints |

Key functions: `submit_survey_response` (atomic, idempotent, service role), `open_survey_invitation`, `check_rate_limit`, `expire_stale_invitations`, `apply_data_retention`, `ensure_customer`, and the `analytics_*` family (security invoker, so RLS scopes every aggregate).
