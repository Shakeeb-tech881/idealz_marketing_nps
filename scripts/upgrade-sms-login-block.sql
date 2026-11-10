-- =============================================================================
-- UPGRADE for an EXISTING database: shared eSMS login block (10 Nov 2026)
-- New installs don't need this — it is already in setup_all_in_one.sql.
--
-- Stops every server from retrying a rejected Dialog eSMS password, protecting
-- the account from Dialog's 5-attempt lock.
--
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- =============================================================================

begin;


-- ----- 20261110000010_sms_login_block.sql -----
-- =============================================================================
-- Shared SMS provider state: a rejected eSMS login.
--
-- Dialog eSMS locks the account after 5 wrong passwords. When a login is
-- rejected, the app records it here so EVERY server instance stops trying the
-- same username + password (an in-memory flag only protects one instance).
-- The fingerprint is an HMAC of the credentials keyed with a server-side
-- secret — nothing password-derived that can be guessed offline is stored.
--
-- Only the server (service role) uses this table: no policies, no API grants.
-- =============================================================================

create table if not exists public.sms_provider_state (
  provider               text primary key check (provider in ('dialog_esms')),
  credential_fingerprint text not null check (credential_fingerprint ~ '^[0-9a-f]{64}$'),
  error_code             text not null check (length(error_code) <= 40),
  message                text not null check (length(message) <= 600),
  created_at             timestamptz not null default now()
);

alter table public.sms_provider_state enable row level security;
revoke all on public.sms_provider_state from public, anon, authenticated;
grant select, insert, update, delete on public.sms_provider_state to service_role;

commit;

-- Check: should return 0 rows
-- select provider, error_code, created_at from public.sms_provider_state;
