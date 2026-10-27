-- Branch-level attendance tolerances and live calendar updates.

alter table public.branches
  add column if not exists early_leave_grace_minutes integer not null default 10;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'branches_early_leave_grace_minutes_check'
      and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches
      add constraint branches_early_leave_grace_minutes_check
      check (early_leave_grace_minutes between 0 and 120) not valid;
  end if;
end;
$$;

alter table public.branches validate constraint branches_early_leave_grace_minutes_check;

-- Existing installations already have the v2 function. Rebuild it from its
-- catalog definition with the new early-departure tolerance applied. This
-- keeps the database as the final authority for calculated attendance flags.
do $migration$
declare
  function_record record;
  definition text;
begin
  for function_record in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_attendance_mark_v2'
  loop
    definition := pg_get_functiondef(function_record.oid);
    if position('v_branch.early_leave_grace_minutes' in definition) = 0 then
      definition := replace(
        definition,
        E'floor(extract(epoch from (v_expected_at - v_server_now)) / 60)::integer\n    );',
        E'floor(extract(epoch from (v_expected_at - v_server_now)) / 60)::integer\n        - v_branch.early_leave_grace_minutes\n    );'
      );
      if position('v_branch.early_leave_grace_minutes' in definition) = 0 then
        raise exception 'Could not upgrade record_attendance_mark_v2 for early-leave tolerance';
      end if;
      execute definition;
    end if;
  end loop;
end
$migration$;

alter table public.calendar_notes replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'calendar_notes'
    ) then
    alter publication supabase_realtime add table public.calendar_notes;
  end if;
end;
$$;
