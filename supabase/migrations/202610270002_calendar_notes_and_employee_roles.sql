-- Shared staff calendar and least-privilege role alignment.

create table if not exists public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  note_date date not null,
  title text not null check (char_length(title) between 2 and 100),
  note text check (note is null or char_length(note) <= 500),
  branch_id uuid references public.branches(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_notes_date_idx on public.calendar_notes(note_date);
create index if not exists calendar_notes_branch_date_idx on public.calendar_notes(branch_id, note_date);

drop trigger if exists calendar_notes_updated_at on public.calendar_notes;
create trigger calendar_notes_updated_at before update on public.calendar_notes
for each row execute function public.set_updated_at();

alter table public.calendar_notes enable row level security;
revoke all on public.calendar_notes from anon, authenticated;
grant select on public.calendar_notes to authenticated;

drop policy if exists "employees read applicable calendar notes" on public.calendar_notes;
create policy "employees read applicable calendar notes" on public.calendar_notes
for select to authenticated using (
  (select public.current_profile_role()) = 'super_admin'
  or branch_id is null
  or branch_id = (select public.current_profile_branch())
);

-- Branch-admin accounts intentionally have the same data visibility as staff.
drop policy if exists "users and admins read profiles" on public.profiles;
create policy "users and admins read profiles" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or (select public.current_profile_role()) = 'super_admin'
);

drop policy if exists "admins read branch networks" on public.branch_networks;
create policy "admins read branch networks" on public.branch_networks for select to authenticated using (
  (select public.current_profile_role()) = 'super_admin'
);

drop policy if exists "users and admins read attendance" on public.attendance_records;
create policy "users and admins read attendance" on public.attendance_records for select to authenticated using (
  user_id = (select auth.uid()) or (select public.current_profile_role()) = 'super_admin'
);

drop policy if exists "users and admins read attempts" on public.attendance_attempts;
create policy "users and admins read attempts" on public.attendance_attempts for select to authenticated using (
  user_id = (select auth.uid()) or (select public.current_profile_role()) = 'super_admin'
);

drop policy if exists "users and admins read leave" on public.leave_requests;
create policy "users and admins read leave" on public.leave_requests for select to authenticated using (
  user_id = (select auth.uid()) or (select public.current_profile_role()) = 'super_admin'
);

-- Existing installations may already have v2 attendance RPCs. Relax their
-- employee-role guard so a legacy branch_admin account can use the staff app.
do $migration$
declare
  function_record record;
  definition text;
begin
  for function_record in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('record_attendance_mark_v2', 'record_attendance_denial_v2')
  loop
    definition := pg_get_functiondef(function_record.oid);
    definition := replace(
      definition,
      'if v_profile.role <> ''staff''::public.app_role then raise exception ''EMPLOYEE_ROLE_NOT_ALLOWED''; end if;',
      'if v_profile.role not in (''staff''::public.app_role, ''branch_admin''::public.app_role) then raise exception ''EMPLOYEE_ROLE_NOT_ALLOWED''; end if;'
    );
    execute definition;
  end loop;
end
$migration$;
