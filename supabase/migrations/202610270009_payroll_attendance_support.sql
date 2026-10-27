-- Accountant cycle controls, explicit missed-attendance records and staff issue reporting.

create table if not exists public.payroll_preferences (
  id boolean primary key default true check (id = true),
  cycle_start_day smallint not null default 15 check (cycle_start_day between 1 and 28),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.payroll_preferences(id, cycle_start_day)
values (true, 15)
on conflict (id) do nothing;

alter table public.salary_settings drop constraint if exists salary_settings_pay_cycle_check;
alter table public.salary_settings add constraint salary_settings_pay_cycle_check
  check (pay_cycle in ('calendar_month', 'fifteenth_cycle', 'custom_cycle'));

create table if not exists public.attendance_absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  attendance_date date not null,
  absence_units numeric(4,2) not null default 1 check (absence_units in (0.5, 1)),
  scheduled_arrival time not null,
  scheduled_departure time not null,
  reason text not null default 'missed_attendance' check (reason in ('missed_attendance')),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, attendance_date)
);

create index if not exists attendance_absences_user_date_idx
  on public.attendance_absences(user_id, attendance_date desc);
create index if not exists attendance_absences_unacknowledged_idx
  on public.attendance_absences(user_id, attendance_date desc)
  where acknowledged_at is null;

create table if not exists public.support_issues (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('attendance', 'location', 'leave', 'schedule', 'payroll', 'app', 'other')),
  message text not null check (char_length(message) between 4 and 1000),
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_issues_status_created_idx
  on public.support_issues(status, created_at desc);

drop trigger if exists payroll_preferences_updated_at on public.payroll_preferences;
create trigger payroll_preferences_updated_at before update on public.payroll_preferences
for each row execute function public.set_updated_at();
drop trigger if exists attendance_absences_updated_at on public.attendance_absences;
create trigger attendance_absences_updated_at before update on public.attendance_absences
for each row execute function public.set_updated_at();
drop trigger if exists support_issues_updated_at on public.support_issues;
create trigger support_issues_updated_at before update on public.support_issues
for each row execute function public.set_updated_at();

alter table public.payroll_preferences enable row level security;
alter table public.attendance_absences enable row level security;
alter table public.support_issues enable row level security;

revoke all on public.payroll_preferences, public.attendance_absences, public.support_issues from anon;
revoke all on public.payroll_preferences, public.attendance_absences, public.support_issues from authenticated;
grant select on public.payroll_preferences, public.attendance_absences, public.support_issues to authenticated;
grant update on public.attendance_absences to authenticated;

drop policy if exists "authenticated read payroll preferences" on public.payroll_preferences;
create policy "authenticated read payroll preferences" on public.payroll_preferences
for select to authenticated using (true);

drop policy if exists "users and admins read missed attendance" on public.attendance_absences;
create policy "users and admins read missed attendance" on public.attendance_absences
for select to authenticated using (
  user_id = (select auth.uid())
  or (select public.current_profile_role()) = 'super_admin'
  or ((select public.current_profile_role()) = 'branch_admin' and branch_id = (select public.current_profile_branch()))
);
drop policy if exists "users acknowledge missed attendance" on public.attendance_absences;
create policy "users acknowledge missed attendance" on public.attendance_absences
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "users and admins read support issues" on public.support_issues;
create policy "users and admins read support issues" on public.support_issues
for select to authenticated using (
  reporter_id = (select auth.uid())
  or (select public.current_profile_role()) = 'super_admin'
);
