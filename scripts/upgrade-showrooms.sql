-- =============================================================================
-- UPGRADE for an EXISTING database (you already ran setup_all_in_one.sql before
-- 5 Nov 2026). New installs don't need this — it is already in setup_all_in_one.sql.
--
-- Adds, for each showroom:
--   • its own SMS mask (sender ID)
--   • its own customer-facing brand name (iSeven Mobiles customers see "iSeven Mobiles")
-- and creates the three main showrooms: iDealz Prime, iDealz Marino, iSeven Mobiles.
--
-- Supabase → SQL Editor → New query → paste this whole file → Run.
-- Safe to run more than once.
-- =============================================================================

begin;


-- ----- 20261105000007_showroom_sms_masks.sql -----
-- =============================================================================
-- Per-showroom SMS sender ID (mask)
--
-- Each branch can have its own approved Dialog eSMS mask (max 11 characters,
-- e.g. "iDealzPrime"). Survey SMS for a customer's visit are sent from the mask
-- of the branch they visited; branches without a mask use the default mask
-- (DIALOG_ESMS_SOURCE_ADDRESS). The mask actually used is recorded on every
-- message log.
--
-- Also adds the three main showrooms if they do not exist yet. Masks are left
-- empty on purpose: set them in Settings → Branches once Dialog has approved
-- them (an unapproved mask makes eSMS reject the SMS with error 108).
--
-- Safe to run more than once.
-- =============================================================================

alter table public.branches
  add column if not exists sms_sender_id text
  constraint branches_sms_sender_id_format check (sms_sender_id is null or sms_sender_id ~ '^[A-Za-z0-9][A-Za-z0-9 .&-]{0,10}$');

comment on column public.branches.sms_sender_id is
  'Approved SMS mask for this showroom (max 11 chars). Null = use the default mask.';

alter table public.message_logs
  add column if not exists sender_id text;

comment on column public.message_logs.sender_id is
  'SMS mask (sender ID) the message was sent from. Null = provider default / test mode.';

insert into public.branches (name, code, is_active)
select v.name, v.code, true
from (values
  ('iDealz Prime',   'PRIME'),
  ('iDealz Marino',  'MARINO'),
  ('iSeven Mobiles', 'ISEVEN')
) as v(name, code)
where not exists (
  select 1 from public.branches b
  where lower(b.name) = lower(v.name) or b.code = v.code
);

-- ----- 20261105000008_showroom_brands.sql -----
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

commit;

-- Check: lists your showrooms with their brand and (empty until approved) mask
-- select name, code, brand_name, sms_sender_id from public.branches order by name;
