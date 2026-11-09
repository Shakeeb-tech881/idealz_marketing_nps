-- =============================================================================
-- UPGRADE for an EXISTING database: Sales rep scorecard (9 Nov 2026)
-- New installs don't need this — it is already in setup_all_in_one.sql.
--
-- Adds to each purchase / visit: phones and accessories sold, time with the
-- customer, sales steps and Google review, plus the Rep Scorecard totals.
-- Visits recorded before this upgrade are left out of the scorecard.
--
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- =============================================================================

begin;


-- ----- 20261109000009_sales_rep_kpis.sql -----
-- =============================================================================
-- Sales rep KPIs
--
-- Each visit records what the rep sold, how long they spent with the customer,
-- which sales steps they followed and whether they asked for a Google review.
-- analytics_rep_kpis() totals these per rep; the app turns them into a score
-- and an A+ … Fail grade (src/lib/kpi.ts).
-- =============================================================================

alter table public.customer_interactions
  add column if not exists android_phones             smallint not null default 0,
  add column if not exists apple_phones               smallint not null default 0,
  add column if not exists other_devices              smallint not null default 0,
  add column if not exists commission_accessories     smallint not null default 0,
  add column if not exists non_commission_accessories smallint not null default 0,
  add column if not exists visit_start                time,
  add column if not exists visit_end                  time,
  add column if not exists sales_steps                text[] not null default '{}',
  add column if not exists google_review              text not null default 'not_asked',
  -- Visits recorded before this feature (and bulk imports) have no KPI data;
  -- they are left out of the scorecard so reps are not marked down for them.
  add column if not exists kpi_tracked                boolean not null default false;

-- New visits are tracked from now on; existing rows stay false.
alter table public.customer_interactions alter column kpi_tracked set default true;

alter table public.customer_interactions
  drop constraint if exists interactions_sales_counts,
  drop constraint if exists interactions_sales_need_purchase,
  drop constraint if exists interactions_visit_time,
  drop constraint if exists interactions_sales_steps,
  drop constraint if exists interactions_google_review;

alter table public.customer_interactions
  add constraint interactions_sales_counts check (
    android_phones between 0 and 50 and apple_phones between 0 and 50 and other_devices between 0 and 50
    and commission_accessories between 0 and 200 and non_commission_accessories between 0 and 200
  ),
  add constraint interactions_sales_need_purchase check (
    purchase_status = 'purchased'
    or (android_phones = 0 and apple_phones = 0 and other_devices = 0
        and commission_accessories = 0 and non_commission_accessories = 0)
  ),
  add constraint interactions_visit_time check (
    visit_start is null or visit_end is null or visit_end > visit_start
  ),
  add constraint interactions_sales_steps check (
    sales_steps <@ array[
      'greeted', 'needs_identified', 'demo_given', 'trade_in_offered',
      'accessories_offered', 'warranty_explained', 'payment_options_explained', 'follow_up_arranged'
    ]::text[]
  ),
  add constraint interactions_google_review check (google_review in ('not_asked', 'asked', 'confirmed'));

create index if not exists interactions_kpi_idx
  on public.customer_interactions (employee_id, interaction_date) where kpi_tracked;

-- Per-rep KPI totals for a period. SECURITY INVOKER: row-level security limits
-- each user to the visits they are allowed to see.
create or replace function public.analytics_rep_kpis(
  p_from date default null, p_to date default null, p_branch uuid default null
) returns table (
  employee_id uuid, employee_name text, branch_id uuid, branch_name text, is_active boolean,
  visits bigint, sales bigint,
  android_phones bigint, apple_phones bigint, other_devices bigint,
  commission_accessories bigint, non_commission_accessories bigint,
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
           sum(v.commission_accessories) as commission_accessories,
           sum(v.non_commission_accessories) as non_commission_accessories,
           count(minutes) as timed_visits,
           round(avg(minutes)::numeric, 1) as avg_visit_minutes,
           count(conversion_days) as measured_conversions,
           round(avg(conversion_days)::numeric, 1) as avg_conversion_days,
           round(avg(cardinality(v.sales_steps))::numeric, 2) as avg_sales_steps,
           count(*) filter (where v.google_review in ('asked', 'confirmed')) as reviews_asked,
           count(*) filter (where v.google_review = 'confirmed') as reviews_confirmed
      from v group by 1
  )
  select e.id, e.full_name, e.branch_id, b.name, e.is_active,
         coalesce(t.visits, 0), coalesce(t.sales, 0),
         coalesce(t.android_phones, 0), coalesce(t.apple_phones, 0), coalesce(t.other_devices, 0),
         coalesce(t.commission_accessories, 0), coalesce(t.non_commission_accessories, 0),
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

commit;

-- Check: should return 0 (no visits are tracked until reps record new ones)
-- select count(*) from public.customer_interactions where kpi_tracked;
