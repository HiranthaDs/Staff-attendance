-- Attendance is verified only by a fresh browser location inside the branch radius.
-- Legacy verification-mode and network rows are retained for audit compatibility,
-- but they are no longer active inputs to attendance decisions.

alter table public.branches
  alter column verification_mode set default 'gps_only';

update public.branches
set verification_mode = 'gps_only'
where verification_mode <> 'gps_only';

alter table public.branch_setup_invites
  alter column verification_mode set default 'gps_only';

update public.branch_setup_invites
set verification_mode = 'gps_only'
where verification_mode <> 'gps_only';

update public.branch_networks
set active = false
where active = true;

-- Patch the hardened function in place so existing installations accept one
-- fresh reading and make the branch radius the sole presence decision.
do $migration$
declare
  function_oid oid;
  original_definition text;
  updated_definition text;
begin
  select p.oid
  into function_oid
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_attendance_mark_v2'
  order by p.oid
  limit 1;

  if function_oid is not null then
    original_definition := pg_get_functiondef(function_oid);
    updated_definition := replace(
      original_definition,
      'or p_sample_count < 3 or p_sample_span_ms < 1500',
      'or p_sample_count < 1 or p_sample_span_ms < 0'
    );
    updated_definition := replace(
      updated_definition,
$old$if not (
      (p_accuracy_m <= v_branch.max_accuracy_m
        and v_computed_distance_m <= v_branch.radius_m)
      or
      (p_accuracy_m <= greatest(v_branch.max_accuracy_m, least(200, v_branch.max_accuracy_m * 2))
        and v_computed_distance_m + p_accuracy_m <= v_branch.radius_m)
    ) then$old$,
$new$if p_accuracy_m > greatest(v_branch.max_accuracy_m, 200)
      or v_computed_distance_m > v_branch.radius_m then$new$
    );
    updated_definition := replace(
      updated_definition,
$old$if (v_branch.verification_mode = 'gps_and_ip' and not (p_gps_passed and p_ip_passed))
    or (v_branch.verification_mode = 'gps_or_ip' and not (p_gps_passed or p_ip_passed))
    or (v_branch.verification_mode = 'gps_only' and not p_gps_passed) then$old$,
$new$if not p_gps_passed then$new$
    );

    if updated_definition <> original_definition then
      execute updated_definition;
    end if;
  end if;
end;
$migration$;
