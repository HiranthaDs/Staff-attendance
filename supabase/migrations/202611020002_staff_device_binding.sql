-- One-browser attendance binding, super-admin enrollment resets and logout departure auditing.

alter table public.attendance_records
  add column if not exists clock_out_source text
    check (clock_out_source is null or clock_out_source in ('location', 'logout'));

update public.attendance_records
set clock_out_source = 'location'
where clock_out is not null and clock_out_source is null;

create or replace function public.set_attendance_clock_out_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.clock_out is null and new.clock_out is not null and new.clock_out_source is null then
    new.clock_out_source := 'location';
  end if;
  return new;
end;
$$;
drop trigger if exists attendance_clock_out_source on public.attendance_records;
create trigger attendance_clock_out_source before update on public.attendance_records
for each row execute function public.set_attendance_clock_out_source();

create table if not exists public.staff_device_bindings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  device_id uuid not null unique,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  device_label text not null check (char_length(device_label) between 2 and 120),
  registered_ip_hash text check (registered_ip_hash is null or registered_ip_hash ~ '^[0-9a-f]{64}$'),
  last_ip_hash text check (last_ip_hash is null or last_ip_hash ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_device_enrollments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  check (expires_at > created_at)
);

create table if not exists public.staff_device_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'registered', 'login_verified', 'login_denied', 'device_check_denied',
    'reset', 'logout_clock_out'
  )),
  context text,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_device_events_user_recent_idx
  on public.staff_device_events(user_id, created_at desc);
create index if not exists staff_device_events_retention_idx
  on public.staff_device_events(created_at);
create index if not exists staff_device_enrollments_expiry_idx
  on public.staff_device_enrollments(expires_at) where used_at is null;

alter table public.staff_device_bindings enable row level security;
alter table public.staff_device_enrollments enable row level security;
alter table public.staff_device_events enable row level security;
revoke all on public.staff_device_bindings, public.staff_device_enrollments, public.staff_device_events from public, anon, authenticated;
grant select, insert, update, delete on public.staff_device_bindings, public.staff_device_enrollments, public.staff_device_events to service_role;
grant usage, select on sequence public.staff_device_events_id_seq to service_role;

create or replace function public.verify_or_register_staff_device(
  p_user_id uuid,
  p_device_id uuid,
  p_secret_hash text,
  p_device_label text,
  p_ip_hash text default null,
  p_enrollment_token_hash text default null
) returns table(allowed boolean, status text, registered_label text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_binding public.staff_device_bindings%rowtype;
  v_enrollment public.staff_device_enrollments%rowtype;
begin
  if p_device_id is null or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
    or p_device_label is null or char_length(btrim(p_device_label)) not between 2 and 120
    or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$') then
    return query select false, 'device_mismatch'::text, null::text;
    return;
  end if;

  select * into v_profile from public.profiles where id = p_user_id for share;
  if not found or not v_profile.active
    or v_profile.role not in ('staff'::public.app_role, 'branch_admin'::public.app_role) then
    return query select false, 'not_eligible'::text, null::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-device:' || p_user_id::text, 0));
  select * into v_binding from public.staff_device_bindings where user_id = p_user_id for update;

  if found then
    if v_binding.device_id = p_device_id and v_binding.secret_hash = p_secret_hash then
      update public.staff_device_bindings
      set device_label = btrim(p_device_label), last_ip_hash = p_ip_hash,
          last_login_at = now(), last_seen_at = now(), updated_at = now()
      where user_id = p_user_id;
      insert into public.staff_device_events(user_id, device_id, event_type, context, ip_hash)
      values (p_user_id, p_device_id, 'login_verified', 'login', p_ip_hash);
      return query select true, 'verified'::text, btrim(p_device_label);
    else
      insert into public.staff_device_events(user_id, device_id, event_type, context, ip_hash, metadata)
      values (p_user_id, p_device_id, 'login_denied', 'login', p_ip_hash, jsonb_build_object('reason', 'device_mismatch'));
      return query select false, 'device_mismatch'::text, v_binding.device_label;
    end if;
    return;
  end if;

  select * into v_enrollment from public.staff_device_enrollments
  where user_id = p_user_id and used_at is null
  for update;
  if found then
    if v_enrollment.expires_at <= now() then
      return query select false, 'enrollment_expired'::text, null::text;
      return;
    end if;
    if p_enrollment_token_hash is null or p_enrollment_token_hash <> v_enrollment.token_hash then
      return query select false, 'enrollment_required'::text, null::text;
      return;
    end if;
  end if;

  begin
    insert into public.staff_device_bindings(
      user_id, device_id, secret_hash, device_label, registered_ip_hash, last_ip_hash
    ) values (
      p_user_id, p_device_id, p_secret_hash, btrim(p_device_label), p_ip_hash, p_ip_hash
    );
  exception when unique_violation then
    insert into public.staff_device_events(user_id, device_id, event_type, context, ip_hash, metadata)
    values (p_user_id, p_device_id, 'login_denied', 'login', p_ip_hash, jsonb_build_object('reason', 'device_claimed'));
    return query select false, 'device_claimed'::text, null::text;
    return;
  end;

  if v_enrollment.user_id is not null then
    update public.staff_device_enrollments set used_at = now() where user_id = p_user_id;
  end if;
  insert into public.staff_device_events(user_id, device_id, event_type, context, ip_hash)
  values (p_user_id, p_device_id, 'registered', 'login', p_ip_hash);
  return query select true, 'registered'::text, btrim(p_device_label);
end;
$$;

create or replace function public.verify_staff_device(
  p_user_id uuid,
  p_device_id uuid,
  p_secret_hash text,
  p_ip_hash text default null,
  p_context text default 'request'
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  select exists(
    select 1 from public.staff_device_bindings b
    join public.profiles p on p.id = b.user_id
    where b.user_id = p_user_id and b.device_id = p_device_id
      and b.secret_hash = p_secret_hash and p.active = true
      and p.role in ('staff'::public.app_role, 'branch_admin'::public.app_role)
  ) into v_allowed;
  if v_allowed then
    update public.staff_device_bindings
    set last_seen_at = now(), last_ip_hash = p_ip_hash, updated_at = now()
    where user_id = p_user_id;
  else
    insert into public.staff_device_events(user_id, device_id, event_type, context, ip_hash)
    select p_user_id, p_device_id, 'device_check_denied', left(coalesce(p_context, 'request'), 80), p_ip_hash
    where exists (select 1 from public.profiles where id = p_user_id);
  end if;
  return v_allowed;
end;
$$;

create or replace function public.reset_staff_device(
  p_actor_id uuid,
  p_user_id uuid,
  p_enrollment_token_hash text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_device_id uuid;
begin
  if not exists (
    select 1 from public.profiles where id = p_actor_id and role = 'super_admin'::public.app_role and active = true
  ) then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
  if not exists (
    select 1 from public.profiles where id = p_user_id and role in ('staff'::public.app_role, 'branch_admin'::public.app_role)
  ) then raise exception 'STAFF_ACCOUNT_REQUIRED'; end if;
  if p_enrollment_token_hash is null or p_enrollment_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'INVALID_DEVICE_ENROLLMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-device:' || p_user_id::text, 0));
  delete from public.staff_device_bindings where user_id = p_user_id returning device_id into v_old_device_id;
  insert into public.staff_device_enrollments(user_id, token_hash, expires_at, created_by)
  values (p_user_id, p_enrollment_token_hash, p_expires_at, p_actor_id)
  on conflict (user_id) do update set token_hash = excluded.token_hash,
    expires_at = excluded.expires_at, created_by = excluded.created_by,
    created_at = now(), used_at = null;
  insert into public.staff_device_events(user_id, device_id, actor_id, event_type, context, metadata)
  values (p_user_id, v_old_device_id, p_actor_id, 'reset', 'super_admin', jsonb_build_object('enrollment_expires_at', p_expires_at));
  return true;
end;
$$;

create or replace function public.platform_staff_device_directory(p_actor_id uuid)
returns table(
  user_id uuid, full_name text, email text, employee_code text, role public.app_role,
  organization_name text, branch_name text, device_id uuid, device_label text,
  registered_at timestamptz, last_seen_at timestamptz, enrollment_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where id = p_actor_id and role = 'super_admin'::public.app_role and active = true
  ) then raise exception 'SUPER_ADMIN_REQUIRED'; end if;
  return query
  select p.id, p.full_name, p.email, p.employee_code, p.role,
    o.name, b.name, d.device_id, d.device_label, d.registered_at, d.last_seen_at,
    case when e.used_at is null and e.expires_at > now() then e.expires_at else null end
  from public.profiles p
  left join public.organizations o on o.id = p.organization_id
  left join public.branches b on b.id = p.branch_id
  left join public.staff_device_bindings d on d.user_id = p.id
  left join public.staff_device_enrollments e on e.user_id = p.id
  where p.role in ('staff'::public.app_role, 'branch_admin'::public.app_role)
  order by o.name nulls last, p.full_name;
end;
$$;

create or replace function public.logout_and_close_attendance(p_user_id uuid)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_profile public.profiles%rowtype;
  v_branch public.branches%rowtype;
  v_record public.attendance_records%rowtype;
  v_local_date date;
  v_departure time;
  v_expected_at timestamptz;
  v_early integer;
  v_work integer;
  v_device_id uuid;
begin
  select * into v_profile from public.profiles where id = p_user_id for share;
  if not found or not v_profile.active or v_profile.role not in ('staff'::public.app_role, 'branch_admin'::public.app_role) then
    raise exception 'STAFF_ACCOUNT_REQUIRED';
  end if;
  select * into v_branch from public.branches where id = v_profile.branch_id for share;
  if not found then raise exception 'BRANCH_REQUIRED'; end if;
  v_local_date := (v_now at time zone v_branch.timezone)::date;

  select * into v_record from public.attendance_records
  where user_id = p_user_id and branch_id = v_branch.id
    and attendance_date between v_local_date - 1 and v_local_date
    and clock_in is not null and clock_out is null
  order by attendance_date desc, clock_in desc limit 1 for update;
  if not found then return null; end if;

  select coalesce(s.departure_time, v_profile.expected_departure) into v_departure
  from (select 1) seed
  left join public.employee_work_schedules s on s.user_id = p_user_id
    and s.weekday = extract(isodow from v_record.attendance_date)::integer;
  v_expected_at := (v_record.attendance_date + coalesce(v_departure, v_profile.expected_departure)) at time zone v_branch.timezone;
  v_early := greatest(0, floor(extract(epoch from (v_expected_at - v_now)) / 60)::integer - v_branch.early_leave_grace_minutes);
  v_work := greatest(0, floor(extract(epoch from (v_now - v_record.clock_in)) / 60)::integer);

  update public.attendance_records set
    clock_out = v_now,
    clock_out_latitude = null,
    clock_out_longitude = null,
    clock_out_accuracy_m = null,
    clock_out_distance_m = null,
    clock_out_ip = null,
    clock_out_source = 'logout',
    gps_passed = false,
    early_leave_minutes = v_early,
    work_minutes = v_work,
    status = case when v_work < 240 then 'partial'::public.attendance_status else status end,
    updated_at = v_now
  where id = v_record.id returning * into v_record;

  select device_id into v_device_id from public.staff_device_bindings where user_id = p_user_id;
  insert into public.staff_device_events(user_id, device_id, actor_id, event_type, context, metadata)
  values (p_user_id, v_device_id, p_user_id, 'logout_clock_out', 'logout', jsonb_build_object('attendance_record_id', v_record.id));
  return v_record;
end;
$$;

revoke all on function public.verify_or_register_staff_device(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_staff_device(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.reset_staff_device(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.platform_staff_device_directory(uuid) from public, anon, authenticated;
revoke all on function public.logout_and_close_attendance(uuid) from public, anon, authenticated;
grant execute on function public.verify_or_register_staff_device(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.verify_staff_device(uuid, uuid, text, text, text) to service_role;
grant execute on function public.reset_staff_device(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.platform_staff_device_directory(uuid) to service_role;
grant execute on function public.logout_and_close_attendance(uuid) to service_role;

comment on table public.staff_device_bindings is
  'One service-managed browser credential per attendance-capable staff account.';
