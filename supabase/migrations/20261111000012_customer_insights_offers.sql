-- =============================================================================
-- Customer insights + offer (marketing) SMS campaigns
--
--  • customers.offers_opt_out — separate from sms_opt_out (survey SMS). A
--    customer who opted out of survey SMS never gets offers either.
--  • offer_campaigns / offer_recipients — a snapshot of the audience taken when
--    the campaign is created; recipients are claimed in batches so the same
--    customer can never be sent the same offer twice (even from two tabs).
--  • message_logs.campaign_id — offer SMS appear in Sending history and get
--    delivery reports like survey SMS.
--  • customer_insights() — one row per customer with purchases, models,
--    latest feedback; row-level security applies (SECURITY INVOKER).
-- =============================================================================

alter table public.customers
  add column if not exists offers_opt_out    boolean not null default false,
  add column if not exists offers_opt_out_at timestamptz;

create table if not exists public.offer_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 1 and 120),
  body            text not null check (length(body) between 1 and 1000 and position('{{optout_link}}' in body) > 0),
  audience        jsonb not null default '{}'::jsonb,
  status          text not null default 'draft' check (status in ('draft', 'sending', 'paused', 'completed', 'cancelled')),
  pause_reason    text check (length(pause_reason) <= 300),
  recipient_count integer not null default 0,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists offer_campaigns_created_idx on public.offer_campaigns (created_at desc);
drop trigger if exists offer_campaigns_updated_at on public.offer_campaigns;
create trigger offer_campaigns_updated_at before update on public.offer_campaigns
  for each row execute function public.set_updated_at();

create table if not exists public.offer_recipients (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.offer_campaigns (id) on delete cascade,
  customer_id        uuid not null references public.customers (id) on delete cascade,
  branch_id          uuid references public.branches (id) on delete set null,
  status             text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  -- SHA-256 of the one-tap opt-out token in the SMS; the raw token is never stored.
  optout_token_hash  text unique check (optout_token_hash ~ '^[0-9a-f]{64}$'),
  message_log_id     uuid references public.message_logs (id) on delete set null,
  error              text check (length(error) <= 500),
  claimed_at         timestamptz,
  sent_at            timestamptz,
  unique (campaign_id, customer_id)
);
create index if not exists offer_recipients_status_idx on public.offer_recipients (campaign_id, status);

alter table public.message_logs add column if not exists campaign_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'message_logs_campaign_fk') then
    alter table public.message_logs
      add constraint message_logs_campaign_fk foreign key (campaign_id) references public.offer_campaigns (id) on delete set null;
  end if;
end $$;
create index if not exists message_logs_campaign_idx on public.message_logs (campaign_id) where campaign_id is not null;
create index if not exists message_logs_customer_idx on public.message_logs (customer_id);

-- Offers are company-wide marketing: Super Admin and Management only.
alter table public.offer_campaigns  enable row level security;
alter table public.offer_recipients enable row level security;
drop policy if exists offer_campaigns_select on public.offer_campaigns;
drop policy if exists offer_campaigns_insert on public.offer_campaigns;
drop policy if exists offer_campaigns_update on public.offer_campaigns;
create policy offer_campaigns_select on public.offer_campaigns for select to authenticated using (public.is_org_wide());
create policy offer_campaigns_insert on public.offer_campaigns for insert to authenticated
  with check (public.is_org_wide() and created_by = auth.uid());
create policy offer_campaigns_update on public.offer_campaigns for update to authenticated
  using (public.is_org_wide()) with check (public.is_org_wide());
drop policy if exists offer_recipients_select on public.offer_recipients;
drop policy if exists offer_recipients_insert on public.offer_recipients;
drop policy if exists offer_recipients_update on public.offer_recipients;
create policy offer_recipients_select on public.offer_recipients for select to authenticated using (public.is_org_wide());
create policy offer_recipients_insert on public.offer_recipients for insert to authenticated with check (public.is_org_wide());
create policy offer_recipients_update on public.offer_recipients for update to authenticated
  using (public.is_org_wide()) with check (public.is_org_wide());
revoke delete on public.offer_campaigns, public.offer_recipients from authenticated;
revoke all on public.offer_campaigns, public.offer_recipients from anon;

-- Offer SMS logs: only org-wide users may write logs linked to a campaign.
drop policy if exists message_logs_insert on public.message_logs;
create policy message_logs_insert on public.message_logs for insert to authenticated
  with check (sent_by = auth.uid() and public.can_write_branch(branch_id) and (campaign_id is null or public.is_org_wide()));

-- Claim the next batch of recipients atomically (SKIP LOCKED: two senders never get the same rows).
-- Recipients stuck in 'sending' for 15+ minutes (a crashed batch) are marked failed — never re-sent,
-- because the SMS may already have gone out.
create or replace function public.claim_offer_recipients(p_campaign uuid, p_limit integer default 25)
returns setof public.offer_recipients
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_org_wide() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.offer_recipients
     set status = 'failed', error = 'Interrupted while sending – the SMS may or may not have been sent'
   where campaign_id = p_campaign and status = 'sending' and claimed_at < now() - interval '15 minutes';
  return query
    update public.offer_recipients r
       set status = 'sending', claimed_at = now()
     where r.id in (
       select id from public.offer_recipients
        where campaign_id = p_campaign and status = 'pending'
        order by id
        limit greatest(1, least(p_limit, 100))
        for update skip locked
     )
    returning r.*;
end $$;
revoke execute on function public.claim_offer_recipients(uuid, integer) from public, anon;
grant execute on function public.claim_offer_recipients(uuid, integer) to authenticated;

-- One row per customer, filtered. Purchase filters (model / category / brand)
-- match purchases; branch and dates match any visit. Aggregates use all of the
-- customer's visits the caller may see (row-level security).
create or replace function public.customer_insights(
  p_q text default null,
  p_model text default null,
  p_category text default null,
  p_brand text default null,
  p_branch uuid default null,
  p_from date default null,
  p_to date default null,
  p_last_purchase_before date default null,
  p_nps text default null,
  p_offers text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  customer_id uuid,
  full_name text,
  mobile text,
  email text,
  sms_opt_out boolean,
  offers_opt_out boolean,
  branches text[],
  models text[],
  last_model text,
  last_branch_id uuid,
  purchases bigint,
  visits bigint,
  first_visit date,
  last_visit date,
  last_purchase date,
  responses bigint,
  latest_nps smallint,
  latest_nps_category public.nps_category,
  avg_staff_rating numeric,
  latest_comment text,
  latest_response_at timestamptz,
  total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with params as (
    select nullif(trim(p_q), '') as q,
           nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '') as digits,
           nullif(trim(p_model), '') as model
  ),
  base as (
    select c.*
      from public.customers c, params
     where c.anonymised_at is null
       and (params.q is null
            or c.full_name ilike '%' || params.q || '%'
            or (params.digits is not null and length(params.digits) >= 3 and c.mobile like '%' || params.digits || '%'))
       and (p_offers is null
            or (p_offers = 'allowed' and c.mobile is not null and not c.sms_opt_out and not c.offers_opt_out)
            or (p_offers = 'opted_out' and (c.sms_opt_out or c.offers_opt_out)))
       and exists (
         select 1 from public.customer_interactions ci
          where ci.customer_id = c.id
            and (p_branch is null or ci.branch_id = p_branch)
            and (p_from is null or ci.interaction_date >= p_from)
            and (p_to is null or ci.interaction_date <= p_to)
            and ((params.model is null and p_category is null and p_brand is null)
                 or (ci.purchase_status = 'purchased'
                     and (params.model is null or ci.product_model ilike '%' || params.model || '%')
                     and (p_category is null or ci.product_category = p_category)
                     and (p_brand is null
                          or (p_brand = 'apple' and (ci.apple_phones > 0 or ci.product_model ~* '(iphone|ipad|macbook|imac|airpods|apple)'))
                          or (p_brand = 'android' and (ci.android_phones > 0 or ci.product_model ~* '(samsung|galaxy|pixel|xiaomi|redmi|poco|oppo|vivo|oneplus|huawei|honor|realme|nokia|motorola|tecno|infinix|nothing phone|android)')))))
       )
  ),
  per_customer as (
    select b.id as customer_id, b.full_name, b.mobile, b.email, b.sms_opt_out, b.offers_opt_out,
           a.branches, a.models, a.last_model, a.last_branch_id, a.purchases, a.visits,
           a.first_visit, a.last_visit, a.last_purchase,
           r.responses, lr.nps_score as latest_nps, lr.nps_category as latest_nps_category,
           r.avg_staff, lr.additional_feedback as latest_comment, lr.submitted_at as latest_response_at
      from base b
      cross join lateral (
        select array(select distinct br.name from public.customer_interactions x join public.branches br on br.id = x.branch_id
                      where x.customer_id = b.id order by 1) as branches,
               array(select m.product_model from (
                       select x.product_model, max(coalesce(x.purchase_date, x.interaction_date)) as d
                         from public.customer_interactions x
                        where x.customer_id = b.id and x.purchase_status = 'purchased' and x.product_model is not null
                        group by x.product_model order by d desc limit 5) m) as models,
               (select x.product_model from public.customer_interactions x
                 where x.customer_id = b.id and x.purchase_status = 'purchased' and x.product_model is not null
                 order by coalesce(x.purchase_date, x.interaction_date) desc, x.created_at desc limit 1) as last_model,
               (select x.branch_id from public.customer_interactions x where x.customer_id = b.id
                 order by x.interaction_date desc, x.created_at desc limit 1) as last_branch_id,
               (select count(*) from public.customer_interactions x where x.customer_id = b.id and x.purchase_status = 'purchased') as purchases,
               (select count(*) from public.customer_interactions x where x.customer_id = b.id) as visits,
               (select min(x.interaction_date) from public.customer_interactions x where x.customer_id = b.id) as first_visit,
               (select max(x.interaction_date) from public.customer_interactions x where x.customer_id = b.id) as last_visit,
               (select max(coalesce(x.purchase_date, x.interaction_date)) from public.customer_interactions x
                 where x.customer_id = b.id and x.purchase_status = 'purchased') as last_purchase
      ) a
      cross join lateral (
        select count(*) as responses, round(avg(sr.staff_service_rating)::numeric, 2) as avg_staff
          from public.survey_responses sr where sr.customer_id = b.id
      ) r
      left join lateral (
        select sr.nps_score, sr.nps_category, sr.additional_feedback, sr.submitted_at
          from public.survey_responses sr where sr.customer_id = b.id
         order by sr.submitted_at desc limit 1
      ) lr on true
  ),
  filtered as (
    select * from per_customer
     where (p_last_purchase_before is null or (last_purchase is not null and last_purchase < p_last_purchase_before))
       and (p_nps is null
            or (p_nps = 'none' and latest_nps_category is null)
            or latest_nps_category::text = p_nps)
  )
  select f.*, count(*) over () as total_count
    from filtered f
   order by f.last_visit desc nulls last, f.full_name
   limit greatest(1, least(coalesce(p_limit, 50), 20000))
  offset greatest(0, coalesce(p_offset, 0))
$$;
revoke execute on function public.customer_insights(text, text, text, text, uuid, date, date, date, text, text, integer, integer) from public, anon;
grant execute on function public.customer_insights(text, text, text, text, uuid, date, date, date, text, text, integer, integer) to authenticated;
