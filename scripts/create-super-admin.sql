-- Bootstrap the first Super Admin.
-- 1. In Supabase Dashboard → Authentication → Users → "Add user", create the
--    account with email + password (tick "Auto Confirm User").
-- 2. Change ONLY the email on the next line (keep the quotes), then Run.
--    Capital letters and spaces don't matter.
with target as (
  select id from auth.users
  where lower(trim(email)) = lower(trim('admin@idealzlanka.com'))   -- ← your login email
),
fix_auth as (
  update auth.users u
     set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                             || '{"role":"super_admin","provisioned":true}'::jsonb
    from target t where u.id = t.id
  returning u.id, u.email, u.raw_user_meta_data
),
fix_profile as (
  insert into public.profiles (id, email, full_name, role, branch_id, is_active)
  select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', 'Super Admin'),
         'super_admin', null, true
    from fix_auth
  on conflict (id) do update
     set role = 'super_admin', branch_id = null, is_active = true
  returning id, email, role, is_active
)
select * from fix_profile;
-- You should see ONE row: role = super_admin, is_active = true.
-- No rows? The email doesn't match any user — check Authentication → Users.
-- Then sign out / sign in again at /login.
-- All further users should be invited from the app (Users & Roles).
