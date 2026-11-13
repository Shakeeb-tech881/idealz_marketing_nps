-- =============================================================================
-- UPGRADE for an EXISTING database: branch managers' leave (16 Nov 2026)
-- Run AFTER upgrade-scorecard-roles.sql. New installs don't need this.
--
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- =============================================================================

begin;


-- ----- 20261116000017_branch_manager_leave.sql -----
-- =============================================================================
-- Branch managers' leave.
--
-- A branch manager's sudden leave without proof lowers their branch grade
-- (5 points a day, at most 25 – the same as a rep). So a branch manager must not
-- record, excuse or delete leave for themselves or another branch manager:
-- only Management / Super Admin can. Branch managers still record leave for the
-- sales reps in their own showroom.
-- =============================================================================

create or replace function public.is_branch_manager_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = p_employee and scorecard_role = 'branch_manager')
$$;
revoke execute on function public.is_branch_manager_employee(uuid) from public, anon;
grant execute on function public.is_branch_manager_employee(uuid) to authenticated;

drop policy if exists employee_leave_write on public.employee_leave;
create policy employee_leave_write on public.employee_leave for all to authenticated
  using (
    public.is_org_wide()
    or (public.current_app_role() = 'branch_manager'
        and branch_id = public.current_branch_id()
        and employee_id is distinct from public.current_employee_id()
        and not public.is_branch_manager_employee(employee_id))
  )
  with check (
    public.is_org_wide()
    or (public.current_app_role() = 'branch_manager'
        and branch_id = public.current_branch_id()
        and employee_id is distinct from public.current_employee_id()
        and not public.is_branch_manager_employee(employee_id))
  );

commit;
