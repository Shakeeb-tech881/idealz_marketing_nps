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
