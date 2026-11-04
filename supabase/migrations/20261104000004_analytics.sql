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
