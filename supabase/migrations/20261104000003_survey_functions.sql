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
