-- ============================================================================
-- SuperSwap — promote an existing member to admin.
--
-- Membership in the `admins` table IS admin access (app_admin_guard() checks it
-- inside every privileged RPC). Run this in the Supabase SQL editor.
--
-- Two ways to use it — pick ONE and edit the value, then run:
--
--   (A) By username (recommended). The username is what you registered with.
--   (B) By user_id (the auth.users / profiles UUID), if you already know it.
--
-- Idempotent: running it twice for the same person does nothing extra. The
-- granted_by is left null here (bootstrap-style grant); granting from the admin
-- desk instead records who added you.
-- ============================================================================

-- (A) Promote by username -----------------------------------------------------
insert into admins (user_id, handle)
select p.user_id, p.username
from profiles p
where p.username = 'TARGET_USERNAME'          -- <-- edit this
on conflict (user_id) do nothing;

-- (B) Promote by user_id (uncomment, and comment out block A above) -----------
-- insert into admins (user_id, handle)
-- select u.id, coalesce(p.username, u.id::text)
-- from auth.users u
-- left join profiles p on p.user_id = u.id
-- where u.id = '00000000-0000-0000-0000-000000000000'   -- <-- edit this
-- on conflict (user_id) do nothing;

-- Verify ----------------------------------------------------------------------
-- select a.user_id, a.handle, p.username, p.display_name, a.created_at
-- from admins a left join profiles p on p.user_id = a.user_id
-- order by a.created_at;
