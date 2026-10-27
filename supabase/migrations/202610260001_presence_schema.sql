-- Presence attendance platform: tables, atomic attendance RPC and RLS.
-- Run this migration in the Supabase SQL editor or with `supabase db push`.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('super_admin', 'branch_admin', 'staff');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.verification_mode as enum ('gps_and_ip', 'gps_or_ip', 'gps_only');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.attendance_status as enum ('present', 'late', 'partial');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.leave_type as enum ('annual', 'monthly', 'medical', 'unpaid');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.leave_portion as enum ('full_day', 'first_half', 'second_half');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,8}$'),
  address text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 200 check (radius_m between 50 and 1000),
  timezone text not null default 'Asia/Colombo',
  verification_mode public.verification_mode not null default 'gps_and_ip',
  max_accuracy_m integer not null default 80 check (max_accuracy_m between 10 and 250),
  late_grace_minutes integer not null default 10 check (late_grace_minutes between 0 and 120),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 2 and 100),
  phone text,
  role public.app_role not null default 'staff',
  branch_id uuid references public.branches(id) on delete restrict,
  job_title text,
  employee_code text unique,
  expected_arrival time not null default '08:30',
  expected_departure time not null default '17:00',
  monthly_leave_days numeric(4,1) not null default 1 check (monthly_leave_days between 0 and 10),
  annual_leave_days numeric(4,1) not null default 14 check (annual_leave_days between 0 and 60),
  must_reset_password boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_requires_branch check (role = 'super_admin' or branch_id is not null)
);

create table if not exists public.branch_networks (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  label text not null default 'Office Wi-Fi',
  ip_rule text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(branch_id, ip_rule)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  attendance_date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  clock_in_latitude double precision,
  clock_in_longitude double precision,
  clock_in_accuracy_m integer,
  clock_in_distance_m integer,
  clock_in_ip text,
  clock_out_latitude double precision,
  clock_out_longitude double precision,
  clock_out_accuracy_m integer,
  clock_out_distance_m integer,
  clock_out_ip text,
  gps_passed boolean not null default false,
  ip_passed boolean not null default false,
  status public.attendance_status not null default 'present',
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  work_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, attendance_date),
  constraint clock_out_after_in check (clock_out is null or (clock_in is not null and clock_out >= clock_in))
);

create table if not exists public.attendance_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  action text not null check (action in ('clock_in', 'clock_out')),
  allowed boolean not null,
  reason text not null,
  latitude double precision,
  longitude double precision,
  accuracy_m integer,
  distance_m integer,
  client_ip text,
  gps_passed boolean not null default false,
  ip_passed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  leave_type public.leave_type not null,
  portion public.leave_portion not null default 'full_day',
  requested_days numeric(4,1) not null check (requested_days > 0),
  reason text not null check (char_length(reason) between 4 and 500),
  status public.leave_status not null default 'pending',
  admin_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_date_order check (end_date >= start_date)
);

create index if not exists profiles_branch_id_idx on public.profiles(branch_id);
create index if not exists attendance_user_date_idx on public.attendance_records(user_id, attendance_date desc);
create index if not exists attendance_branch_date_idx on public.attendance_records(branch_id, attendance_date desc);
create index if not exists attempts_user_created_idx on public.attendance_attempts(user_id, created_at desc);
create index if not exists leave_user_start_idx on public.leave_requests(user_id, start_date desc);
create index if not exists leave_status_idx on public.leave_requests(status, created_at desc);
create index if not exists networks_branch_idx on public.branch_networks(branch_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists branches_updated_at on public.branches;
create trigger branches_updated_at before update on public.branches for each row execute function public.set_updated_at();
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists attendance_updated_at on public.attendance_records;
create trigger attendance_updated_at before update on public.attendance_records for each row execute function public.set_updated_at();
drop trigger if exists leave_updated_at on public.leave_requests;
create trigger leave_updated_at before update on public.leave_requests for each row execute function public.set_updated_at();

create or replace function public.current_profile_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active = true
$$;
create or replace function public.current_profile_branch()
returns uuid language sql stable security definer set search_path = '' as $$
  select branch_id from public.profiles where id = (select auth.uid()) and active = true
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_profile_branch() from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_branch() to authenticated;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.branch_networks enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_attempts enable row level security;
alter table public.leave_requests enable row level security;

revoke all on public.branches, public.profiles, public.branch_networks, public.attendance_records, public.attendance_attempts, public.leave_requests from anon;
revoke all on public.branches, public.profiles, public.branch_networks, public.attendance_records, public.attendance_attempts, public.leave_requests from authenticated;
grant select on public.branches, public.profiles, public.branch_networks, public.attendance_records, public.attendance_attempts, public.leave_requests to authenticated;

drop policy if exists "authenticated read assigned branches" on public.branches;
create policy "authenticated read assigned branches" on public.branches for select to authenticated using (
  id = (select public.current_profile_branch()) or (select public.current_profile_role()) = 'super_admin'
);
drop policy if exists "users and admins read profiles" on public.profiles;
create policy "users and admins read profiles" on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select public.current_profile_role()) = 'super_admin'
  or ((select public.current_profile_role()) = 'branch_admin' and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "admins read branch networks" on public.branch_networks;
create policy "admins read branch networks" on public.branch_networks for select to authenticated using (
  (select public.current_profile_role()) = 'super_admin'
  or ((select public.current_profile_role()) = 'branch_admin' and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "users and admins read attendance" on public.attendance_records;
create policy "users and admins read attendance" on public.attendance_records for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.current_profile_role()) = 'super_admin'
  or ((select public.current_profile_role()) = 'branch_admin' and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "users and admins read attempts" on public.attendance_attempts;
create policy "users and admins read attempts" on public.attendance_attempts for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.current_profile_role()) = 'super_admin'
  or ((select public.current_profile_role()) = 'branch_admin' and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "users and admins read leave" on public.leave_requests;
create policy "users and admins read leave" on public.leave_requests for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.current_profile_role()) = 'super_admin'
  or ((select public.current_profile_role()) = 'branch_admin' and exists (
    select 1 from public.profiles employee where employee.id = leave_requests.user_id and employee.branch_id = (select public.current_profile_branch())
  ))
);

create or replace function public.record_attendance_mark(
  p_user_id uuid,
  p_branch_id uuid,
  p_attendance_date date,
  p_action text,
  p_now timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m integer,
  p_distance_m integer,
  p_client_ip text,
  p_gps_passed boolean,
  p_ip_passed boolean,
  p_status public.attendance_status,
  p_late_minutes integer,
  p_early_leave_minutes integer
) returns public.attendance_records
language plpgsql security definer set search_path = '' as $$
declare
  result public.attendance_records;
begin
  if p_action not in ('clock_in', 'clock_out') then raise exception 'INVALID_ACTION'; end if;

  insert into public.attendance_attempts (
    user_id, branch_id, action, allowed, reason, latitude, longitude, accuracy_m,
    distance_m, client_ip, gps_passed, ip_passed
  ) values (
    p_user_id, p_branch_id, p_action, true, 'Verified', p_latitude, p_longitude,
    p_accuracy_m, p_distance_m, p_client_ip, p_gps_passed, p_ip_passed
  );

  if p_action = 'clock_in' then
    insert into public.attendance_records (
      user_id, branch_id, attendance_date, clock_in, clock_in_latitude,
      clock_in_longitude, clock_in_accuracy_m, clock_in_distance_m, clock_in_ip,
      gps_passed, ip_passed, status, late_minutes
    ) values (
      p_user_id, p_branch_id, p_attendance_date, p_now, p_latitude,
      p_longitude, p_accuracy_m, p_distance_m, p_client_ip,
      p_gps_passed, p_ip_passed, p_status, p_late_minutes
    ) on conflict (user_id, attendance_date) do update
      set updated_at = public.attendance_records.updated_at
    returning * into result;
  else
    update public.attendance_records set
      clock_out = p_now,
      clock_out_latitude = p_latitude,
      clock_out_longitude = p_longitude,
      clock_out_accuracy_m = p_accuracy_m,
      clock_out_distance_m = p_distance_m,
      clock_out_ip = p_client_ip,
      gps_passed = public.attendance_records.gps_passed and p_gps_passed,
      ip_passed = public.attendance_records.ip_passed and p_ip_passed,
      early_leave_minutes = p_early_leave_minutes,
      work_minutes = greatest(0, floor(extract(epoch from (p_now - clock_in)) / 60)::integer),
      status = case when floor(extract(epoch from (p_now - clock_in)) / 60) < 240 then 'partial'::public.attendance_status else status end
    where user_id = p_user_id and attendance_date = p_attendance_date and clock_in is not null and clock_out is null
    returning * into result;

    if result.id is null then
      select * into result from public.attendance_records where user_id = p_user_id and attendance_date = p_attendance_date and clock_out is not null;
      if result.id is null then raise exception 'CLOCK_IN_REQUIRED'; end if;
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.record_attendance_mark(uuid, uuid, date, text, timestamptz, double precision, double precision, integer, integer, text, boolean, boolean, public.attendance_status, integer, integer) from public, anon, authenticated;
grant execute on function public.record_attendance_mark(uuid, uuid, date, text, timestamptz, double precision, double precision, integer, integer, text, boolean, boolean, public.attendance_status, integer, integer) to service_role;
