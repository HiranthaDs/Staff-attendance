-- Secure, expiring branch-detail collection links.

create table if not exists public.branch_setup_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  proposed_name text not null check (char_length(proposed_name) between 2 and 80),
  proposed_code text not null check (proposed_code ~ '^[A-Z0-9-]{2,8}$'),
  radius_m integer not null default 200 check (radius_m between 50 and 1000),
  verification_mode public.verification_mode not null default 'gps_only',
  status text not null default 'pending' check (status in ('pending', 'submitted', 'approved', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz
);

create table if not exists public.branch_setup_submissions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.branch_setup_invites(id) on delete cascade,
  address text not null check (char_length(address) between 5 and 300),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m integer not null check (accuracy_m between 1 and 150),
  captured_at timestamptz not null,
  public_ip text not null,
  wifi_name text not null check (char_length(wifi_name) between 2 and 100),
  connection_type text,
  effective_type text,
  downlink_mbps numeric(8,2),
  rtt_ms integer,
  save_data boolean,
  device_info jsonb not null default '{}'::jsonb,
  user_agent text,
  manager_name text not null check (char_length(manager_name) between 2 and 100),
  manager_phone text not null check (char_length(manager_phone) between 7 and 30),
  notes text,
  created_branch_id uuid references public.branches(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now()
);

create index if not exists branch_setup_invites_status_idx on public.branch_setup_invites(status, expires_at);
create index if not exists branch_setup_submissions_date_idx on public.branch_setup_submissions(submitted_at desc);

alter table public.branch_setup_invites enable row level security;
alter table public.branch_setup_submissions enable row level security;
revoke all on public.branch_setup_invites, public.branch_setup_submissions from anon, authenticated;
grant select on public.branch_setup_invites, public.branch_setup_submissions to authenticated;

drop policy if exists "super admins read branch setup invites" on public.branch_setup_invites;
create policy "super admins read branch setup invites" on public.branch_setup_invites for select to authenticated using (
  (select public.current_profile_role()) = 'super_admin'
);
drop policy if exists "super admins read branch setup submissions" on public.branch_setup_submissions;
create policy "super admins read branch setup submissions" on public.branch_setup_submissions for select to authenticated using (
  (select public.current_profile_role()) = 'super_admin'
);

create or replace function public.submit_branch_setup(
  p_token_hash text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m integer,
  p_captured_at timestamptz,
  p_public_ip text,
  p_wifi_name text,
  p_connection_type text,
  p_effective_type text,
  p_downlink_mbps numeric,
  p_rtt_ms integer,
  p_save_data boolean,
  p_device_info jsonb,
  p_user_agent text,
  p_manager_name text,
  p_manager_phone text,
  p_notes text
) returns public.branch_setup_submissions
language plpgsql security definer set search_path = '' as $$
declare
  selected_invite public.branch_setup_invites;
  result public.branch_setup_submissions;
begin
  select * into selected_invite
  from public.branch_setup_invites
  where token_hash = p_token_hash
  for update;

  if selected_invite.id is null then raise exception 'INVITE_NOT_FOUND'; end if;
  if selected_invite.status <> 'pending' then raise exception 'INVITE_ALREADY_USED'; end if;
  if selected_invite.expires_at <= now() then
    update public.branch_setup_invites set status = 'expired' where id = selected_invite.id;
    raise exception 'INVITE_EXPIRED';
  end if;
  if p_captured_at < now() - interval '5 minutes' or p_captured_at > now() + interval '1 minute' then
    raise exception 'STALE_LOCATION';
  end if;

  insert into public.branch_setup_submissions (
    invite_id, address, latitude, longitude, accuracy_m, captured_at, public_ip,
    wifi_name, connection_type, effective_type, downlink_mbps, rtt_ms, save_data,
    device_info, user_agent, manager_name, manager_phone, notes
  ) values (
    selected_invite.id, p_address, p_latitude, p_longitude, p_accuracy_m,
    p_captured_at, p_public_ip, p_wifi_name, p_connection_type, p_effective_type,
    p_downlink_mbps, p_rtt_ms, p_save_data, coalesce(p_device_info, '{}'::jsonb),
    p_user_agent, p_manager_name, p_manager_phone, p_notes
  ) returning * into result;

  update public.branch_setup_invites
  set status = 'submitted', submitted_at = now()
  where id = selected_invite.id;
  return result;
end;
$$;

create or replace function public.approve_branch_setup(
  p_submission_id uuid,
  p_admin_id uuid
) returns public.branches
language plpgsql security definer set search_path = '' as $$
declare
  submission public.branch_setup_submissions;
  invite public.branch_setup_invites;
  result public.branches;
begin
  select * into submission from public.branch_setup_submissions where id = p_submission_id for update;
  if submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  if submission.created_branch_id is not null then
    select * into result from public.branches where id = submission.created_branch_id;
    return result;
  end if;

  select * into invite from public.branch_setup_invites where id = submission.invite_id for update;
  if invite.status <> 'submitted' then raise exception 'SUBMISSION_NOT_PENDING'; end if;

  insert into public.branches (
    name, code, address, latitude, longitude, radius_m, verification_mode, created_by
  ) values (
    invite.proposed_name, invite.proposed_code, submission.address, submission.latitude,
    submission.longitude, invite.radius_m, 'gps_only', p_admin_id
  ) returning * into result;

  update public.branch_setup_submissions
  set created_branch_id = result.id, reviewed_by = p_admin_id, reviewed_at = now()
  where id = submission.id;
  update public.branch_setup_invites
  set status = 'approved', approved_at = now()
  where id = invite.id;
  return result;
end;
$$;

revoke all on function public.submit_branch_setup(text, text, double precision, double precision, integer, timestamptz, text, text, text, text, numeric, integer, boolean, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_branch_setup(text, text, double precision, double precision, integer, timestamptz, text, text, text, text, numeric, integer, boolean, jsonb, text, text, text, text) to service_role;
revoke all on function public.approve_branch_setup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_branch_setup(uuid, uuid) to service_role;
