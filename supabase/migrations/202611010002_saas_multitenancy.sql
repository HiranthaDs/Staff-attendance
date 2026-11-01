-- SaaS tenancy, company-owner provisioning, secure team invitations and tenant RLS.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  billing_email text not null,
  plan text not null default 'growth' check (plan in ('starter', 'growth', 'scale', 'enterprise')),
  staff_limit integer not null default 1000 check (staff_limit between 1 and 100000),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at before update on public.organizations
for each row execute function public.set_updated_at();

-- Preserve existing single-company installations as one tenant.
insert into public.organizations(name, slug, billing_email, plan, staff_limit)
select 'Existing workspace', 'legacy-workspace', 'admin@example.com', 'growth', 1000
where (
  exists (select 1 from public.branches)
  or exists (select 1 from public.profiles where role <> 'super_admin'::public.app_role)
)
and not exists (select 1 from public.organizations);

alter table public.branches add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

update public.branches
set organization_id = (select id from public.organizations order by created_at, id limit 1)
where organization_id is null;

update public.profiles p
set organization_id = coalesce(
  (select b.organization_id from public.branches b where b.id = p.branch_id),
  (select id from public.organizations order by created_at, id limit 1)
)
where p.role <> 'super_admin'::public.app_role and p.organization_id is null;

update public.profiles set organization_id = null, branch_id = null
where role = 'super_admin'::public.app_role;

alter table public.branches alter column organization_id set not null;

alter table public.profiles drop constraint if exists staff_requires_branch;
alter table public.profiles drop constraint if exists profiles_scope_check;
alter table public.profiles add constraint profiles_scope_check check (
  (role = 'super_admin'::public.app_role and organization_id is null and branch_id is null)
  or (role = 'company_admin'::public.app_role and organization_id is not null and branch_id is null)
  or (role in ('branch_admin'::public.app_role, 'staff'::public.app_role) and organization_id is not null and branch_id is not null)
);

alter table public.branches drop constraint if exists branches_name_key;
alter table public.branches drop constraint if exists branches_code_key;
alter table public.profiles drop constraint if exists profiles_employee_code_key;
create unique index if not exists branches_org_name_uidx on public.branches(organization_id, lower(name));
create unique index if not exists branches_org_code_uidx on public.branches(organization_id, code);
create unique index if not exists profiles_org_employee_code_uidx
  on public.profiles(organization_id, employee_code) where employee_code is not null;
create index if not exists profiles_org_active_idx on public.profiles(organization_id, active, role);
create index if not exists branches_org_active_idx on public.branches(organization_id, active);

alter table public.branch_setup_invites add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.branch_setup_invites i set organization_id = p.organization_id
from public.profiles p where p.id = i.created_by and i.organization_id is null;
alter table public.branch_setup_invites alter column organization_id set not null;
create index if not exists branch_setup_invites_org_status_idx
  on public.branch_setup_invites(organization_id, status, expires_at desc);

alter table public.calendar_notes add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.calendar_notes n set organization_id = coalesce(
  (select b.organization_id from public.branches b where b.id = n.branch_id),
  (select p.organization_id from public.profiles p where p.id = n.created_by)
) where organization_id is null;
alter table public.calendar_notes alter column organization_id set not null;
create index if not exists calendar_notes_org_date_idx on public.calendar_notes(organization_id, note_date);

alter table public.company_holidays add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.company_holidays h set organization_id = coalesce(
  (select b.organization_id from public.branches b where b.id = h.branch_id),
  (select p.organization_id from public.profiles p where p.id = h.proposed_by),
  (select p.organization_id from public.profiles p where p.id = h.reviewed_by)
) where h.organization_id is null and h.source <> 'official';
drop index if exists public.company_holidays_global_unique_idx;
drop index if exists public.company_holidays_branch_unique_idx;
create unique index if not exists company_holidays_official_unique_idx
  on public.company_holidays(holiday_date, name) where organization_id is null and source = 'official';
create unique index if not exists company_holidays_org_unique_idx
  on public.company_holidays(organization_id, holiday_date, name) where organization_id is not null and branch_id is null;
create unique index if not exists company_holidays_org_branch_unique_idx
  on public.company_holidays(organization_id, holiday_date, name, branch_id) where branch_id is not null;
create index if not exists company_holidays_org_date_idx on public.company_holidays(organization_id, holiday_date, status);

alter table public.payroll_preferences add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.payroll_preferences set organization_id = (select id from public.organizations order by created_at, id limit 1)
where organization_id is null;
delete from public.payroll_preferences where organization_id is null;
alter table public.payroll_preferences alter column organization_id set not null;
alter table public.payroll_preferences drop constraint if exists payroll_preferences_pkey;
alter table public.payroll_preferences drop constraint if exists payroll_preferences_id_check;
alter table public.payroll_preferences add primary key (organization_id);

alter table public.support_issues add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
update public.support_issues i set organization_id = p.organization_id
from public.profiles p where p.id = i.reporter_id and i.organization_id is null;
alter table public.support_issues alter column organization_id set not null;
create index if not exists support_issues_org_status_idx on public.support_issues(organization_id, status, created_at desc);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  invited_email text not null,
  role public.app_role not null check (role in ('company_admin'::public.app_role, 'branch_admin'::public.app_role, 'staff'::public.app_role)),
  full_name text not null check (char_length(full_name) between 2 and 100),
  phone text check (phone is null or char_length(phone) between 7 and 30),
  employee_code text,
  job_title text,
  expected_arrival time not null default '09:00',
  expected_departure time not null default '17:00',
  monthly_leave_days numeric(4,1) not null default 1 check (monthly_leave_days between 0 and 10),
  annual_leave_days numeric(4,1) not null default 14 check (annual_leave_days between 0 and 60),
  work_schedule jsonb not null default '[]'::jsonb,
  token_hash text not null unique check (char_length(token_hash) = 64),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitation_role_scope check (
    (role = 'company_admin'::public.app_role and branch_id is null)
    or (role in ('branch_admin'::public.app_role, 'staff'::public.app_role) and branch_id is not null)
  ),
  constraint invitation_workday_order check (expected_departure > expected_arrival)
);
create index if not exists invitations_org_status_idx on public.organization_invitations(organization_id, status, created_at desc);
create index if not exists invitations_token_status_idx on public.organization_invitations(token_hash, status, expires_at);
create unique index if not exists invitations_pending_email_uidx
  on public.organization_invitations(organization_id, lower(invited_email)) where status = 'pending';

create or replace function public.current_profile_organization()
returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = (select auth.uid()) and active = true
$$;
create or replace function public.profile_organization(p_user_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = p_user_id
$$;
create or replace function public.branch_organization(p_branch_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.branches where id = p_branch_id
$$;
revoke all on function public.current_profile_organization() from public;
revoke all on function public.profile_organization(uuid) from public;
revoke all on function public.branch_organization(uuid) from public;
grant execute on function public.current_profile_organization() to authenticated;
grant execute on function public.profile_organization(uuid) to authenticated;
grant execute on function public.branch_organization(uuid) to authenticated;

create or replace function public.enforce_profile_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_branch_org uuid;
  v_limit integer;
  v_count integer;
begin
  if new.role = 'super_admin'::public.app_role then
    new.organization_id := null;
    new.branch_id := null;
    return new;
  end if;
  if new.organization_id is null then raise exception 'ORGANIZATION_REQUIRED'; end if;
  if new.role = 'company_admin'::public.app_role then
    new.branch_id := null;
  else
    select organization_id into v_branch_org from public.branches where id = new.branch_id and active = true;
    if v_branch_org is null or v_branch_org <> new.organization_id then raise exception 'BRANCH_OUTSIDE_ORGANIZATION'; end if;
  end if;
  if new.active and (tg_op = 'INSERT' or old.active = false) then
    perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 0));
    select staff_limit into v_limit from public.organizations where id = new.organization_id and status = 'active' for update;
    if v_limit is null then raise exception 'ORGANIZATION_NOT_ACTIVE'; end if;
    select count(*) into v_count from public.profiles where organization_id = new.organization_id and active = true;
    if v_count >= v_limit then raise exception 'ORGANIZATION_STAFF_LIMIT_REACHED'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_enforce_tenant on public.profiles;
create trigger profiles_enforce_tenant before insert or update of organization_id, branch_id, role, active on public.profiles
for each row execute function public.enforce_profile_tenant();

create or replace function public.seed_employee_work_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role in ('branch_admin'::public.app_role, 'staff'::public.app_role) then
    insert into public.employee_work_schedules(user_id, weekday, day_type, arrival_time, departure_time)
    values
      (new.id, 1, 'full_day', new.expected_arrival, new.expected_departure),
      (new.id, 2, 'full_day', new.expected_arrival, new.expected_departure),
      (new.id, 3, 'full_day', new.expected_arrival, new.expected_departure),
      (new.id, 4, 'full_day', new.expected_arrival, new.expected_departure),
      (new.id, 5, 'full_day', new.expected_arrival, new.expected_departure),
      (new.id, 6, 'half_day', new.expected_arrival, greatest(new.expected_arrival + interval '1 minute', least(new.expected_departure, time '13:00'))),
      (new.id, 7, 'off', new.expected_arrival, new.expected_departure)
    on conflict (user_id, weekday) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_branch_tenant_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if new.branch_id is null then return new; end if;
  select organization_id into v_org from public.branches where id = new.branch_id;
  if v_org is null or v_org <> new.organization_id then raise exception 'BRANCH_OUTSIDE_ORGANIZATION'; end if;
  return new;
end;
$$;
drop trigger if exists invitations_enforce_branch_tenant on public.organization_invitations;
create trigger invitations_enforce_branch_tenant before insert or update of organization_id, branch_id on public.organization_invitations
for each row execute function public.enforce_branch_tenant_child();
drop trigger if exists calendar_notes_enforce_branch_tenant on public.calendar_notes;
create trigger calendar_notes_enforce_branch_tenant before insert or update of organization_id, branch_id on public.calendar_notes
for each row execute function public.enforce_branch_tenant_child();
drop trigger if exists company_holidays_enforce_branch_tenant on public.company_holidays;
create trigger company_holidays_enforce_branch_tenant before insert or update of organization_id, branch_id on public.company_holidays
for each row when (new.organization_id is not null) execute function public.enforce_branch_tenant_child();

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
    employee_code, expected_arrival, expected_departure, monthly_leave_days,
    annual_leave_days, must_reset_password, active, created_by
  ) values (
    p_user_id, v_invite.organization_id, lower(v_invite.invited_email), v_invite.full_name,
    v_invite.phone, v_invite.role, v_invite.branch_id, v_invite.job_title,
    nullif(v_invite.employee_code, ''), v_invite.expected_arrival, v_invite.expected_departure,
    v_invite.monthly_leave_days, v_invite.annual_leave_days, false, true, v_invite.created_by
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

create or replace function public.approve_branch_setup(
  p_submission_id uuid,
  p_admin_id uuid
) returns public.branches
language plpgsql security definer set search_path = '' as $$
declare
  v_submission public.branch_setup_submissions;
  v_invite public.branch_setup_invites;
  v_admin public.profiles;
  v_result public.branches;
begin
  select * into v_admin from public.profiles where id = p_admin_id and active = true;
  if v_admin.role <> 'company_admin'::public.app_role or v_admin.organization_id is null then raise exception 'COMPANY_ADMIN_REQUIRED'; end if;
  select * into v_submission from public.branch_setup_submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'SUBMISSION_NOT_FOUND'; end if;
  select * into v_invite from public.branch_setup_invites where id = v_submission.invite_id for update;
  if v_invite.organization_id <> v_admin.organization_id then raise exception 'INVITE_OUTSIDE_ORGANIZATION'; end if;
  if v_submission.created_branch_id is not null then
    select * into v_result from public.branches where id = v_submission.created_branch_id;
    return v_result;
  end if;
  if v_invite.status <> 'submitted' then raise exception 'SUBMISSION_NOT_PENDING'; end if;
  insert into public.branches(
    organization_id, name, code, address, latitude, longitude, radius_m, verification_mode, created_by
  ) values (
    v_invite.organization_id, v_invite.proposed_name, v_invite.proposed_code, v_submission.address,
    v_submission.latitude, v_submission.longitude, v_invite.radius_m, 'gps_only', p_admin_id
  ) returning * into v_result;
  update public.branch_setup_submissions set created_branch_id = v_result.id, reviewed_by = p_admin_id, reviewed_at = now() where id = v_submission.id;
  update public.branch_setup_invites set status = 'approved', approved_at = now() where id = v_invite.id;
  return v_result;
end;
$$;
revoke all on function public.approve_branch_setup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_branch_setup(uuid, uuid) to service_role;

create or replace function public.platform_organization_summary(p_actor_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  billing_email text,
  plan text,
  staff_limit integer,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  member_count bigint,
  branch_count bigint,
  owner_id uuid,
  owner_name text,
  owner_email text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.role = 'super_admin'::public.app_role and p.active = true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  return query
  select o.id, o.name, o.slug, o.billing_email, o.plan, o.staff_limit, o.status,
    o.created_at, o.updated_at,
    (select count(*) from public.profiles p where p.organization_id = o.id and p.active = true),
    (select count(*) from public.branches b where b.organization_id = o.id and b.active = true),
    owner.id, owner.full_name, owner.email
  from public.organizations o
  left join lateral (
    select p.id, p.full_name, p.email from public.profiles p
    where p.organization_id = o.id and p.role = 'company_admin'::public.app_role and p.active = true
    order by p.created_at limit 1
  ) owner on true
  order by o.created_at desc;
end;
$$;
revoke all on function public.platform_organization_summary(uuid) from public, anon, authenticated;
grant execute on function public.platform_organization_summary(uuid) to service_role;

create or replace function public.update_organization_controls(
  p_actor_id uuid,
  p_organization_id uuid,
  p_status text default null,
  p_staff_limit integer default null
) returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_organization public.organizations;
  v_active_members integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.role = 'super_admin'::public.app_role and p.active = true
  ) then raise exception 'PLATFORM_ADMIN_REQUIRED'; end if;
  if p_status is not null and p_status not in ('active', 'suspended') then raise exception 'INVALID_ORGANIZATION_STATUS'; end if;
  if p_staff_limit is not null and (p_staff_limit < 1 or p_staff_limit > 100000) then raise exception 'INVALID_STAFF_LIMIT'; end if;
  select * into v_organization from public.organizations where id = p_organization_id for update;
  if v_organization.id is null then raise exception 'ORGANIZATION_NOT_FOUND'; end if;
  select count(*) into v_active_members from public.profiles where organization_id = p_organization_id and active = true;
  if p_staff_limit is not null and p_staff_limit < v_active_members then raise exception 'STAFF_LIMIT_BELOW_ACTIVE_MEMBERS:%', v_active_members; end if;
  update public.organizations set
    status = coalesce(p_status, status),
    staff_limit = coalesce(p_staff_limit, staff_limit)
  where id = p_organization_id
  returning * into v_organization;
  return v_organization;
end;
$$;
revoke all on function public.update_organization_controls(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.update_organization_controls(uuid, uuid, text, integer) to service_role;

-- Tenant-aware read and write policies. Service-role platform operations still perform explicit actor checks.
alter table public.organizations enable row level security;
alter table public.organization_invitations enable row level security;
revoke all on public.organizations, public.organization_invitations from anon;
revoke all on public.organizations, public.organization_invitations from authenticated;
grant select on public.organizations to authenticated;
grant select, insert, update on public.organization_invitations to authenticated;

do $policy_cleanup$
declare v_policy record;
begin
  for v_policy in select * from (values
    ('organizations', 'members read their organization'),
    ('organization_invitations', 'company admins manage invitations'),
    ('branches', 'tenant members read branches'),
    ('branches', 'company admins create branches'),
    ('branches', 'company admins update branches'),
    ('profiles', 'tenant profile visibility'),
    ('profiles', 'company admins create tenant profiles'),
    ('profiles', 'company admins update tenant profiles'),
    ('branch_networks', 'tenant admins read branch networks'),
    ('attendance_records', 'tenant attendance visibility'),
    ('attendance_attempts', 'tenant attempt visibility'),
    ('leave_requests', 'tenant leave visibility'),
    ('leave_requests', 'employees create their leave'),
    ('leave_requests', 'company admins manage tenant leave'),
    ('branch_setup_invites', 'company admins manage branch setup invites'),
    ('branch_setup_submissions', 'company admins read branch setup submissions'),
    ('calendar_notes', 'tenant members read calendar notes'),
    ('calendar_notes', 'company admins manage calendar notes'),
    ('employee_work_schedules', 'tenant schedule visibility'),
    ('employee_work_schedules', 'company admins manage schedules'),
    ('company_holidays', 'tenant members read holidays'),
    ('company_holidays', 'tenant members propose holidays'),
    ('company_holidays', 'company admins manage holidays'),
    ('salary_settings', 'tenant salary visibility'),
    ('salary_settings', 'company admins manage salary settings'),
    ('payroll_records', 'tenant payroll visibility'),
    ('payroll_records', 'company admins manage payroll'),
    ('payroll_preferences', 'tenant members read payroll preferences'),
    ('payroll_preferences', 'company admins manage payroll preferences'),
    ('attendance_absences', 'tenant missed attendance visibility'),
    ('attendance_absences', 'company admins remove tenant absences'),
    ('support_issues', 'tenant support issue visibility'),
    ('support_issues', 'users create support issues'),
    ('support_issues', 'company admins resolve support issues')
  ) as policies(table_name, policy_name)
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.policy_name, v_policy.table_name);
  end loop;
end;
$policy_cleanup$;

drop policy if exists "members read their organization" on public.organizations;
create policy "members read their organization" on public.organizations for select to authenticated using (
  id = (select public.current_profile_organization()) or (select public.current_profile_role()) = 'super_admin'::public.app_role
);
drop policy if exists "company admins manage invitations" on public.organization_invitations;
create policy "company admins manage invitations" on public.organization_invitations for all to authenticated using (
  organization_id = (select public.current_profile_organization()) and (
    (select public.current_profile_role()) = 'company_admin'::public.app_role
    or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and branch_id = (select public.current_profile_branch()))
  )
) with check (
  organization_id = (select public.current_profile_organization()) and (
    ((select public.current_profile_role()) = 'company_admin'::public.app_role and role in ('branch_admin'::public.app_role, 'staff'::public.app_role))
    or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and branch_id = (select public.current_profile_branch()) and role = 'staff'::public.app_role)
  )
);

drop policy if exists "authenticated read assigned branches" on public.branches;
create policy "tenant members read branches" on public.branches for select to authenticated using (
  organization_id = (select public.current_profile_organization())
);
drop policy if exists "company admins create branches" on public.branches;
create policy "company admins create branches" on public.branches for insert to authenticated with check (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
);
drop policy if exists "company admins update branches" on public.branches;
create policy "company admins update branches" on public.branches for update to authenticated using (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
) with check (organization_id = (select public.current_profile_organization()));
grant insert, update on public.branches to authenticated;

drop policy if exists "users and admins read profiles" on public.profiles;
create policy "tenant profile visibility" on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and organization_id = (select public.current_profile_organization()))
  or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and branch_id = (select public.current_profile_branch()))
);
create policy "company admins create tenant profiles" on public.profiles for insert to authenticated with check (
  (select public.current_profile_role()) = 'company_admin'::public.app_role
  and organization_id = (select public.current_profile_organization())
  and role in ('branch_admin'::public.app_role, 'staff'::public.app_role)
);
create policy "company admins update tenant profiles" on public.profiles for update to authenticated using (
  (select public.current_profile_role()) = 'company_admin'::public.app_role and organization_id = (select public.current_profile_organization())
) with check (organization_id = (select public.current_profile_organization()) and role in ('branch_admin'::public.app_role, 'staff'::public.app_role));
grant insert on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (email, full_name, phone, branch_id, job_title, employee_code, expected_arrival, expected_departure, monthly_leave_days, annual_leave_days, must_reset_password, active)
  on public.profiles to authenticated;

drop policy if exists "admins read branch networks" on public.branch_networks;
create policy "tenant admins read branch networks" on public.branch_networks for select to authenticated using (
  (select public.branch_organization(branch_id)) = (select public.current_profile_organization())
  and (select public.current_profile_role()) in ('company_admin'::public.app_role, 'branch_admin'::public.app_role)
);
drop policy if exists "users and admins read attendance" on public.attendance_records;
create policy "tenant attendance visibility" on public.attendance_records for select to authenticated using (
  user_id = (select auth.uid())
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.branch_organization(branch_id)) = (select public.current_profile_organization()))
  or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "users and admins read attempts" on public.attendance_attempts;
create policy "tenant attempt visibility" on public.attendance_attempts for select to authenticated using (
  user_id = (select auth.uid())
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.branch_organization(branch_id)) = (select public.current_profile_organization()))
  or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "users and admins read leave" on public.leave_requests;
create policy "tenant leave visibility" on public.leave_requests for select to authenticated using (
  user_id = (select auth.uid())
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization()))
  or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and exists (
    select 1 from public.profiles p where p.id = leave_requests.user_id and p.branch_id = (select public.current_profile_branch())
  ))
);
create policy "employees create their leave" on public.leave_requests for insert to authenticated with check (
  user_id = (select auth.uid()) and status = 'pending'::public.leave_status and reviewed_by is null and reviewed_at is null
);
create policy "company admins manage tenant leave" on public.leave_requests for all to authenticated using (
  (select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization())
) with check ((select public.profile_organization(user_id)) = (select public.current_profile_organization()));
grant insert, update, delete on public.leave_requests to authenticated;

drop policy if exists "super admins read branch setup invites" on public.branch_setup_invites;
create policy "company admins manage branch setup invites" on public.branch_setup_invites for all to authenticated using (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
) with check (organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role);
drop policy if exists "super admins read branch setup submissions" on public.branch_setup_submissions;
create policy "company admins read branch setup submissions" on public.branch_setup_submissions for select to authenticated using (
  exists (select 1 from public.branch_setup_invites i where i.id = branch_setup_submissions.invite_id and i.organization_id = (select public.current_profile_organization()))
  and (select public.current_profile_role()) = 'company_admin'::public.app_role
);
grant insert, update on public.branch_setup_invites to authenticated;

drop policy if exists "employees read applicable calendar notes" on public.calendar_notes;
create policy "tenant members read calendar notes" on public.calendar_notes for select to authenticated using (
  organization_id = (select public.current_profile_organization())
  and (branch_id is null or branch_id = (select public.current_profile_branch()) or (select public.current_profile_role()) = 'company_admin'::public.app_role)
);
create policy "company admins manage calendar notes" on public.calendar_notes for all to authenticated using (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
) with check (organization_id = (select public.current_profile_organization()));
grant insert, update, delete on public.calendar_notes to authenticated;

drop policy if exists "users and admins read schedules" on public.employee_work_schedules;
create policy "tenant schedule visibility" on public.employee_work_schedules for select to authenticated using (
  user_id = (select auth.uid())
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization()))
  or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and exists (
    select 1 from public.profiles p where p.id = employee_work_schedules.user_id and p.branch_id = (select public.current_profile_branch())
  ))
);
create policy "company admins manage schedules" on public.employee_work_schedules for all to authenticated using (
  (select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization())
) with check ((select public.profile_organization(user_id)) = (select public.current_profile_organization()));
grant insert, update, delete on public.employee_work_schedules to authenticated;

drop policy if exists "users read applicable holidays" on public.company_holidays;
create policy "tenant members read holidays" on public.company_holidays for select to authenticated using (
  (organization_id is null and source = 'official' and status = 'approved')
  or (organization_id = (select public.current_profile_organization()) and (
    status = 'approved' or proposed_by = (select auth.uid()) or (select public.current_profile_role()) = 'company_admin'::public.app_role
  ))
);
create policy "tenant members propose holidays" on public.company_holidays for insert to authenticated with check (
  organization_id = (select public.current_profile_organization()) and proposed_by = (select auth.uid()) and (
    ((select public.current_profile_role()) = 'company_admin'::public.app_role and source = 'admin' and status = 'approved')
    or ((select public.current_profile_role()) in ('branch_admin'::public.app_role, 'staff'::public.app_role) and source = 'staff' and status = 'pending' and reviewed_by is null and reviewed_at is null)
  )
);
create policy "company admins manage holidays" on public.company_holidays for update to authenticated using (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
) with check (organization_id = (select public.current_profile_organization()));
grant insert, update on public.company_holidays to authenticated;

drop policy if exists "users and admins read salary settings" on public.salary_settings;
create policy "tenant salary visibility" on public.salary_settings for select to authenticated using (
  user_id = (select auth.uid()) or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization()))
);
create policy "company admins manage salary settings" on public.salary_settings for all to authenticated using (
  (select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization())
) with check ((select public.profile_organization(user_id)) = (select public.current_profile_organization()));
grant insert, update on public.salary_settings to authenticated;

drop policy if exists "users and admins read payroll" on public.payroll_records;
create policy "tenant payroll visibility" on public.payroll_records for select to authenticated using (
  (user_id = (select auth.uid()) and status in ('finalized', 'paid'))
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization()))
);
create policy "company admins manage payroll" on public.payroll_records for all to authenticated using (
  (select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.profile_organization(user_id)) = (select public.current_profile_organization())
) with check ((select public.profile_organization(user_id)) = (select public.current_profile_organization()));
grant insert, update on public.payroll_records to authenticated;

drop policy if exists "authenticated read payroll preferences" on public.payroll_preferences;
create policy "tenant members read payroll preferences" on public.payroll_preferences for select to authenticated using (
  organization_id = (select public.current_profile_organization())
);
create policy "company admins manage payroll preferences" on public.payroll_preferences for all to authenticated using (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
) with check (organization_id = (select public.current_profile_organization()));
grant insert, update on public.payroll_preferences to authenticated;

drop policy if exists "users and admins read missed attendance" on public.attendance_absences;
create policy "tenant missed attendance visibility" on public.attendance_absences for select to authenticated using (
  user_id = (select auth.uid())
  or ((select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.branch_organization(branch_id)) = (select public.current_profile_organization()))
  or ((select public.current_profile_role()) = 'branch_admin'::public.app_role and branch_id = (select public.current_profile_branch()))
);
create policy "company admins remove tenant absences" on public.attendance_absences for delete to authenticated using (
  (select public.current_profile_role()) = 'company_admin'::public.app_role and (select public.branch_organization(branch_id)) = (select public.current_profile_organization())
);
grant delete on public.attendance_absences to authenticated;

drop policy if exists "users and admins read support issues" on public.support_issues;
create policy "tenant support issue visibility" on public.support_issues for select to authenticated using (
  reporter_id = (select auth.uid())
  or (organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role)
);
create policy "users create support issues" on public.support_issues for insert to authenticated with check (
  reporter_id = (select auth.uid()) and organization_id = (select public.current_profile_organization())
  and status = 'open' and resolved_by is null and resolved_at is null
);
create policy "company admins resolve support issues" on public.support_issues for update to authenticated using (
  organization_id = (select public.current_profile_organization()) and (select public.current_profile_role()) = 'company_admin'::public.app_role
) with check (organization_id = (select public.current_profile_organization()));
grant insert, update on public.support_issues to authenticated;

-- Create tenant defaults for every existing organization.
insert into public.payroll_preferences(organization_id, id, cycle_start_day)
select o.id, true, 15 from public.organizations o
on conflict (organization_id) do nothing;
