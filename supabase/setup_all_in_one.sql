-- =============================================================================
-- iDealz Lanka CX & NPS Platform — COMPLETE DATABASE SETUP (all migrations)
--
-- HOW TO USE
--   Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--   Run it ONCE on a new, empty project. It runs in a single transaction:
--   if anything fails, nothing is created and you can safely run it again.
--
-- AFTERWARDS
--   1. Authentication → Users → Add user (tick "Auto Confirm User")
--   2. Run scripts/create-super-admin.sql with your email to make that user Super Admin.
--
-- Generated from supabase/migrations/*.sql — edit those files, not this one.
-- =============================================================================

begin;


-- #############################################################################
-- 20261104000001_schema.sql
-- #############################################################################

-- =============================================================================
-- iDealz Lanka CX & NPS Platform — core schema
-- All timestamps are stored as timestamptz (UTC). Display in Asia/Colombo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('super_admin', 'management', 'branch_manager', 'staff');
create type public.purchase_status as enum ('purchased', 'not_purchased');
create type public.survey_type as enum ('purchased', 'non_purchased');
create type public.invitation_status as enum (
  'created', 'pending', 'sent', 'delivered', 'failed', 'opened', 'completed', 'expired'
);
create type public.nps_category as enum ('promoter', 'passive', 'detractor');
create type public.resolution_status as enum (
  'new', 'under_review', 'contact_required', 'resolved', 'closed'
);
create type public.non_purchase_reason as enum (
  'price_too_high',
  'product_unavailable',
  'other_brands_models',
  'better_offer_elsewhere',
  'still_comparing',
  'not_ready',
  'payment_financing',
  'customer_service',
  'other'
);
create type public.message_status as enum ('queued', 'sent', 'delivered', 'failed');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Branches & employees
-- ---------------------------------------------------------------------------
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  code        text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  city        text,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index branches_code_key on public.branches (code);
create unique index branches_name_key on public.branches (lower(name));
create trigger branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

create table public.employees (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches (id) on delete restrict,
  full_name      text not null check (length(trim(full_name)) between 1 and 160),
  employee_code  text check (employee_code is null or employee_code ~ '^[A-Za-z0-9_-]{1,30}$'),
  job_title      text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index employees_code_key on public.employees (upper(employee_code)) where employee_code is not null;
create index employees_branch_idx on public.employees (branch_id);
create trigger employees_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text not null default '',
  role         public.app_role not null default 'staff',
  branch_id    uuid references public.branches (id) on delete set null,
  employee_id  uuid references public.employees (id) on delete set null,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- branch-scoped roles must be attached to a branch while active
  constraint profiles_branch_scope check (
    role in ('super_admin', 'management') or branch_id is not null or not is_active
  )
);
create index profiles_branch_idx on public.profiles (branch_id);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when an auth user is created.
-- Role / branch come from app_metadata, which only the service role can set.
-- Self sign-up must be disabled in Supabase Auth settings; any user created
-- without app_metadata gets an inactive staff profile with no access.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role   public.app_role;
  v_branch uuid;
begin
  begin
    v_role := coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'staff');
  exception when others then
    v_role := 'staff';
  end;
  v_branch := nullif(new.raw_app_meta_data ->> 'branch_id', '')::uuid;

  insert into public.profiles (id, email, full_name, role, branch_id, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    v_branch,
    coalesce((new.raw_app_meta_data ->> 'provisioned')::boolean, false)
      and (v_role in ('super_admin', 'management') or v_branch is not null)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Customers & interactions (one customer, many purchases / visits)
-- ---------------------------------------------------------------------------
create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(trim(full_name)) between 1 and 200),
  -- E.164, e.g. +94771234567. Null only after anonymisation (data retention).
  mobile          text check (mobile is null or mobile ~ '^\+[1-9][0-9]{7,14}$'),
  email           text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  sms_opt_out     boolean not null default false,
  sms_opt_out_at  timestamptz,
  anonymised_at   timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint customers_mobile_required check (mobile is not null or anonymised_at is not null)
);
create unique index customers_mobile_key on public.customers (mobile) where mobile is not null;
create index customers_name_idx on public.customers (lower(full_name));
create index customers_created_idx on public.customers (created_at desc);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.customer_interactions (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.customers (id) on delete restrict,
  branch_id         uuid not null references public.branches (id) on delete restrict,
  employee_id       uuid references public.employees (id) on delete set null,
  purchase_status   public.purchase_status not null,
  interaction_date  date not null default ((now() at time zone 'Asia/Colombo')::date),
  purchase_date     date,
  product_category  text check (product_category is null or length(product_category) <= 80),
  product_model     text check (product_model is null or length(product_model) <= 160),
  invoice_number    text check (invoice_number is null or length(invoice_number) between 1 and 60),
  source            text not null default 'walk_in' check (
    source in ('walk_in', 'phone_call', 'whatsapp', 'website', 'social_media', 'referral', 'other')
  ),
  notes             text check (notes is null or length(notes) <= 1000),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint interactions_purchase_fields check (
    purchase_status = 'purchased'
    or (purchase_date is null and invoice_number is null)
  )
);
-- The same invoice cannot be recorded twice in a branch (duplicate import protection).
create unique index interactions_invoice_key
  on public.customer_interactions (branch_id, upper(trim(invoice_number)))
  where invoice_number is not null;
create index interactions_customer_idx on public.customer_interactions (customer_id);
create index interactions_branch_idx on public.customer_interactions (branch_id, interaction_date desc);
create index interactions_employee_idx on public.customer_interactions (employee_id);
create index interactions_category_idx on public.customer_interactions (product_category);
create trigger interactions_updated_at before update on public.customer_interactions
  for each row execute function public.set_updated_at();

-- Employee must belong to the interaction's branch.
create or replace function public.check_interaction_employee()
returns trigger language plpgsql as $$
begin
  if new.employee_id is not null and not exists (
    select 1 from public.employees e where e.id = new.employee_id and e.branch_id = new.branch_id
  ) then
    raise exception 'Employee does not belong to the selected branch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger interactions_employee_branch
  before insert or update of employee_id, branch_id on public.customer_interactions
  for each row execute function public.check_interaction_employee();

-- ---------------------------------------------------------------------------
-- Survey templates (question copy, versioned) & SMS message templates
-- ---------------------------------------------------------------------------
create table public.survey_templates (
  id           uuid primary key default gen_random_uuid(),
  survey_type  public.survey_type not null,
  version      integer not null default 1,
  title        text not null,
  questions    jsonb not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (survey_type, version)
);
create unique index survey_templates_one_active on public.survey_templates (survey_type) where is_active;

create table public.message_templates (
  id           uuid primary key default gen_random_uuid(),
  survey_type  public.survey_type not null,
  name         text not null check (length(trim(name)) between 1 and 120),
  body         text not null check (length(body) between 10 and 640 and position('{{survey_link}}' in body) > 0),
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index message_templates_one_default on public.message_templates (survey_type) where is_default;
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Survey invitations (one per interaction; token stored only as SHA-256 hash)
-- ---------------------------------------------------------------------------
create table public.survey_invitations (
  id              uuid primary key default gen_random_uuid(),
  interaction_id  uuid not null references public.customer_interactions (id) on delete restrict,
  customer_id     uuid not null references public.customers (id) on delete restrict,
  branch_id       uuid not null references public.branches (id) on delete restrict,
  employee_id     uuid references public.employees (id) on delete set null,
  survey_type     public.survey_type not null,
  template_id     uuid references public.survey_templates (id) on delete set null,
  token_hash      text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status          public.invitation_status not null default 'created',
  expires_at      timestamptz not null,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  opened_at       timestamptz,
  completed_at    timestamptz,
  failed_at       timestamptz,
  last_error      text,
  send_count      integer not null default 0,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index survey_invitations_token_key on public.survey_invitations (token_hash);
-- Duplicate-send protection: only one live (non-expired) invitation per interaction.
create unique index survey_invitations_one_live
  on public.survey_invitations (interaction_id) where status <> 'expired';
create index survey_invitations_branch_idx on public.survey_invitations (branch_id, created_at desc);
create index survey_invitations_status_idx on public.survey_invitations (status);
create index survey_invitations_customer_idx on public.survey_invitations (customer_id);
create trigger survey_invitations_updated_at before update on public.survey_invitations
  for each row execute function public.set_updated_at();

-- Snapshot customer / branch / employee from the interaction and make sure
-- the survey type matches the purchase status (no mixing of questionnaires).
create or replace function public.prepare_invitation()
returns trigger language plpgsql as $$
declare
  i public.customer_interactions;
begin
  select * into i from public.customer_interactions where id = new.interaction_id;
  if not found then
    raise exception 'Interaction not found' using errcode = '23503';
  end if;
  new.customer_id := i.customer_id;
  new.branch_id   := i.branch_id;
  new.employee_id := i.employee_id;
  if (i.purchase_status = 'purchased' and new.survey_type <> 'purchased')
     or (i.purchase_status = 'not_purchased' and new.survey_type <> 'non_purchased') then
    raise exception 'Survey type % does not match purchase status %', new.survey_type, i.purchase_status
      using errcode = '23514';
  end if;
  if new.template_id is null then
    select id into new.template_id from public.survey_templates
      where survey_type = new.survey_type and is_active;
  end if;
  return new;
end $$;
create trigger survey_invitations_prepare
  before insert on public.survey_invitations
  for each row execute function public.prepare_invitation();

-- ---------------------------------------------------------------------------
-- Survey responses (one per invitation) & normalised answers
-- ---------------------------------------------------------------------------
create table public.survey_responses (
  id                            uuid primary key default gen_random_uuid(),
  invitation_id                 uuid not null references public.survey_invitations (id) on delete restrict,
  survey_type                   public.survey_type not null,
  customer_id                   uuid not null references public.customers (id) on delete restrict,
  interaction_id                uuid not null references public.customer_interactions (id) on delete restrict,
  branch_id                     uuid not null references public.branches (id) on delete restrict,
  employee_id                   uuid references public.employees (id) on delete set null,
  nps_score                     smallint not null check (nps_score between 0 and 10),
  nps_category                  public.nps_category generated always as (
    case when nps_score >= 9 then 'promoter'::public.nps_category
         when nps_score >= 7 then 'passive'::public.nps_category
         else 'detractor'::public.nps_category end
  ) stored,
  staff_service_rating          smallint not null check (staff_service_rating between 1 and 5),
  -- purchased survey only
  product_satisfaction          smallint check (product_satisfaction between 1 and 5),
  overall_experience_rating     smallint check (overall_experience_rating between 1 and 5),
  -- non-purchased survey only
  product_pricing_satisfaction  smallint check (product_pricing_satisfaction between 1 and 5),
  non_purchase_reason           public.non_purchase_reason,
  other_reason_description      text check (other_reason_description is null or length(other_reason_description) <= 500),
  additional_feedback           text check (additional_feedback is null or length(additional_feedback) <= 2000),
  submitted_at                  timestamptz not null default now(),
  -- follow-up workflow
  resolution_status             public.resolution_status not null default 'new',
  assigned_to                   uuid references public.profiles (id) on delete set null,
  follow_up_due                 date,
  updated_at                    timestamptz not null default now(),
  constraint survey_responses_shape check (
    (
      survey_type = 'purchased'
      and product_satisfaction is not null
      and overall_experience_rating is not null
      and product_pricing_satisfaction is null
      and non_purchase_reason is null
      and other_reason_description is null
    ) or (
      survey_type = 'non_purchased'
      and product_pricing_satisfaction is not null
      and non_purchase_reason is not null
      and product_satisfaction is null
      and overall_experience_rating is null
      and (
        (non_purchase_reason = 'other' and length(trim(coalesce(other_reason_description, ''))) > 0)
        or (non_purchase_reason <> 'other' and other_reason_description is null)
      )
    )
  )
);
create unique index survey_responses_invitation_key on public.survey_responses (invitation_id);
create index survey_responses_submitted_idx on public.survey_responses (submitted_at desc);
create index survey_responses_branch_idx on public.survey_responses (branch_id, submitted_at desc);
create index survey_responses_employee_idx on public.survey_responses (employee_id, submitted_at desc);
create index survey_responses_category_idx on public.survey_responses (nps_category);
create index survey_responses_resolution_idx on public.survey_responses (resolution_status);
create trigger survey_responses_updated_at before update on public.survey_responses
  for each row execute function public.set_updated_at();

create table public.survey_answers (
  id              uuid primary key default gen_random_uuid(),
  response_id     uuid not null references public.survey_responses (id) on delete cascade,
  question_key    text not null,
  question_order  smallint not null check (question_order between 1 and 5),
  numeric_value   smallint,
  text_value      text,
  created_at      timestamptz not null default now(),
  unique (response_id, question_key)
);

-- ---------------------------------------------------------------------------
-- Messaging logs
-- ---------------------------------------------------------------------------
create table public.message_logs (
  id                   uuid primary key default gen_random_uuid(),
  invitation_id        uuid references public.survey_invitations (id) on delete set null,
  customer_id          uuid references public.customers (id) on delete set null,
  branch_id            uuid references public.branches (id) on delete set null,
  provider             text not null,
  is_test              boolean not null default false,
  recipient            text not null,
  -- the survey token is replaced by [survey-link] before logging
  body_redacted        text not null,
  status               public.message_status not null default 'queued',
  provider_message_id  text,
  provider_status      text,
  provider_response    jsonb,
  error_code           text,
  error_message        text,
  attempt              integer not null default 1,
  sent_by              uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index message_logs_invitation_idx on public.message_logs (invitation_id);
create index message_logs_created_idx on public.message_logs (created_at desc);
create index message_logs_status_idx on public.message_logs (status);
create index message_logs_provider_msg_idx on public.message_logs (provider, provider_message_id);
create trigger message_logs_updated_at before update on public.message_logs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Feedback follow-up: notes and action history
-- ---------------------------------------------------------------------------
create table public.feedback_notes (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references public.survey_responses (id) on delete cascade,
  body         text not null check (length(trim(body)) between 1 and 4000),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index feedback_notes_response_idx on public.feedback_notes (response_id, created_at);

create table public.feedback_actions (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references public.survey_responses (id) on delete cascade,
  action_type  text not null check (
    action_type in ('received', 'status_change', 'assignment', 'note_added', 'follow_up_scheduled')
  ),
  from_status  public.resolution_status,
  to_status    public.resolution_status,
  assigned_to  uuid references public.profiles (id) on delete set null,
  due_date     date,
  details      text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index feedback_actions_response_idx on public.feedback_actions (response_id, created_at);

-- ---------------------------------------------------------------------------
-- Audit log, settings, rate limiting
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create table public.system_settings (
  key          text primary key check (key ~ '^[a-z_]{2,60}$'),
  value        jsonb not null,
  description  text,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);
create trigger system_settings_updated_at before update on public.system_settings
  for each row execute function public.set_updated_at();

create table public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          integer not null
);

-- #############################################################################
-- 20261104000002_security.sql
-- #############################################################################

-- =============================================================================
-- Access helpers, Row Level Security, grants, audit and feedback history
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Access helper functions (SECURITY DEFINER so policies can read profiles
-- without recursive RLS evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.current_branch_id()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'super_admin', false)
$$;

-- Super admins and management see every branch.
create or replace function public.is_org_wide()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() in ('super_admin', 'management'), false)
$$;

-- Can the current user write records for this branch?
create or replace function public.can_write_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_wide()
      or (public.current_app_role() in ('branch_manager', 'staff') and p_branch = public.current_branch_id())
$$;

-- Can the current user read a record that belongs to a branch / employee?
-- Staff only see records linked to their own employee record or created by them.
create or replace function public.can_access_record(p_branch uuid, p_employee uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_app_role()
    when 'super_admin' then true
    when 'management' then true
    when 'branch_manager' then p_branch = public.current_branch_id()
    when 'staff' then p_branch = public.current_branch_id()
      and (
        (p_employee is not null and p_employee = public.current_employee_id())
        or (p_created_by is not null and p_created_by = auth.uid())
      )
    else false
  end
$$;

-- Can the current user manage the feedback follow-up workflow for a branch?
create or replace function public.can_manage_feedback(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_wide()
      or (public.current_app_role() = 'branch_manager' and p_branch = public.current_branch_id())
$$;

-- ---------------------------------------------------------------------------
-- Audit logging
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null and current_user not in ('service_role', 'postgres') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), left(p_action, 80), left(p_entity_type, 60), left(p_entity_id, 120), coalesce(p_details, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Customer de-duplication: find (by mobile) or create a customer.
-- Runs as definer so a branch user can link a returning customer first seen
-- at another branch without being able to read that customer's other records.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_customer(p_full_name text, p_mobile text, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_active_user() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select id into v_id from public.customers where mobile = p_mobile;
  if found then
    update public.customers
       set email = coalesce(email, nullif(trim(p_email), ''))
     where id = v_id;
    return v_id;
  end if;
  insert into public.customers (full_name, mobile, email, created_by)
  values (trim(p_full_name), p_mobile, nullif(trim(p_email), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Invitation status guard: provider/application-tracked states can only be
-- written by the service role (webhooks, public survey flow).
-- ---------------------------------------------------------------------------
create or replace function public.guard_invitation_status()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and new.status is distinct from old.status
     and new.status in ('delivered', 'opened', 'completed') then
    raise exception 'Status % can only be set by the system', new.status using errcode = '42501';
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'Completed invitations cannot change status' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger survey_invitations_status_guard
  before update on public.survey_invitations
  for each row execute function public.guard_invitation_status();

-- ---------------------------------------------------------------------------
-- Feedback action history (automatic)
-- ---------------------------------------------------------------------------
create or replace function public.track_feedback_actions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.feedback_actions (response_id, action_type, to_status, details)
    values (new.id, 'received', new.resolution_status, 'Survey response received');
    return new;
  end if;
  if new.resolution_status is distinct from old.resolution_status then
    insert into public.feedback_actions (response_id, action_type, from_status, to_status, created_by)
    values (new.id, 'status_change', old.resolution_status, new.resolution_status, auth.uid());
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.feedback_actions (response_id, action_type, assigned_to, created_by)
    values (new.id, 'assignment', new.assigned_to, auth.uid());
  end if;
  if new.follow_up_due is distinct from old.follow_up_due and new.follow_up_due is not null then
    insert into public.feedback_actions (response_id, action_type, due_date, created_by)
    values (new.id, 'follow_up_scheduled', new.follow_up_due, auth.uid());
  end if;
  return new;
end $$;
create trigger survey_responses_track_insert
  after insert on public.survey_responses
  for each row execute function public.track_feedback_actions();
create trigger survey_responses_track_update
  after update of resolution_status, assigned_to, follow_up_due on public.survey_responses
  for each row execute function public.track_feedback_actions();

create or replace function public.track_feedback_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.feedback_actions (response_id, action_type, details, created_by)
  values (new.response_id, 'note_added', left(new.body, 140), new.created_by);
  return new;
end $$;
create trigger feedback_notes_track
  after insert on public.feedback_notes
  for each row execute function public.track_feedback_note();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.branches              enable row level security;
alter table public.employees             enable row level security;
alter table public.profiles              enable row level security;
alter table public.customers             enable row level security;
alter table public.customer_interactions enable row level security;
alter table public.survey_templates      enable row level security;
alter table public.message_templates     enable row level security;
alter table public.survey_invitations    enable row level security;
alter table public.survey_responses      enable row level security;
alter table public.survey_answers        enable row level security;
alter table public.message_logs          enable row level security;
alter table public.feedback_notes        enable row level security;
alter table public.feedback_actions      enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.system_settings       enable row level security;
alter table public.rate_limits           enable row level security;

-- Anonymous users get nothing directly. Public survey access is server-side only.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- branches -------------------------------------------------------------------
create policy branches_select on public.branches for select to authenticated
  using (public.is_active_user());
create policy branches_admin_write on public.branches for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- employees ------------------------------------------------------------------
create policy employees_select on public.employees for select to authenticated
  using (public.is_org_wide() or branch_id = public.current_branch_id());
create policy employees_admin_write on public.employees for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- profiles -------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_org_wide()
    or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
  );
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- customers ------------------------------------------------------------------
create policy customers_select on public.customers for select to authenticated
  using (
    public.is_org_wide()
    or (public.is_active_user() and created_by = auth.uid())
    or exists (
      select 1 from public.customer_interactions ci
      where ci.customer_id = customers.id
        and public.can_access_record(ci.branch_id, ci.employee_id, ci.created_by)
    )
  );
create policy customers_update on public.customers for update to authenticated
  using (
    public.is_org_wide()
    or (public.is_active_user() and created_by = auth.uid())
    or exists (
      select 1 from public.customer_interactions ci
      where ci.customer_id = customers.id
        and public.current_app_role() = 'branch_manager'
        and ci.branch_id = public.current_branch_id()
    )
  )
  with check (public.is_active_user());
create policy customers_admin_delete on public.customers for delete to authenticated
  using (public.is_super_admin());

-- customer_interactions ------------------------------------------------------
create policy interactions_select on public.customer_interactions for select to authenticated
  using (public.can_access_record(branch_id, employee_id, created_by));
create policy interactions_insert on public.customer_interactions for insert to authenticated
  with check (public.can_write_branch(branch_id) and created_by = auth.uid());
create policy interactions_update on public.customer_interactions for update to authenticated
  using (
    public.is_org_wide()
    or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
    or (public.current_app_role() = 'staff' and created_by = auth.uid())
  )
  with check (public.can_write_branch(branch_id));
create policy interactions_admin_delete on public.customer_interactions for delete to authenticated
  using (public.is_super_admin());

-- survey_templates -----------------------------------------------------------
create policy survey_templates_select on public.survey_templates for select to authenticated
  using (public.is_active_user());
create policy survey_templates_admin_write on public.survey_templates for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- message_templates ----------------------------------------------------------
create policy message_templates_select on public.message_templates for select to authenticated
  using (public.is_active_user());
create policy message_templates_write on public.message_templates for all to authenticated
  using (public.is_org_wide()) with check (public.is_org_wide());

-- survey_invitations ---------------------------------------------------------
create policy invitations_select on public.survey_invitations for select to authenticated
  using (public.can_access_record(branch_id, employee_id, created_by));
create policy invitations_insert on public.survey_invitations for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.can_write_branch(branch_id)
    and exists (
      select 1 from public.customer_interactions ci
      where ci.id = interaction_id
        and public.can_access_record(ci.branch_id, ci.employee_id, ci.created_by)
    )
  );
create policy invitations_update on public.survey_invitations for update to authenticated
  using (public.can_access_record(branch_id, employee_id, created_by) and public.can_write_branch(branch_id))
  with check (public.can_write_branch(branch_id));

-- survey_responses -----------------------------------------------------------
create policy responses_select on public.survey_responses for select to authenticated
  using (public.can_access_record(branch_id, employee_id, null));
create policy responses_update on public.survey_responses for update to authenticated
  using (public.can_manage_feedback(branch_id))
  with check (public.can_manage_feedback(branch_id));

-- survey_answers -------------------------------------------------------------
create policy answers_select on public.survey_answers for select to authenticated
  using (exists (
    select 1 from public.survey_responses r
    where r.id = response_id and public.can_access_record(r.branch_id, r.employee_id, null)
  ));

-- message_logs ---------------------------------------------------------------
create policy message_logs_select on public.message_logs for select to authenticated
  using (
    public.is_org_wide()
    or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
    or (public.current_app_role() = 'staff' and sent_by = auth.uid())
  );
create policy message_logs_insert on public.message_logs for insert to authenticated
  with check (sent_by = auth.uid() and public.can_write_branch(branch_id));
create policy message_logs_update on public.message_logs for update to authenticated
  using (sent_by = auth.uid() and public.can_write_branch(branch_id))
  with check (public.can_write_branch(branch_id));

-- feedback_notes -------------------------------------------------------------
create policy feedback_notes_select on public.feedback_notes for select to authenticated
  using (exists (
    select 1 from public.survey_responses r
    where r.id = response_id and public.can_access_record(r.branch_id, r.employee_id, null)
  ));
create policy feedback_notes_insert on public.feedback_notes for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.survey_responses r
      where r.id = response_id and public.can_access_record(r.branch_id, r.employee_id, null)
    )
  );

-- feedback_actions (written by triggers only) --------------------------------
create policy feedback_actions_select on public.feedback_actions for select to authenticated
  using (exists (
    select 1 from public.survey_responses r
    where r.id = response_id and public.can_access_record(r.branch_id, r.employee_id, null)
  ));

-- audit_logs -----------------------------------------------------------------
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_super_admin());

-- system_settings ------------------------------------------------------------
create policy settings_select on public.system_settings for select to authenticated
  using (public.is_active_user());
create policy settings_admin_write on public.system_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- rate_limits: no policies (service role only)

-- ---------------------------------------------------------------------------
-- Column-level write restrictions for authenticated users
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.survey_responses from authenticated;
grant update (resolution_status, assigned_to, follow_up_due) on public.survey_responses to authenticated;

revoke insert, update, delete on public.survey_answers, public.feedback_actions, public.audit_logs, public.rate_limits from authenticated;
revoke update, delete on public.feedback_notes from authenticated;

revoke update on public.survey_invitations from authenticated;
grant update (status, token_hash, expires_at, sent_at, failed_at, last_error, send_count)
  on public.survey_invitations to authenticated;
revoke delete on public.survey_invitations from authenticated;

revoke update on public.message_logs from authenticated;
grant update (status, provider_message_id, provider_status, provider_response, error_code, error_message)
  on public.message_logs to authenticated;
revoke delete on public.message_logs from authenticated;

revoke insert on public.customers from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, role, branch_id, employee_id, is_active) on public.profiles to authenticated;

-- Helper functions: callable by signed-in users only.
revoke execute on function public.ensure_customer(text, text, text) from public, anon;
revoke execute on function public.log_audit(text, text, text, jsonb) from public, anon;
grant execute on function public.ensure_customer(text, text, text) to authenticated;
grant execute on function public.log_audit(text, text, text, jsonb) to authenticated;

-- #############################################################################
-- 20261104000003_survey_functions.sql
-- #############################################################################

-- =============================================================================
-- Public survey flow, rate limiting, expiry and data retention.
-- All functions here are SERVICE ROLE ONLY; the Next.js server validates the
-- raw token, hashes it (SHA-256) and calls these with the hash.
-- =============================================================================

-- Fixed-window rate limiter. Returns true when the request is allowed.
create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as rl (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.hits + 1 end,
        window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

-- Look up an invitation by token hash for the public survey page.
-- Marks the invitation as opened (application-tracked) the first time.
-- Returns no personal information.
create or replace function public.open_survey_invitation(p_token_hash text)
returns table (survey_type public.survey_type, state text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  inv public.survey_invitations;
begin
  select * into inv from public.survey_invitations i where i.token_hash = p_token_hash;
  if not found then
    return query select null::public.survey_type, 'invalid'::text, null::timestamptz;
    return;
  end if;

  if inv.status = 'completed' then
    return query select inv.survey_type, 'completed'::text, inv.expires_at;
    return;
  end if;

  if inv.status = 'expired' or inv.expires_at <= now() then
    update public.survey_invitations set status = 'expired'
     where id = inv.id and status not in ('completed', 'expired');
    return query select inv.survey_type, 'expired'::text, inv.expires_at;
    return;
  end if;

  if inv.opened_at is null then
    update public.survey_invitations
       set opened_at = now(),
           status = case when status in ('sent', 'delivered') then 'opened'::public.invitation_status else status end
     where id = inv.id;
  end if;

  return query select inv.survey_type, 'open'::text, inv.expires_at;
end $$;

-- Atomic, idempotent survey submission.
-- p_answers keys: nps_score, staff_service_rating, product_satisfaction,
-- overall_experience_rating, product_pricing_satisfaction, non_purchase_reason,
-- other_reason_description, additional_feedback
create or replace function public.submit_survey_response(p_token_hash text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  inv public.survey_invitations;
  v_response_id uuid;
  v_feedback text;
  v_other text;
begin
  -- Lock the invitation row so concurrent submissions serialise.
  select * into inv from public.survey_invitations where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if inv.status = 'completed' or exists (select 1 from public.survey_responses where invitation_id = inv.id) then
    return jsonb_build_object('ok', false, 'error', 'already_submitted');
  end if;
  if inv.status = 'expired' or inv.expires_at <= now() then
    update public.survey_invitations set status = 'expired' where id = inv.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  v_feedback := nullif(trim(p_answers ->> 'additional_feedback'), '');
  v_other := nullif(trim(p_answers ->> 'other_reason_description'), '');

  begin
    insert into public.survey_responses (
      invitation_id, survey_type, customer_id, interaction_id, branch_id, employee_id,
      nps_score, staff_service_rating,
      product_satisfaction, overall_experience_rating,
      product_pricing_satisfaction, non_purchase_reason, other_reason_description,
      additional_feedback
    ) values (
      inv.id, inv.survey_type, inv.customer_id, inv.interaction_id, inv.branch_id, inv.employee_id,
      (p_answers ->> 'nps_score')::smallint,
      (p_answers ->> 'staff_service_rating')::smallint,
      case when inv.survey_type = 'purchased' then (p_answers ->> 'product_satisfaction')::smallint end,
      case when inv.survey_type = 'purchased' then (p_answers ->> 'overall_experience_rating')::smallint end,
      case when inv.survey_type = 'non_purchased' then (p_answers ->> 'product_pricing_satisfaction')::smallint end,
      case when inv.survey_type = 'non_purchased' then (p_answers ->> 'non_purchase_reason')::public.non_purchase_reason end,
      case when inv.survey_type = 'non_purchased' and p_answers ->> 'non_purchase_reason' = 'other' then v_other end,
      v_feedback
    )
    returning id into v_response_id;
  exception
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('ok', false, 'error', 'invalid_answers');
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'already_submitted');
  end;

  -- Normalised per-question answers
  if inv.survey_type = 'purchased' then
    insert into public.survey_answers (response_id, question_key, question_order, numeric_value, text_value) values
      (v_response_id, 'nps_score', 1, (p_answers ->> 'nps_score')::smallint, null),
      (v_response_id, 'product_satisfaction', 2, (p_answers ->> 'product_satisfaction')::smallint, null),
      (v_response_id, 'staff_service_rating', 3, (p_answers ->> 'staff_service_rating')::smallint, null),
      (v_response_id, 'overall_experience_rating', 4, (p_answers ->> 'overall_experience_rating')::smallint, null),
      (v_response_id, 'additional_feedback', 5, null, v_feedback);
  else
    insert into public.survey_answers (response_id, question_key, question_order, numeric_value, text_value) values
      (v_response_id, 'nps_score', 1, (p_answers ->> 'nps_score')::smallint, null),
      (v_response_id, 'non_purchase_reason', 2, null,
        concat_ws(': ', p_answers ->> 'non_purchase_reason',
          case when p_answers ->> 'non_purchase_reason' = 'other' then v_other end)),
      (v_response_id, 'staff_service_rating', 3, (p_answers ->> 'staff_service_rating')::smallint, null),
      (v_response_id, 'product_pricing_satisfaction', 4, (p_answers ->> 'product_pricing_satisfaction')::smallint, null),
      (v_response_id, 'additional_feedback', 5, null, v_feedback);
  end if;

  update public.survey_invitations
     set status = 'completed', completed_at = now()
   where id = inv.id;

  return jsonb_build_object('ok', true);
end $$;

-- Mark invitations past their expiry as expired.
create or replace function public.expire_stale_invitations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.survey_invitations
     set status = 'expired'
   where expires_at <= now() and status not in ('completed', 'expired');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Apply the configured data-retention policy: anonymise customers whose most
-- recent interaction is older than the retention period. Aggregated survey
-- scores are kept for historical analytics; personal identifiers are removed.
create or replace function public.apply_data_retention()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_months integer;
  v_count integer;
begin
  select coalesce((value #>> '{}')::integer, 0) into v_months
    from public.system_settings where key = 'data_retention_months';
  if v_months is null or v_months <= 0 then
    return 0;
  end if;

  with stale as (
    select c.id from public.customers c
    where c.anonymised_at is null
      and not exists (
        select 1 from public.customer_interactions ci
        where ci.customer_id = c.id
          and ci.interaction_date > (now() at time zone 'Asia/Colombo')::date - make_interval(months => v_months)
      )
      and c.created_at < now() - make_interval(months => v_months)
  )
  update public.customers c
     set full_name = 'Anonymised customer', mobile = null, email = null, anonymised_at = now()
    from stale where c.id = stale.id;
  get diagnostics v_count = row_count;

  update public.message_logs ml
     set recipient = 'redacted', body_redacted = 'redacted'
   where ml.created_at < now() - make_interval(months => v_months) and ml.recipient <> 'redacted';

  delete from public.rate_limits where window_start < now() - interval '1 day';
  return v_count;
end $$;

-- Lock all of the above down to the service role.
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.open_survey_invitation(text) from public, anon, authenticated;
revoke execute on function public.submit_survey_response(text, jsonb) from public, anon, authenticated;
revoke execute on function public.expire_stale_invitations() from public, anon, authenticated;
revoke execute on function public.apply_data_retention() from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.open_survey_invitation(text) to service_role;
grant execute on function public.submit_survey_response(text, jsonb) to service_role;
grant execute on function public.expire_stale_invitations() to service_role;
grant execute on function public.apply_data_retention() to service_role;

-- #############################################################################
-- 20261104000004_analytics.sql
-- #############################################################################

-- =============================================================================
-- Analytics functions.
-- SECURITY INVOKER: Row Level Security applies, so a branch manager only ever
-- aggregates their own branch. Functions return COUNTS; NPS percentages are
-- computed in one place in the application (src/lib/nps.ts) for consistent
-- rounding and null handling.
--
-- Date filters use the Asia/Colombo calendar date.
-- Responses are filtered by submitted date; invitations by created date.
-- Only completed surveys exist in survey_responses, so incomplete or expired
-- invitations can never contribute to NPS.
-- =============================================================================

create or replace function public.cx_responses(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns setof public.survey_responses
language sql stable security invoker set search_path = public as $$
  select r.*
  from public.survey_responses r
  left join public.customer_interactions ci on ci.id = r.interaction_id
  where (p_from is null or (r.submitted_at at time zone 'Asia/Colombo')::date >= p_from)
    and (p_to is null or (r.submitted_at at time zone 'Asia/Colombo')::date <= p_to)
    and (p_branch is null or r.branch_id = p_branch)
    and (p_employee is null or r.employee_id = p_employee)
    and (p_survey_type is null or r.survey_type = p_survey_type)
    and (p_category is null or ci.product_category = p_category)
$$;

create or replace function public.cx_invitations(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns setof public.survey_invitations
language sql stable security invoker set search_path = public as $$
  select i.*
  from public.survey_invitations i
  left join public.customer_interactions ci on ci.id = i.interaction_id
  where (p_from is null or (i.created_at at time zone 'Asia/Colombo')::date >= p_from)
    and (p_to is null or (i.created_at at time zone 'Asia/Colombo')::date <= p_to)
    and (p_branch is null or i.branch_id = p_branch)
    and (p_employee is null or i.employee_id = p_employee)
    and (p_survey_type is null or i.survey_type = p_survey_type)
    and (p_category is null or ci.product_category = p_category)
$$;

-- Headline counts for the executive dashboard.
create or replace function public.analytics_overview(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns table (
  invitations_total bigint,
  invitations_dispatched bigint,
  invitations_completed bigint,
  invitations_failed bigint,
  invitations_delivered bigint,
  responses_total bigint,
  promoters bigint,
  passives bigint,
  detractors bigint,
  purchased_total bigint,
  purchased_promoters bigint,
  purchased_detractors bigint,
  non_purchased_total bigint,
  non_purchased_promoters bigint,
  non_purchased_detractors bigint,
  avg_staff_rating numeric,
  comments_total bigint,
  comments_promoter bigint,
  comments_passive bigint,
  comments_detractor bigint
)
language sql stable security invoker set search_path = public as $$
  with r as (select * from public.cx_responses(p_from, p_to, p_branch, p_employee, p_survey_type, p_category)),
       i as (select * from public.cx_invitations(p_from, p_to, p_branch, p_employee, p_survey_type, p_category))
  select
    (select count(*) from i),
    (select count(*) from i where sent_at is not null),
    (select count(*) from i where status = 'completed' and sent_at is not null),
    (select count(*) from i where status = 'failed'),
    (select count(*) from i where delivered_at is not null),
    (select count(*) from r),
    (select count(*) from r where nps_category = 'promoter'),
    (select count(*) from r where nps_category = 'passive'),
    (select count(*) from r where nps_category = 'detractor'),
    (select count(*) from r where survey_type = 'purchased'),
    (select count(*) from r where survey_type = 'purchased' and nps_category = 'promoter'),
    (select count(*) from r where survey_type = 'purchased' and nps_category = 'detractor'),
    (select count(*) from r where survey_type = 'non_purchased'),
    (select count(*) from r where survey_type = 'non_purchased' and nps_category = 'promoter'),
    (select count(*) from r where survey_type = 'non_purchased' and nps_category = 'detractor'),
    (select round(avg(staff_service_rating)::numeric, 2) from r),
    (select count(*) from r where additional_feedback is not null),
    (select count(*) from r where additional_feedback is not null and nps_category = 'promoter'),
    (select count(*) from r where additional_feedback is not null and nps_category = 'passive'),
    (select count(*) from r where additional_feedback is not null and nps_category = 'detractor')
$$;

-- NPS counts per period (day / week / month) split by survey type.
create or replace function public.analytics_nps_trend(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null,
  p_grain text default 'month'
) returns table (
  period date, survey_type public.survey_type, responses bigint, promoters bigint, passives bigint, detractors bigint
)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_grain not in ('day', 'week', 'month') then
    raise exception 'Invalid grain %', p_grain using errcode = '22023';
  end if;
  return query
    select date_trunc(p_grain, r.submitted_at at time zone 'Asia/Colombo')::date as period,
           r.survey_type,
           count(*),
           count(*) filter (where r.nps_category = 'promoter'),
           count(*) filter (where r.nps_category = 'passive'),
           count(*) filter (where r.nps_category = 'detractor')
      from public.cx_responses(p_from, p_to, p_branch, p_employee, p_survey_type, p_category) r
     group by 1, 2
     order by 1, 2;
end $$;

-- Distribution of 1–5 ratings for each rating question.
create or replace function public.analytics_rating_distribution(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns table (metric text, rating smallint, responses bigint)
language sql stable security invoker set search_path = public as $$
  with r as (select * from public.cx_responses(p_from, p_to, p_branch, p_employee, p_survey_type, p_category))
  select 'product_satisfaction', product_satisfaction, count(*) from r where product_satisfaction is not null group by 2
  union all
  select 'overall_experience_rating', overall_experience_rating, count(*) from r where overall_experience_rating is not null group by 2
  union all
  select 'staff_service_rating', staff_service_rating, count(*) from r group by 2
  union all
  select 'product_pricing_satisfaction', product_pricing_satisfaction, count(*) from r where product_pricing_satisfaction is not null group by 2
  order by 1, 2
$$;

-- NPS score distribution 0–10.
create or replace function public.analytics_nps_distribution(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns table (score smallint, responses bigint)
language sql stable security invoker set search_path = public as $$
  select nps_score, count(*)
    from public.cx_responses(p_from, p_to, p_branch, p_employee, p_survey_type, p_category)
   group by 1 order by 1
$$;

-- Reasons for not purchasing (non-purchased survey only).
create or replace function public.analytics_non_purchase_reasons(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_category text default null
) returns table (reason public.non_purchase_reason, responses bigint, detractors bigint, avg_staff_rating numeric)
language sql stable security invoker set search_path = public as $$
  select non_purchase_reason, count(*),
         count(*) filter (where nps_category = 'detractor'),
         round(avg(staff_service_rating)::numeric, 2)
    from public.cx_responses(p_from, p_to, p_branch, p_employee, 'non_purchased', p_category)
   group by 1 order by 2 desc
$$;

-- Monthly invitation funnel (cohort by invitation created month).
create or replace function public.analytics_response_rate_trend(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns table (period date, created bigint, dispatched bigint, completed bigint)
language sql stable security invoker set search_path = public as $$
  select date_trunc('month', created_at at time zone 'Asia/Colombo')::date,
         count(*),
         count(*) filter (where sent_at is not null),
         count(*) filter (where status = 'completed' and sent_at is not null)
    from public.cx_invitations(p_from, p_to, p_branch, p_employee, p_survey_type, p_category)
   group by 1 order by 1
$$;

-- Invitation status breakdown.
create or replace function public.analytics_invitation_status(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns table (status public.invitation_status, invitations bigint)
language sql stable security invoker set search_path = public as $$
  select status, count(*)
    from public.cx_invitations(p_from, p_to, p_branch, p_employee, p_survey_type, p_category)
   group by 1 order by 1
$$;

-- Per-branch performance.
create or replace function public.analytics_branch_performance(
  p_from date default null, p_to date default null,
  p_survey_type public.survey_type default null, p_category text default null
) returns table (
  branch_id uuid, branch_name text, branch_code text,
  invited bigint, dispatched bigint, delivered bigint, completed bigint,
  responses bigint, promoters bigint, passives bigint, detractors bigint,
  purchased_total bigint, purchased_promoters bigint, purchased_detractors bigint,
  non_purchased_total bigint, non_purchased_promoters bigint, non_purchased_detractors bigint,
  avg_staff_rating numeric
)
language sql stable security invoker set search_path = public as $$
  with i as (
    select branch_id,
           count(*) as invited,
           count(*) filter (where sent_at is not null) as dispatched,
           count(*) filter (where delivered_at is not null) as delivered,
           count(*) filter (where status = 'completed' and sent_at is not null) as completed
      from public.cx_invitations(p_from, p_to, null, null, p_survey_type, p_category)
     group by 1
  ), r as (
    select branch_id,
           count(*) as responses,
           count(*) filter (where nps_category = 'promoter') as promoters,
           count(*) filter (where nps_category = 'passive') as passives,
           count(*) filter (where nps_category = 'detractor') as detractors,
           count(*) filter (where survey_type = 'purchased') as p_total,
           count(*) filter (where survey_type = 'purchased' and nps_category = 'promoter') as p_prom,
           count(*) filter (where survey_type = 'purchased' and nps_category = 'detractor') as p_det,
           count(*) filter (where survey_type = 'non_purchased') as n_total,
           count(*) filter (where survey_type = 'non_purchased' and nps_category = 'promoter') as n_prom,
           count(*) filter (where survey_type = 'non_purchased' and nps_category = 'detractor') as n_det,
           round(avg(staff_service_rating)::numeric, 2) as avg_staff
      from public.cx_responses(p_from, p_to, null, null, p_survey_type, p_category)
     group by 1
  )
  select b.id, b.name, b.code,
         coalesce(i.invited, 0), coalesce(i.dispatched, 0), coalesce(i.delivered, 0), coalesce(i.completed, 0),
         coalesce(r.responses, 0), coalesce(r.promoters, 0), coalesce(r.passives, 0), coalesce(r.detractors, 0),
         coalesce(r.p_total, 0), coalesce(r.p_prom, 0), coalesce(r.p_det, 0),
         coalesce(r.n_total, 0), coalesce(r.n_prom, 0), coalesce(r.n_det, 0),
         r.avg_staff
    from public.branches b
    left join i on i.branch_id = b.id
    left join r on r.branch_id = b.id
   where (public.is_org_wide() or b.id = public.current_branch_id())
     and (b.is_active or i.invited is not null or r.responses is not null)
   order by b.name
$$;

-- Per-employee service-quality indicators.
create or replace function public.analytics_employee_performance(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_survey_type public.survey_type default null, p_category text default null
) returns table (
  employee_id uuid, employee_name text, branch_id uuid, branch_name text, is_active boolean,
  interactions bigint, invited bigint, responses bigint,
  promoters bigint, passives bigint, detractors bigint,
  avg_staff_rating numeric, positive_comments bigint, negative_comments bigint
)
language sql stable security invoker set search_path = public as $$
  with ix as (
    select ci.employee_id, count(*) as interactions
      from public.customer_interactions ci
     where ci.employee_id is not null
       and (p_from is null or ci.interaction_date >= p_from)
       and (p_to is null or ci.interaction_date <= p_to)
       and (p_branch is null or ci.branch_id = p_branch)
       and (p_category is null or ci.product_category = p_category)
       and (p_survey_type is null
            or (p_survey_type = 'purchased' and ci.purchase_status = 'purchased')
            or (p_survey_type = 'non_purchased' and ci.purchase_status = 'not_purchased'))
     group by 1
  ), i as (
    select employee_id, count(*) as invited
      from public.cx_invitations(p_from, p_to, p_branch, null, p_survey_type, p_category)
     where employee_id is not null group by 1
  ), r as (
    select employee_id,
           count(*) as responses,
           count(*) filter (where nps_category = 'promoter') as promoters,
           count(*) filter (where nps_category = 'passive') as passives,
           count(*) filter (where nps_category = 'detractor') as detractors,
           round(avg(staff_service_rating)::numeric, 2) as avg_staff,
           count(*) filter (where additional_feedback is not null and (nps_category = 'promoter' or staff_service_rating >= 4)) as pos,
           count(*) filter (where additional_feedback is not null and (nps_category = 'detractor' or staff_service_rating <= 2)) as neg
      from public.cx_responses(p_from, p_to, p_branch, null, p_survey_type, p_category)
     where employee_id is not null group by 1
  )
  select e.id, e.full_name, e.branch_id, b.name, e.is_active,
         coalesce(ix.interactions, 0), coalesce(i.invited, 0), coalesce(r.responses, 0),
         coalesce(r.promoters, 0), coalesce(r.passives, 0), coalesce(r.detractors, 0),
         r.avg_staff, coalesce(r.pos, 0), coalesce(r.neg, 0)
    from public.employees e
    join public.branches b on b.id = e.branch_id
    left join ix on ix.employee_id = e.id
    left join i on i.employee_id = e.id
    left join r on r.employee_id = e.id
   where (p_branch is null or e.branch_id = p_branch)
     and (e.is_active or ix.interactions is not null or r.responses is not null)
   order by b.name, e.full_name
$$;

revoke execute on function public.cx_responses(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.cx_invitations(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_overview(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_nps_trend(date, date, uuid, uuid, public.survey_type, text, text) from public, anon;
revoke execute on function public.analytics_rating_distribution(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_nps_distribution(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_non_purchase_reasons(date, date, uuid, uuid, text) from public, anon;
revoke execute on function public.analytics_response_rate_trend(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_invitation_status(date, date, uuid, uuid, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_branch_performance(date, date, public.survey_type, text) from public, anon;
revoke execute on function public.analytics_employee_performance(date, date, uuid, public.survey_type, text) from public, anon;

-- #############################################################################
-- 20261104000005_reference_data.sql
-- #############################################################################

-- =============================================================================
-- Reference data: survey templates, default SMS templates, system settings.
-- No business / customer data is seeded.
-- =============================================================================

grant execute on function public.cx_responses(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.cx_invitations(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_overview(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_nps_trend(date, date, uuid, uuid, public.survey_type, text, text) to authenticated;
grant execute on function public.analytics_rating_distribution(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_nps_distribution(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_non_purchase_reasons(date, date, uuid, uuid, text) to authenticated;
grant execute on function public.analytics_response_rate_trend(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_invitation_status(date, date, uuid, uuid, public.survey_type, text) to authenticated;
grant execute on function public.analytics_branch_performance(date, date, public.survey_type, text) to authenticated;
grant execute on function public.analytics_employee_performance(date, date, uuid, public.survey_type, text) to authenticated;

insert into public.survey_templates (survey_type, version, title, questions) values
('purchased', 1, 'Purchased customer survey', '[
  {"order":1,"key":"nps_score","type":"nps","required":true,
   "text":"How likely are you to recommend iDealz Lanka to your friends or family based on your purchasing experience?"},
  {"order":2,"key":"product_satisfaction","type":"emoji","required":true,
   "text":"How satisfied are you with the product you purchased from iDealz Lanka?"},
  {"order":3,"key":"staff_service_rating","type":"stars","required":true,
   "text":"How would you rate the service and assistance provided by our staff?"},
  {"order":4,"key":"overall_experience_rating","type":"emoji","required":true,
   "text":"How would you rate your overall purchasing experience at iDealz Lanka?"},
  {"order":5,"key":"additional_feedback","type":"text","required":false,
   "text":"Is there anything we could improve to make your experience better?"}
]'::jsonb),
('non_purchased', 1, 'Non-purchased customer survey', '[
  {"order":1,"key":"nps_score","type":"nps","required":true,
   "text":"Based on your interaction with iDealz Lanka, how likely are you to recommend us to your friends or family?"},
  {"order":2,"key":"non_purchase_reason","type":"single_select","required":true,
   "text":"What was the main reason you decided not to purchase from iDealz Lanka?"},
  {"order":3,"key":"staff_service_rating","type":"stars","required":true,
   "text":"How would you rate the assistance and service provided by our staff?"},
  {"order":4,"key":"product_pricing_satisfaction","type":"emoji","required":true,
   "text":"How satisfied were you with our product availability, pricing and available offers?"},
  {"order":5,"key":"additional_feedback","type":"text","required":false,
   "text":"What could iDealz Lanka do to improve your experience and encourage you to purchase from us in the future?"}
]'::jsonb);

insert into public.message_templates (survey_type, name, body, is_default) values
('purchased', 'Purchased customer – default',
 'Hi {{customer_name}}, thank you for choosing iDealz Lanka! We value your experience. Please take a moment to share your feedback through this short survey: {{survey_link}}. Your feedback helps us serve you better. Thank you!',
 true),
('non_purchased', 'Non-purchased customer – default',
 'Hi {{customer_name}}, thank you for visiting or contacting iDealz Lanka. We would appreciate your feedback to help us improve our service: {{survey_link}}. Thank you for your time!',
 true);

insert into public.system_settings (key, value, description) values
('company_name',          '"iDealz Lanka (Pvt) Ltd"', 'Legal company name shown on reports'),
('company_display_name',  '"iDealz Lanka"',           'Brand name shown to customers'),
('company_logo_url',      'null',                     'Public URL of the company logo (optional)'),
('support_phone',         'null',                     'Customer support phone shown on the privacy notice'),
('survey_expiry_days',    '14',                       'Days before a survey invitation link expires'),
('min_employee_sample',   '10',                       'Minimum responses before an employee is ranked'),
('min_branch_sample',     '20',                       'Minimum responses before a branch NPS is considered reliable'),
('data_retention_months', '36',                       'Months after the last interaction before customer identifiers are anonymised (0 = never)'),
('timezone',              '"Asia/Colombo"',           'Display timezone'),
('sms_daily_limit',       '2000',                     'Maximum survey SMS the platform will send per day');

-- #############################################################################
-- 20261104000006_analytics_drivers.sql
-- #############################################################################

-- Average ratings by NPS category: shows which experience factors are
-- associated with lower NPS. RLS applies (security invoker).
create or replace function public.analytics_drivers(
  p_from date default null, p_to date default null, p_branch uuid default null,
  p_employee uuid default null, p_survey_type public.survey_type default null, p_category text default null
) returns table (
  nps_category public.nps_category,
  responses bigint,
  avg_staff numeric,
  avg_product numeric,
  avg_overall numeric,
  avg_pricing numeric
)
language sql stable security invoker set search_path = public as $$
  select nps_category, count(*),
         round(avg(staff_service_rating)::numeric, 2),
         round(avg(product_satisfaction)::numeric, 2),
         round(avg(overall_experience_rating)::numeric, 2),
         round(avg(product_pricing_satisfaction)::numeric, 2)
    from public.cx_responses(p_from, p_to, p_branch, p_employee, p_survey_type, p_category)
   group by 1 order by 1
$$;
revoke execute on function public.analytics_drivers(date, date, uuid, uuid, public.survey_type, text) from public, anon;
grant execute on function public.analytics_drivers(date, date, uuid, uuid, public.survey_type, text) to authenticated;

commit;

-- Check: should return 2
-- select count(*) from public.survey_templates;
