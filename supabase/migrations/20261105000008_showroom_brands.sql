-- =============================================================================
-- Customer-facing brand per showroom
--
-- branches.brand_name is the name customers of that showroom see: in the SMS
-- ({{brand_name}}), in the survey questions, page header and thank-you page.
-- Null = the company display name (Settings → General, default "iDealz Lanka").
--
-- iSeven Mobiles is set to its own brand; iDealz Prime and iDealz Marino keep
-- "iDealz Lanka". Existing SMS templates have the fixed text "iDealz Lanka"
-- replaced by {{brand_name}}, which renders exactly the same for iDealz
-- showrooms and as "iSeven Mobiles" for iSeven customers.
--
-- Safe to run more than once.
-- =============================================================================

alter table public.branches
  add column if not exists brand_name text
  constraint branches_brand_name_length check (brand_name is null or length(trim(brand_name)) between 1 and 60);

comment on column public.branches.brand_name is
  'Brand shown to this showroom''s customers (SMS, survey, thank-you page). Null = company display name.';

update public.branches
   set brand_name = 'iSeven Mobiles'
 where code = 'ISEVEN' and brand_name is null;

update public.message_templates
   set body = replace(body, 'iDealz Lanka', '{{brand_name}}')
 where body like '%iDealz Lanka%';
