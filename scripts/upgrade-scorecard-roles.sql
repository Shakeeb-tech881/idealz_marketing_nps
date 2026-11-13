-- =============================================================================
-- UPGRADE for an EXISTING database: management not graded, branch managers
-- graded on their branch (15 Nov 2026)
-- New installs don't need this — it is already in setup_all_in_one.sql.
--
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- =============================================================================

begin;


-- ----- 20261115000016_scorecard_roles.sql -----
-- =============================================================================
-- Who is graded on the scorecard.
--
--  rep            – graded personally on the Sales Rep Scorecard (default)
--  branch_manager – not graded personally; graded on the whole branch's result
--  not_scored     – Management / head office: no grade and not in any ranking
--
-- Every visit still counts in the branch totals, whoever served the customer.
-- The role follows the login automatically when an employee is linked to a
-- Super Admin / Management / Branch Manager login; a Super Admin can also set
-- it by hand (Settings → Employees).
-- =============================================================================

alter table public.employees
  add column if not exists scorecard_role text not null default 'rep';

alter table public.employees drop constraint if exists employees_scorecard_role;
alter table public.employees
  add constraint employees_scorecard_role check (scorecard_role in ('rep', 'branch_manager', 'not_scored'));

-- Keep the employee's scorecard role in step with the linked login's role.
create or replace function public.sync_employee_scorecard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.employee_id is null or not new.is_active then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.role is distinct from old.role
     or new.employee_id is distinct from old.employee_id
     or new.is_active is distinct from old.is_active then
    update public.employees
       set scorecard_role = case new.role
                              when 'super_admin' then 'not_scored'
                              when 'management' then 'not_scored'
                              when 'branch_manager' then 'branch_manager'
                              else 'rep'
                            end
     where id = new.employee_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.sync_employee_scorecard_role() from public, anon, authenticated;

drop trigger if exists profiles_sync_scorecard_role on public.profiles;
create trigger profiles_sync_scorecard_role
  after insert or update of role, employee_id, is_active on public.profiles
  for each row execute function public.sync_employee_scorecard_role();

-- Existing links: management and branch managers come off the rep scorecard now.
update public.employees e
   set scorecard_role = case p.role when 'branch_manager' then 'branch_manager' else 'not_scored' end
  from public.profiles p
 where p.employee_id = e.id
   and p.is_active
   and p.role in ('super_admin', 'management', 'branch_manager')
   and e.scorecard_role = 'rep';

commit;
