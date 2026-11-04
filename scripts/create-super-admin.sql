-- Bootstrap the first Super Admin.
-- 1. In Supabase Dashboard → Authentication → Users → "Add user", create the
--    account with email + password (tick "Auto Confirm User").
-- 2. Run this in the SQL editor, replacing the email and name.
update public.profiles
   set role = 'super_admin',
       full_name = 'Your Name',
       is_active = true
 where email = 'admin@idealzlanka.com';

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"super_admin","provisioned":true}'::jsonb
 where email = 'admin@idealzlanka.com';
-- All further users should be invited from the app (Users & Roles).
