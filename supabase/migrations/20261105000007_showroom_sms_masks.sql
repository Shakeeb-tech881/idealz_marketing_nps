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
