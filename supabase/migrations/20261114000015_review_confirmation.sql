-- =============================================================================
-- Google reviews are confirmed by a manager, not the sales rep.
--
--  • Reps can record "asked for a review" only.
--  • A Branch Manager / Management / Super Admin checks Google and marks the
--    visit "confirmed" (review found) or "not_found". Who checked and when is
--    recorded. Staff cannot set either status (enforced here, not just in the UI).
--  • The Rep Scorecard counts only manager-confirmed reviews.
-- =============================================================================

alter table public.customer_interactions
  add column if not exists review_checked_by uuid references public.profiles (id) on delete set null,
  add column if not exists review_checked_at timestamptz;

alter table public.customer_interactions drop constraint if exists interactions_google_review;
alter table public.customer_interactions
  add constraint interactions_google_review check (google_review in ('not_asked', 'asked', 'confirmed', 'not_found'));

create or replace function public.guard_google_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.google_review in ('confirmed', 'not_found')
     and (tg_op = 'INSERT' or new.google_review is distinct from old.google_review) then
    if public.current_app_role() = 'staff' then
      raise exception 'Only a manager can confirm whether a Google review was left' using errcode = '42501';
    end if;
    new.review_checked_by := auth.uid();
    new.review_checked_at := now();
  elsif new.google_review in ('not_asked', 'asked') then
    new.review_checked_by := null;
    new.review_checked_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.guard_google_review() from public, anon, authenticated;
drop trigger if exists interactions_google_review_guard on public.customer_interactions;
create trigger interactions_google_review_guard
  before insert or update of google_review on public.customer_interactions
  for each row execute function public.guard_google_review();

create index if not exists interactions_review_check_idx
  on public.customer_interactions (branch_id, interaction_date) where google_review <> 'not_asked';

-- "Not found" still means the rep asked.
create or replace function public.analytics_rep_kpis(
  p_from date default null, p_to date default null, p_branch uuid default null
) returns table (
  employee_id uuid, employee_name text, branch_id uuid, branch_name text, is_active boolean,
  visits bigint, sales bigint,
  android_phones bigint, apple_phones bigint, other_devices bigint,
  commission_accessories_value numeric, non_commission_accessories_value numeric,
  timed_visits bigint, avg_visit_minutes numeric,
  measured_conversions bigint, avg_conversion_days numeric,
  avg_sales_steps numeric,
  reviews_asked bigint, reviews_confirmed bigint
)
language sql stable security invoker set search_path = public as $$
  with v as (
    select ci.*,
           case when ci.visit_start is not null and ci.visit_end is not null
                then extract(epoch from (ci.visit_end - ci.visit_start)) / 60 end as minutes,
           case when ci.purchase_status = 'purchased'
                then coalesce(ci.purchase_date, ci.interaction_date) - (
                       select min(x.interaction_date) from public.customer_interactions x
                        where x.customer_id = ci.customer_id and x.interaction_date <= ci.interaction_date
                     ) end as conversion_days
      from public.customer_interactions ci
     where ci.kpi_tracked
       and ci.employee_id is not null
       and (p_from is null or ci.interaction_date >= p_from)
       and (p_to is null or ci.interaction_date <= p_to)
       and (p_branch is null or ci.branch_id = p_branch)
  ), t as (
    select v.employee_id,
           count(*) as visits,
           count(*) filter (where purchase_status = 'purchased') as sales,
           sum(v.android_phones) as android_phones,
           sum(v.apple_phones) as apple_phones,
           sum(v.other_devices) as other_devices,
           sum(v.commission_accessories_value) as commission_accessories_value,
           sum(v.non_commission_accessories_value) as non_commission_accessories_value,
           count(minutes) as timed_visits,
           round(avg(minutes)::numeric, 1) as avg_visit_minutes,
           count(conversion_days) as measured_conversions,
           round(avg(conversion_days)::numeric, 1) as avg_conversion_days,
           round(avg(cardinality(v.sales_steps))::numeric, 2) as avg_sales_steps,
           count(*) filter (where v.google_review <> 'not_asked') as reviews_asked,
           count(*) filter (where v.google_review = 'confirmed') as reviews_confirmed
      from v group by 1
  )
  select e.id, e.full_name, e.branch_id, b.name, e.is_active,
         coalesce(t.visits, 0), coalesce(t.sales, 0),
         coalesce(t.android_phones, 0), coalesce(t.apple_phones, 0), coalesce(t.other_devices, 0),
         coalesce(t.commission_accessories_value, 0), coalesce(t.non_commission_accessories_value, 0),
         coalesce(t.timed_visits, 0), t.avg_visit_minutes,
         coalesce(t.measured_conversions, 0), t.avg_conversion_days,
         t.avg_sales_steps,
         coalesce(t.reviews_asked, 0), coalesce(t.reviews_confirmed, 0)
    from public.employees e
    join public.branches b on b.id = e.branch_id
    left join t on t.employee_id = e.id
   where (p_branch is null or e.branch_id = p_branch)
     and (e.is_active or t.visits is not null)
   order by b.name, e.full_name
$$;
revoke execute on function public.analytics_rep_kpis(date, date, uuid) from public, anon;
grant execute on function public.analytics_rep_kpis(date, date, uuid) to authenticated;
