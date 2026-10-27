-- Per-employee weekly schedules and auditable Sri Lankan/company holidays.

create extension if not exists btree_gist;

create table if not exists public.employee_work_schedules (
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  day_type text not null check (day_type in ('full_day', 'half_day', 'off')),
  arrival_time time not null,
  departure_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, weekday),
  constraint schedule_time_order check (departure_time > arrival_time)
);

create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  end_date date,
  name text not null check (char_length(name) between 2 and 120),
  holiday_type text not null check (holiday_type in ('poya', 'public', 'company', 'special')),
  branch_id uuid references public.branches(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  source text not null check (source in ('official', 'admin', 'staff')),
  source_reference text,
  reason text check (reason is null or char_length(reason) between 4 and 500),
  proposed_by uuid constraint company_holidays_proposed_by_fkey references public.profiles(id) on delete set null,
  reviewed_by uuid constraint company_holidays_reviewed_by_fkey references public.profiles(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_holidays add column if not exists end_date date;
update public.company_holidays set end_date = holiday_date where end_date is null;
alter table public.company_holidays alter column end_date set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_holidays_date_order') then
    alter table public.company_holidays add constraint company_holidays_date_order check (end_date >= holiday_date);
  end if;
end $$;

create unique index if not exists company_holidays_global_unique_idx
  on public.company_holidays(holiday_date, name) where branch_id is null;
create unique index if not exists company_holidays_branch_unique_idx
  on public.company_holidays(holiday_date, name, branch_id) where branch_id is not null;
create index if not exists company_holidays_date_status_idx
  on public.company_holidays(holiday_date, status);
create index if not exists schedules_user_idx on public.employee_work_schedules(user_id, weekday);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_no_active_overlap') then
    alter table public.leave_requests add constraint leave_requests_no_active_overlap
      exclude using gist (
        user_id with =,
        daterange(start_date, end_date, '[]') with &&
      ) where (status in ('pending'::public.leave_status, 'approved'::public.leave_status));
  end if;
end;
$$;

drop trigger if exists employee_work_schedules_updated_at on public.employee_work_schedules;
create trigger employee_work_schedules_updated_at before update on public.employee_work_schedules
for each row execute function public.set_updated_at();
drop trigger if exists company_holidays_updated_at on public.company_holidays;
create trigger company_holidays_updated_at before update on public.company_holidays
for each row execute function public.set_updated_at();

create or replace function public.seed_employee_work_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role <> 'super_admin' then
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

drop trigger if exists profiles_seed_work_schedule on public.profiles;
create trigger profiles_seed_work_schedule after insert on public.profiles
for each row execute function public.seed_employee_work_schedule();

insert into public.employee_work_schedules(user_id, weekday, day_type, arrival_time, departure_time)
select p.id, d.weekday,
  case when d.weekday = 6 then 'half_day' when d.weekday = 7 then 'off' else 'full_day' end,
  p.expected_arrival,
  case when d.weekday = 6 then greatest(p.expected_arrival + interval '1 minute', least(p.expected_departure, time '13:00')) else p.expected_departure end
from public.profiles p cross join generate_series(1, 7) as d(weekday)
where p.role <> 'super_admin'
on conflict (user_id, weekday) do nothing;

create or replace function public.protect_attendance_workday()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_day_type text;
begin
  if not (tg_op = 'INSERT' or (old.clock_in is null and new.clock_in is not null)) then return new; end if;
  if exists (
    select 1 from public.company_holidays h
    where new.attendance_date between h.holiday_date and h.end_date and h.status = 'approved'
      and (h.branch_id is null or h.branch_id = new.branch_id)
  ) then raise exception 'HOLIDAY'; end if;
  if exists (
    select 1 from public.leave_requests l
    where l.user_id = new.user_id and l.status = 'approved'::public.leave_status
      and l.portion = 'full_day'::public.leave_portion
      and new.attendance_date between l.start_date and l.end_date
  ) then raise exception 'APPROVED_LEAVE'; end if;
  select s.day_type into v_day_type from public.employee_work_schedules s
    where s.user_id = new.user_id and s.weekday = extract(isodow from new.attendance_date)::smallint;
  if coalesce(v_day_type, case when extract(isodow from new.attendance_date) = 7 then 'off' else 'full_day' end) = 'off'
  then raise exception 'SCHEDULED_OFF'; end if;
  return new;
end;
$$;

drop trigger if exists attendance_workday_guard on public.attendance_records;
create trigger attendance_workday_guard before insert or update of clock_in on public.attendance_records
for each row execute function public.protect_attendance_workday();

create or replace function public.protect_full_day_leave_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.portion = 'full_day'::public.leave_portion
    and new.status in ('pending'::public.leave_status, 'approved'::public.leave_status)
    and exists (
      select 1 from public.attendance_records a
      where a.user_id = new.user_id and a.attendance_date between new.start_date and new.end_date
    )
  then raise exception 'LEAVE_ATTENDANCE_OVERLAP'; end if;
  return new;
end;
$$;

drop trigger if exists leave_attendance_overlap_guard on public.leave_requests;
create trigger leave_attendance_overlap_guard before insert or update of start_date, end_date, portion, status on public.leave_requests
for each row execute function public.protect_full_day_leave_overlap();

with official(holiday_date, name, holiday_type, source_reference) as (values
  ('2026-01-03'::date, 'Duruthu Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-01-15'::date, 'Tamil Thai Pongal Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-02-01'::date, 'Nawam Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-02-04'::date, 'Independence Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-02-15'::date, 'Maha Sivarathri Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-03-02'::date, 'Medin Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-03-21'::date, 'Id-Ul-Fitr (Ramazan Festival Day)', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-04-01'::date, 'Bak Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-04-03'::date, 'Good Friday', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-04-13'::date, 'Day Prior to Sinhala and Tamil New Year', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-04-14'::date, 'Sinhala and Tamil New Year Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-05-01'::date, 'Vesak Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-05-01'::date, 'May Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-05-28'::date, 'Id-Ul-Alha (Hadji Festival Day)', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-05-30'::date, 'Adhi Poson Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-05-31'::date, 'Day Following Vesak Full Moon Poya Day', 'public', 'Sri Lanka Gazette Extraordinary 2485/14 amendment'),
  ('2026-06-29'::date, 'Poson Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-07-29'::date, 'Esala Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-08-26'::date, 'Milad-Un-Nabi', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-08-27'::date, 'Nikini Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-09-26'::date, 'Binara Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-10-25'::date, 'Vap Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-11-08'::date, 'Deepavali Festival Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-11-24'::date, 'Il Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-12-23'::date, 'Unduvap Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2026-12-25'::date, 'Christmas Day', 'public', 'Sri Lanka Gazette Extraordinary 2438/22'),
  ('2027-01-15'::date, 'Tamil Thai Pongal Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-01-22'::date, 'Duruthu Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-02-04'::date, 'Independence Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-02-20'::date, 'Nawam Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-03-06'::date, 'Maha Sivarathri Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-03-10'::date, 'Id-Ul-Fitr (Ramazan Festival Day)', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-03-22'::date, 'Medin Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-03-26'::date, 'Good Friday', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-04-13'::date, 'Day Prior to Sinhala and Tamil New Year', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-04-14'::date, 'Sinhala and Tamil New Year Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-04-20'::date, 'Bak Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-05-01'::date, 'May Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-05-17'::date, 'Id-Ul-Alha (Hadji Festival Day)', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-05-19'::date, 'Vesak Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-05-20'::date, 'Day Following Vesak Full Moon Poya Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-06-18'::date, 'Poson Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-07-18'::date, 'Esala Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-08-15'::date, 'Milad-Un-Nabi', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-08-16'::date, 'Nikini Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-09-15'::date, 'Binara Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-10-15'::date, 'Vap Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-10-28'::date, 'Deepavali Festival Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-11-13'::date, 'Il Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-12-13'::date, 'Unduvap Full Moon Poya Day', 'poya', 'Sri Lanka Gazette Extraordinary 2493/05'),
  ('2027-12-25'::date, 'Christmas Day', 'public', 'Sri Lanka Gazette Extraordinary 2493/05')
)
insert into public.company_holidays(holiday_date, end_date, name, holiday_type, branch_id, status, source, source_reference, reviewed_at)
select official.holiday_date, official.holiday_date, official.name, official.holiday_type, null, 'approved', 'official', official.source_reference, now()
from official
where not exists (
  select 1 from public.company_holidays existing
  where existing.holiday_date = official.holiday_date and existing.name = official.name and existing.branch_id is null
);

alter table public.employee_work_schedules enable row level security;
alter table public.company_holidays enable row level security;
revoke all on public.employee_work_schedules, public.company_holidays from anon;
revoke all on public.employee_work_schedules, public.company_holidays from authenticated;
grant select on public.employee_work_schedules, public.company_holidays to authenticated;

drop policy if exists "users and admins read schedules" on public.employee_work_schedules;
create policy "users and admins read schedules" on public.employee_work_schedules for select to authenticated using (
  user_id = (select auth.uid()) or (select public.current_profile_role()) = 'super_admin'
);
drop policy if exists "users read applicable holidays" on public.company_holidays;
create policy "users read applicable holidays" on public.company_holidays for select to authenticated using (
  status = 'approved'
  and (branch_id is null or branch_id = (select public.current_profile_branch()))
  or (select public.current_profile_role()) = 'super_admin'
  or proposed_by = (select auth.uid())
);

alter table public.company_holidays replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_holidays'
    ) then
    alter publication supabase_realtime add table public.company_holidays;
  end if;
end;
$$;
