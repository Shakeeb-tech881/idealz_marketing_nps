-- =============================================================================
-- Staff leave register (Rep Scorecard)
--
-- One row per employee per day off:
--   informed           – leave told in advance            → no penalty
--   sudden + proof     – sudden, documents received        → no penalty
--   sudden, no proof   – sudden, no documents (yet)        → penalty points on the grade
-- Any day off also lowers what the scorecard expects that rep to sell
-- (sales are compared per working day).
-- Proof is a tick + short note; documents stay in the HR file — no medical
-- documents are stored here.
-- =============================================================================

create table if not exists public.employee_leave (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees (id) on delete cascade,
  branch_id       uuid not null references public.branches (id) on delete cascade,
  leave_date      date not null,
  leave_type      text not null check (leave_type in ('informed', 'sudden')),
  proof_received  boolean not null default false,
  note            text check (note is null or length(note) <= 500),
  recorded_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint employee_leave_one_per_day unique (employee_id, leave_date),
  constraint employee_leave_proof_only_sudden check (leave_type = 'sudden' or not proof_received)
);
create index if not exists employee_leave_branch_date_idx on public.employee_leave (branch_id, leave_date);
create index if not exists employee_leave_employee_date_idx on public.employee_leave (employee_id, leave_date);

drop trigger if exists employee_leave_updated_at on public.employee_leave;
create trigger employee_leave_updated_at before update on public.employee_leave
  for each row execute function public.set_updated_at();

-- The showroom always comes from the employee record (it decides who may see / edit the row).
create or replace function public.set_employee_leave_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select e.branch_id into new.branch_id from public.employees e where e.id = new.employee_id;
  if new.branch_id is null then
    raise exception 'Unknown employee' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists employee_leave_branch on public.employee_leave;
create trigger employee_leave_branch before insert or update of employee_id on public.employee_leave
  for each row execute function public.set_employee_leave_branch();
revoke execute on function public.set_employee_leave_branch() from public, anon, authenticated;

alter table public.employee_leave enable row level security;
drop policy if exists employee_leave_select on public.employee_leave;
drop policy if exists employee_leave_write on public.employee_leave;
create policy employee_leave_select on public.employee_leave for select to authenticated
  using (
    public.is_org_wide()
    or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id())
    or (public.current_app_role() = 'staff' and employee_id = public.current_employee_id())
  );
-- Recorded by managers only: Super Admin / Management everywhere, branch managers in their showroom.
create policy employee_leave_write on public.employee_leave for all to authenticated
  using (public.is_org_wide() or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id()))
  with check (public.is_org_wide() or (public.current_app_role() = 'branch_manager' and branch_id = public.current_branch_id()));
revoke all on public.employee_leave from anon;

-- Days off per employee in a period (row-level security applies).
create or replace function public.analytics_rep_leave(p_from date default null, p_to date default null, p_branch uuid default null)
returns table (employee_id uuid, informed_days bigint, sudden_proof_days bigint, sudden_no_proof_days bigint)
language sql stable security invoker set search_path = public as $$
  select l.employee_id,
         count(*) filter (where l.leave_type = 'informed'),
         count(*) filter (where l.leave_type = 'sudden' and l.proof_received),
         count(*) filter (where l.leave_type = 'sudden' and not l.proof_received)
    from public.employee_leave l
   where (p_from is null or l.leave_date >= p_from)
     and (p_to is null or l.leave_date <= p_to)
     and (p_branch is null or l.branch_id = p_branch)
   group by l.employee_id
$$;
revoke execute on function public.analytics_rep_leave(date, date, uuid) from public, anon;
grant execute on function public.analytics_rep_leave(date, date, uuid) to authenticated;
