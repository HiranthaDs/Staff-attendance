-- Salary settings and auditable payroll-cycle snapshots.

create table if not exists public.salary_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  basic_salary numeric(12,2) not null default 0 check (basic_salary >= 0),
  fixed_allowances numeric(12,2) not null default 0 check (fixed_allowances >= 0),
  pay_cycle text not null default 'calendar_month' check (pay_cycle in ('calendar_month', 'fifteenth_cycle')),
  epf_enabled boolean not null default true,
  currency text not null default 'LKR' check (currency = 'LKR'),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  cycle_label text not null,
  calendar_days integer not null,
  scheduled_days numeric(6,2) not null default 0,
  attendance_days integer not null default 0,
  attendance_units numeric(6,2) not null default 0,
  full_leave_days numeric(6,2) not null default 0,
  paid_leave_days numeric(6,2) not null default 0,
  unpaid_leave_days numeric(6,2) not null default 0,
  short_leave_count integer not null default 0,
  short_leave_days numeric(6,2) not null default 0,
  absent_days numeric(6,2) not null default 0,
  holiday_days numeric(6,2) not null default 0,
  off_days numeric(6,2) not null default 0,
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  basic_salary numeric(12,2) not null default 0,
  fixed_allowances numeric(12,2) not null default 0,
  other_earnings numeric(12,2) not null default 0,
  attendance_deduction numeric(12,2) not null default 0,
  other_deductions numeric(12,2) not null default 0,
  employee_epf numeric(12,2) not null default 0,
  employer_epf numeric(12,2) not null default 0,
  employer_etf numeric(12,2) not null default 0,
  gross_pay numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  currency text not null default 'LKR' check (currency = 'LKR'),
  status text not null default 'draft' check (status in ('draft', 'finalized', 'paid')),
  notes text check (notes is null or char_length(notes) <= 1000),
  generated_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_period_order check (period_end >= period_start),
  unique(user_id, period_start, period_end)
);

create index if not exists payroll_user_period_idx on public.payroll_records(user_id, period_end desc);
create index if not exists payroll_period_status_idx on public.payroll_records(period_start, period_end, status);

drop trigger if exists salary_settings_updated_at on public.salary_settings;
create trigger salary_settings_updated_at before update on public.salary_settings for each row execute function public.set_updated_at();
drop trigger if exists payroll_records_updated_at on public.payroll_records;
create trigger payroll_records_updated_at before update on public.payroll_records for each row execute function public.set_updated_at();

alter table public.salary_settings enable row level security;
alter table public.payroll_records enable row level security;
revoke all on public.salary_settings, public.payroll_records from anon;
revoke all on public.salary_settings, public.payroll_records from authenticated;
grant select on public.salary_settings, public.payroll_records to authenticated;

drop policy if exists "users and admins read salary settings" on public.salary_settings;
create policy "users and admins read salary settings" on public.salary_settings for select to authenticated using (
  user_id = (select auth.uid()) or (select public.current_profile_role()) = 'super_admin'
);
drop policy if exists "users and admins read payroll" on public.payroll_records;
create policy "users and admins read payroll" on public.payroll_records for select to authenticated using (
  (user_id = (select auth.uid()) and status in ('finalized', 'paid'))
  or (select public.current_profile_role()) = 'super_admin'
);
