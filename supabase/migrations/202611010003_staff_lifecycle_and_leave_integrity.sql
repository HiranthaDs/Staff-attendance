-- Complete employee lifecycle records and enforce leave calculations in PostgreSQL.

alter table public.profiles
  add column if not exists department text,
  add column if not exists employment_type text not null default 'permanent',
  add column if not exists employment_start_date date,
  add column if not exists probation_end_date date,
  add column if not exists employment_end_date date,
  add column if not exists date_of_birth date,
  add column if not exists national_id text,
  add column if not exists address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;

update public.profiles
set employment_start_date = coalesce(employment_start_date, created_at::date)
where role in ('branch_admin'::public.app_role, 'staff'::public.app_role);

alter table public.profiles drop constraint if exists profiles_employment_type_check;
alter table public.profiles add constraint profiles_employment_type_check
  check (employment_type in ('probation', 'permanent', 'contract', 'temporary', 'intern'));
alter table public.profiles drop constraint if exists profiles_employment_dates_check;
alter table public.profiles add constraint profiles_employment_dates_check check (
  (employment_start_date is null or date_of_birth is null or date_of_birth < employment_start_date)
  and (probation_end_date is null or employment_start_date is null or probation_end_date >= employment_start_date)
  and (employment_end_date is null or employment_start_date is null or employment_end_date >= employment_start_date)
  and (employment_type <> 'probation' or role = 'company_admin'::public.app_role or probation_end_date is not null)
  and (employment_type not in ('contract', 'temporary', 'intern') or role = 'company_admin'::public.app_role or employment_end_date is not null)
);
create unique index if not exists profiles_org_national_id_uidx
  on public.profiles(organization_id, lower(national_id)) where national_id is not null;

alter table public.organization_invitations
  add column if not exists department text,
  add column if not exists employment_type text not null default 'permanent',
  add column if not exists employment_start_date date,
  add column if not exists probation_end_date date,
  add column if not exists employment_end_date date,
  add column if not exists date_of_birth date,
  add column if not exists national_id text,
  add column if not exists address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;

alter table public.organization_invitations drop constraint if exists invitations_employment_type_check;
alter table public.organization_invitations add constraint invitations_employment_type_check
  check (employment_type in ('probation', 'permanent', 'contract', 'temporary', 'intern'));
alter table public.organization_invitations drop constraint if exists invitations_employment_dates_check;
alter table public.organization_invitations add constraint invitations_employment_dates_check check (
  (employment_start_date is null or date_of_birth is null or date_of_birth < employment_start_date)
  and (probation_end_date is null or employment_start_date is null or probation_end_date >= employment_start_date)
  and (employment_end_date is null or employment_start_date is null or employment_end_date >= employment_start_date)
  and (employment_type <> 'probation' or role = 'company_admin'::public.app_role or probation_end_date is not null)
  and (employment_type not in ('contract', 'temporary', 'intern') or role = 'company_admin'::public.app_role or employment_end_date is not null)
);
create unique index if not exists invitations_pending_national_id_uidx
  on public.organization_invitations(organization_id, lower(national_id))
  where national_id is not null and status = 'pending';

create or replace function public.accept_organization_invitation(
  p_token_hash text,
  p_user_id uuid
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.organization_invitations;
  v_profile public.profiles;
  v_day jsonb;
begin
  select * into v_invite from public.organization_invitations
  where token_hash = p_token_hash for update;
  if v_invite.id is null then raise exception 'INVITATION_NOT_FOUND'; end if;
  if v_invite.status <> 'pending' then raise exception 'INVITATION_ALREADY_USED'; end if;
  if v_invite.expires_at <= now() then
    update public.organization_invitations set status = 'expired' where id = v_invite.id;
    raise exception 'INVITATION_EXPIRED';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id) then raise exception 'PROFILE_ALREADY_EXISTS'; end if;

  insert into public.profiles(
    id, organization_id, email, full_name, phone, role, branch_id, job_title,
    employee_code, department, employment_type, employment_start_date,
    probation_end_date, employment_end_date, date_of_birth, national_id, address,
    emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
    expected_arrival, expected_departure, monthly_leave_days, annual_leave_days,
    must_reset_password, active, created_by
  ) values (
    p_user_id, v_invite.organization_id, lower(v_invite.invited_email), v_invite.full_name,
    v_invite.phone, v_invite.role, v_invite.branch_id, v_invite.job_title,
    nullif(v_invite.employee_code, ''), v_invite.department, v_invite.employment_type,
    v_invite.employment_start_date, v_invite.probation_end_date, v_invite.employment_end_date,
    v_invite.date_of_birth, nullif(v_invite.national_id, ''), v_invite.address,
    v_invite.emergency_contact_name, v_invite.emergency_contact_phone,
    v_invite.emergency_contact_relationship, v_invite.expected_arrival,
    v_invite.expected_departure, v_invite.monthly_leave_days, v_invite.annual_leave_days,
    false, true, v_invite.created_by
  ) returning * into v_profile;

  if jsonb_typeof(v_invite.work_schedule) = 'array' and jsonb_array_length(v_invite.work_schedule) = 7 then
    for v_day in select value from jsonb_array_elements(v_invite.work_schedule)
    loop
      insert into public.employee_work_schedules(user_id, weekday, day_type, arrival_time, departure_time)
      values (
        p_user_id,
        (v_day->>'weekday')::smallint,
        v_day->>'day_type',
        (v_day->>'arrival_time')::time,
        (v_day->>'departure_time')::time
      ) on conflict (user_id, weekday) do update set
        day_type = excluded.day_type,
        arrival_time = excluded.arrival_time,
        departure_time = excluded.departure_time;
    end loop;
  end if;

  update public.organization_invitations
  set status = 'accepted', accepted_by = p_user_id, accepted_at = now()
  where id = v_invite.id;
  return v_profile;
end;
$$;
revoke all on function public.accept_organization_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_organization_invitation(text, uuid) to service_role;

-- Recalculate leave units from the saved schedule and approved holidays. The
-- advisory lock makes concurrent approvals share one balance calculation.
create or replace function public.enforce_leave_invariants()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
  v_days numeric(6,1);
  v_used numeric(8,1);
  v_allowance numeric(8,1);
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':leave', 0));
  select * into v_profile from public.profiles where id = new.user_id and active = true;
  if v_profile.id is null then raise exception 'EMPLOYEE_INACTIVE_OR_NOT_FOUND'; end if;
  if new.end_date < new.start_date then raise exception 'INVALID_LEAVE_RANGE'; end if;
  if new.portion <> 'full_day'::public.leave_portion and new.start_date <> new.end_date then raise exception 'HALF_DAY_RANGE'; end if;
  if new.leave_type = 'monthly'::public.leave_type and date_trunc('month', new.start_date) <> date_trunc('month', new.end_date) then raise exception 'MONTHLY_LEAVE_RANGE'; end if;
  if new.leave_type = 'annual'::public.leave_type and extract(year from new.start_date) <> extract(year from new.end_date) then raise exception 'ANNUAL_LEAVE_RANGE'; end if;

  select coalesce(sum(
    case
      when exists (
        select 1 from public.company_holidays h
        where d.day between h.holiday_date and h.end_date and h.status = 'approved'
          and (h.organization_id is null or h.organization_id = v_profile.organization_id)
          and (h.branch_id is null or h.branch_id = v_profile.branch_id)
      ) then 0
      when coalesce(s.day_type::text, case when extract(isodow from d.day) = 7 then 'off' when extract(isodow from d.day) = 6 then 'half_day' else 'full_day' end) = 'off' then 0
      when new.portion <> 'full_day'::public.leave_portion then 0.5
      when coalesce(s.day_type::text, 'full_day') = 'half_day' then 0.5
      else 1
    end
  ), 0) into v_days
  from generate_series(new.start_date, new.end_date, interval '1 day') d(day)
  left join public.employee_work_schedules s
    on s.user_id = new.user_id and s.weekday = extract(isodow from d.day)::smallint;

  if v_days <= 0 then raise exception 'NO_SCHEDULED_LEAVE_DAYS'; end if;
  new.requested_days := v_days;

  if new.status = 'approved'::public.leave_status and new.leave_type in ('annual'::public.leave_type, 'monthly'::public.leave_type) then
    select coalesce(sum(l.requested_days), 0) into v_used
    from public.leave_requests l
    where l.user_id = new.user_id and l.status = 'approved'::public.leave_status
      and l.leave_type = new.leave_type and l.id <> new.id
      and (
        (new.leave_type = 'annual'::public.leave_type and extract(year from l.start_date) = extract(year from new.start_date))
        or (new.leave_type = 'monthly'::public.leave_type and date_trunc('month', l.start_date) = date_trunc('month', new.start_date))
      );
    v_allowance := case when new.leave_type = 'annual'::public.leave_type then v_profile.annual_leave_days else v_profile.monthly_leave_days end;
    if v_used + v_days > v_allowance then raise exception 'LEAVE_BALANCE_EXCEEDED'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leave_00_invariants_guard on public.leave_requests;
create trigger leave_00_invariants_guard
before insert or update of user_id, start_date, end_date, leave_type, portion, status, requested_days
on public.leave_requests for each row execute function public.enforce_leave_invariants();

drop policy if exists "branch admins manage branch leave" on public.leave_requests;
create policy "branch admins manage branch leave" on public.leave_requests for update to authenticated using (
  (select public.current_profile_role()) = 'branch_admin'::public.app_role
  and exists (select 1 from public.profiles p where p.id = leave_requests.user_id and p.branch_id = (select public.current_profile_branch()))
) with check (
  exists (select 1 from public.profiles p where p.id = leave_requests.user_id and p.branch_id = (select public.current_profile_branch()))
);

grant update (
  email, full_name, phone, branch_id, job_title, employee_code, department,
  employment_type, employment_start_date, probation_end_date, employment_end_date,
  date_of_birth, national_id, address, emergency_contact_name,
  emergency_contact_phone, emergency_contact_relationship, expected_arrival,
  expected_departure, monthly_leave_days, annual_leave_days, must_reset_password, active
) on public.profiles to authenticated;

create or replace function public.platform_daily_overview(p_actor_id uuid, p_date date)
returns table (
  organization_id uuid,
  organization_name text,
  active_members bigint,
  present_today bigint,
  late_today bigint,
  open_shifts bigint,
  pending_leave bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.role = 'super_admin'::public.app_role and p.active = true
  ) then raise exception 'PLATFORM_SUPER_ADMIN_REQUIRED'; end if;
  return query
  select o.id, o.name,
    (select count(*) from public.profiles p where p.organization_id = o.id and p.active = true),
    (select count(*) from public.attendance_records a join public.branches b on b.id = a.branch_id where b.organization_id = o.id and a.attendance_date = p_date),
    (select count(*) from public.attendance_records a join public.branches b on b.id = a.branch_id where b.organization_id = o.id and a.attendance_date = p_date and a.late_minutes > 0),
    (select count(*) from public.attendance_records a join public.branches b on b.id = a.branch_id where b.organization_id = o.id and a.attendance_date = p_date and a.clock_in is not null and a.clock_out is null),
    (select count(*) from public.leave_requests l join public.profiles p on p.id = l.user_id where p.organization_id = o.id and l.status = 'pending'::public.leave_status)
  from public.organizations o
  where o.status = 'active'
  order by o.name;
end;
$$;
revoke all on function public.platform_daily_overview(uuid, date) from public, anon, authenticated;
grant execute on function public.platform_daily_overview(uuid, date) to service_role;
