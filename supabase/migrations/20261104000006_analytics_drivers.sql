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
