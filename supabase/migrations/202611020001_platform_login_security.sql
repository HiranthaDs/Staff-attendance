-- Dedicated super-admin sign-in audit, rate limiting and last-login telemetry.
-- Raw email addresses, IP addresses and user agents are never stored here; the
-- application sends keyed SHA-256 fingerprints instead.

alter table public.profiles
  add column if not exists last_platform_login_at timestamptz,
  add column if not exists platform_login_count integer not null default 0
    check (platform_login_count >= 0);

create table if not exists public.platform_login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in (
    'success',
    'invalid_credentials',
    'rate_limited',
    'profile_missing',
    'account_disabled',
    'role_denied',
    'service_error'
  )),
  attempted_at timestamptz not null default now()
);

create index if not exists platform_login_events_email_recent_idx
  on public.platform_login_events(email_hash, attempted_at desc);
create index if not exists platform_login_events_ip_recent_idx
  on public.platform_login_events(ip_hash, attempted_at desc)
  where ip_hash is not null;
create index if not exists platform_login_events_retention_idx
  on public.platform_login_events(attempted_at);

alter table public.platform_login_events enable row level security;
revoke all on public.platform_login_events from public, anon, authenticated;
grant select, insert, delete on public.platform_login_events to service_role;
grant usage, select on sequence public.platform_login_events_id_seq to service_role;

create or replace function public.platform_login_is_allowed(
  p_email_hash text,
  p_ip_hash text default null
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recent_failures as (
    select email_hash, ip_hash
    from public.platform_login_events
    where attempted_at >= now() - interval '15 minutes'
      and outcome in ('invalid_credentials', 'rate_limited', 'profile_missing', 'account_disabled', 'role_denied')
  )
  select
    (select count(*) from recent_failures where email_hash = p_email_hash) < 5
    and (
      p_ip_hash is null
      or (select count(*) from recent_failures where ip_hash = p_ip_hash) < 12
    );
$$;

create or replace function public.record_platform_login_event(
  p_email_hash text,
  p_ip_hash text default null,
  p_user_agent_hash text default null,
  p_outcome text default 'service_error',
  p_user_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email_hash !~ '^[0-9a-f]{64}$'
    or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
    or (p_user_agent_hash is not null and p_user_agent_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'INVALID_LOGIN_FINGERPRINT';
  end if;

  if p_outcome not in (
    'success', 'invalid_credentials', 'rate_limited', 'profile_missing',
    'account_disabled', 'role_denied', 'service_error'
  ) then
    raise exception 'INVALID_LOGIN_OUTCOME';
  end if;

  insert into public.platform_login_events(
    user_id, email_hash, ip_hash, user_agent_hash, outcome
  ) values (
    p_user_id, p_email_hash, p_ip_hash, p_user_agent_hash, p_outcome
  );

  if p_outcome = 'success' and p_user_id is not null then
    update public.profiles
    set last_platform_login_at = now(),
        platform_login_count = platform_login_count + 1
    where id = p_user_id
      and role = 'super_admin'::public.app_role
      and active = true;
  end if;

  -- Keep the security ledger bounded without requiring another scheduled job.
  if random() < 0.02 then
    delete from public.platform_login_events
    where attempted_at < now() - interval '90 days';
  end if;
end;
$$;

revoke all on function public.platform_login_is_allowed(text, text) from public, anon, authenticated;
revoke all on function public.record_platform_login_event(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.platform_login_is_allowed(text, text) to service_role;
grant execute on function public.record_platform_login_event(text, text, text, text, uuid) to service_role;

comment on table public.platform_login_events is
  'Service-role-only audit ledger for the dedicated platform administrator portal.';
