-- ============================================================================
-- 2026-11-23: auth_email_domain — the placeholder is not a usable hostname
-- ----------------------------------------------------------------------------
-- Symptom: POST /api/auth/register returns 500 for EVERY attempt.
-- Cause:   the seed shipped 'accounts.superswap.local'. Usernames become
--          username@<auth_email_domain> (see app_auth_email), and GoTrue
--          rejects a reserved TLD outright:
--            400 Email address "someone@accounts.superswap.local" is invalid
--          The route could not recognize that message, so it answered 500.
-- Fix:     point the setting at a real public hostname for this deployment.
--          No mail is ever sent to it — it is a namespace for synthetic
--          logins only.
--
-- ORDER: run this file, then re-apply rpc.sql (hardened app_auth_email) and
--        admin.sql (validates + freezes this key on the admin desk).
--
-- WARNING: this value can only be set while you have no members. Every
--          existing login address is derived from it, so changing it later
--          silently locks the whole book out. The guard below refuses anyway.
-- ============================================================================

do $$
declare
  v_members bigint;
  v_current text;
begin
  select count(*) into v_members from profiles;
  select value into v_current from platform_settings where key = 'auth_email_domain';

  if v_members > 0
     and coalesce(v_current, '') not in ('', 'accounts.superswap.local') then
    raise exception
      'auth_email_domain is already % and % members sign in through it — refusing to overwrite. Restore the original value instead.',
      quote_literal(v_current), v_members;
  end if;

  if v_members > 0 then
    raise notice '% members already exist; they were mapped through % and will need that host restored, not replaced.',
      v_members, quote_literal(coalesce(v_current, '<unset>'));
  end if;
end $$;

-- Replace the placeholder (or a missing row) with this deployment's host.
-- Deliberately a plain upsert rather than "on conflict do nothing": the bogus
-- placeholder row must lose, or registration stays broken forever.
insert into platform_settings (key, value, updated_at)
values ('auth_email_domain', 'accounts.superswap-nine.vercel.app', now())
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- Post-check: print the address a sample username would sign in with, computed
-- the same way app_auth_email() does, so a typo is visible here rather than in
-- the next signup.
do $$
declare
  v_domain text;
  v_sample text;
begin
  select lower(trim(value)) into v_domain from platform_settings where key = 'auth_email_domain';
  v_sample := 'sample_member@' || v_domain;

  if v_domain is null or v_domain = '' then
    raise exception 'auth_email_domain is empty — set it before the first signup.';
  end if;

  if v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
     or v_domain ~ '\.(local|localhost|test|example|invalid|onion)$' then
    raise exception '% is not a public hostname, so GoTrue will reject %.', quote_literal(v_domain), quote_literal(v_sample);
  end if;

  raise notice 'OK — usernames now sign in as <username>@%, e.g. %', v_domain, v_sample;
end $$;

select key, value, updated_at from platform_settings where key = 'auth_email_domain';
