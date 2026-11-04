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
