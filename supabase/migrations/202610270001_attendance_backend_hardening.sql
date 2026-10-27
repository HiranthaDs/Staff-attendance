-- Attendance server hardening.
--
-- This migration is intentionally additive. The v1 attendance function remains
-- available so the application can be rolled over to the v2 contract without a
-- destructive deployment. All security-sensitive time/date decisions in v2 use
-- the database clock; p_now is retained as signed request evidence and must be
-- close to the database clock.

create extension if not exists pgcrypto;

create or replace function public.is_valid_ip_rule(p_rule text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  parsed_rule inet;
begin
  if btrim(p_rule) = '' then return false; end if;
  parsed_rule := btrim(p_rule)::inet;
  return true;
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.is_valid_ip_rule(text) from public, anon, authenticated;
grant execute on function public.is_valid_ip_rule(text) to service_role;

-- pgcrypto is installed in `extensions` on hosted Supabase projects and may be
-- installed in `public` in local PostgreSQL. Resolve the extension-owned digest
-- function from the catalogs so the security-definer RPCs keep an empty search
-- path without assuming either deployment layout.
create or replace function public.attendance_ip_sha256(p_value text)
returns text
language plpgsql
stable
strict
security definer
set search_path = ''
as $$
declare
  digest_schema name;
  result text;
begin
  select ns.nspname into digest_schema
  from pg_catalog.pg_extension ext
  join pg_catalog.pg_namespace ns on ns.oid = ext.extnamespace
  where ext.extname = 'pgcrypto';
  if digest_schema is null then raise exception 'PGCRYPTO_NOT_INSTALLED'; end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest($1, ''sha256''), ''hex'')',
    digest_schema
  ) into result using p_value;
  return result;
end;
$$;

revoke all on function public.attendance_ip_sha256(text) from public, anon, authenticated;
grant execute on function public.attendance_ip_sha256(text) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.branch_networks'::regclass
      and conname = 'branch_networks_ip_rule_valid'
  ) then
    alter table public.branch_networks
      add constraint branch_networks_ip_rule_valid
      check (public.is_valid_ip_rule(ip_rule)) not valid;
  end if;

  -- A NOT VALID check protects all new and changed rows. Validate existing data
  -- too when it is already clean, without making a legacy malformed row prevent
  -- the rest of this security migration from being installed.
  if not exists (
    select 1 from public.branch_networks
    where not public.is_valid_ip_rule(ip_rule)
  ) and exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.branch_networks'::regclass
      and conname = 'branch_networks_ip_rule_valid'
      and not convalidated
  ) then
    alter table public.branch_networks
      validate constraint branch_networks_ip_rule_valid;
  end if;
end;
$$;

create table if not exists public.attendance_challenges (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  action text not null check (action in ('clock_in', 'clock_out')),
  request_id uuid not null,
  ip_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  constraint attendance_challenge_request_identity check (request_id = id),
  constraint attendance_challenge_expiry_order
    check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  constraint attendance_challenge_ip_hash_valid
    check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  unique(user_id, request_id)
);

create index if not exists attendance_challenges_open_idx
  on public.attendance_challenges(user_id, branch_id, action, request_id, expires_at)
  where consumed_at is null;
create index if not exists attendance_challenges_expiry_idx
  on public.attendance_challenges(expires_at);

create table if not exists public.attendance_ip_claims (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  attendance_date date not null,
  client_ip inet not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attendance_record_id uuid not null references public.attendance_records(id) on delete cascade,
  first_request_id uuid not null,
  last_request_id uuid not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  constraint attendance_ip_claim_seen_order check (last_seen_at >= first_seen_at),
  unique(branch_id, attendance_date, client_ip)
);

create index if not exists attendance_ip_claims_user_date_idx
  on public.attendance_ip_claims(user_id, attendance_date desc);
create index if not exists attendance_ip_claims_record_idx
  on public.attendance_ip_claims(attendance_record_id);

alter table public.attendance_attempts
  add column if not exists request_id uuid,
  add column if not exists challenge_id uuid references public.attendance_challenges(id) on delete set null,
  add column if not exists attendance_record_id uuid references public.attendance_records(id) on delete set null,
  add column if not exists attendance_date date,
  add column if not exists reported_at timestamptz,
  add column if not exists ip_source text,
  add column if not exists matched_network_id uuid references public.branch_networks(id) on delete set null,
  add column if not exists sample_count integer,
  add column if not exists sample_span_ms integer,
  add column if not exists spread_m integer,
  add column if not exists policy_version text,
  add column if not exists calculated_status public.attendance_status,
  add column if not exists calculated_late_minutes integer,
  add column if not exists calculated_early_leave_minutes integer;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.attendance_attempts'::regclass
      and conname = 'attendance_attempts_evidence_valid'
  ) then
    alter table public.attendance_attempts
      add constraint attendance_attempts_evidence_valid check (
        (sample_count is null or sample_count between 0 and 100)
        and (sample_span_ms is null or sample_span_ms between 0 and 120000)
        and (spread_m is null or spread_m between 0 and 10000)
        and (ip_source is null or char_length(ip_source) between 1 and 80)
        and (policy_version is null or char_length(policy_version) between 1 and 80)
        and (calculated_late_minutes is null or calculated_late_minutes >= 0)
        and (calculated_early_leave_minutes is null or calculated_early_leave_minutes >= 0)
      ) not valid;
  end if;
end;
$$;

create unique index if not exists attendance_attempts_user_request_uidx
  on public.attendance_attempts(user_id, request_id)
  where request_id is not null;
create unique index if not exists attendance_attempts_challenge_uidx
  on public.attendance_attempts(challenge_id)
  where challenge_id is not null;
create index if not exists attendance_attempts_branch_date_idx
  on public.attendance_attempts(branch_id, attendance_date desc);
create index if not exists attendance_attempts_ip_date_idx
  on public.attendance_attempts(client_ip, attendance_date desc)
  where client_ip is not null;

alter table public.attendance_challenges enable row level security;
alter table public.attendance_ip_claims enable row level security;

revoke all on public.attendance_challenges, public.attendance_ip_claims from public, anon, authenticated;
grant select, insert, update, delete on public.attendance_challenges, public.attendance_ip_claims to service_role;

create or replace function public.record_attendance_mark_v2(
  p_user_id uuid,
  p_branch_id uuid,
  p_action text,
  p_now timestamptz,
  p_request_id uuid,
  p_challenge_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m integer,
  p_distance_m integer,
  p_client_ip text,
  p_ip_source text,
  p_matched_network_id uuid,
  p_gps_passed boolean,
  p_ip_passed boolean,
  p_status public.attendance_status,
  p_late_minutes integer,
  p_early_leave_minutes integer,
  p_sample_count integer,
  p_sample_span_ms integer,
  p_spread_m integer,
  p_policy_version text
) returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_server_now timestamptz := clock_timestamp();
  v_local_date date;
  v_profile public.profiles%rowtype;
  v_branch public.branches%rowtype;
  v_challenge public.attendance_challenges%rowtype;
  v_existing_attempt public.attendance_attempts%rowtype;
  v_result public.attendance_records%rowtype;
  v_network public.branch_networks%rowtype;
  v_client_ip inet;
  v_network_rule inet;
  v_claim public.attendance_ip_claims%rowtype;
  v_distance_a double precision;
  v_computed_distance_m integer;
  v_expected_at timestamptz;
  v_effective_status public.attendance_status;
  v_effective_late_minutes integer := 0;
  v_effective_early_leave_minutes integer := 0;
begin
  if p_user_id is null or p_branch_id is null or p_request_id is null or p_challenge_id is null then
    raise exception 'MISSING_REQUEST_IDENTITY';
  end if;
  if p_action is null or p_action not in ('clock_in', 'clock_out') then raise exception 'INVALID_ACTION'; end if;
  if p_gps_passed is null or p_ip_passed is null then
    raise exception 'MISSING_VERIFICATION_RESULT';
  end if;
  if p_now is null or abs(extract(epoch from (p_now - v_server_now))) > 120 then
    raise exception 'STALE_REQUEST_TIME';
  end if;
  if p_ip_source is null or char_length(btrim(p_ip_source)) not between 1 and 80 then
    raise exception 'INVALID_IP_SOURCE';
  end if;
  if p_policy_version is null or char_length(btrim(p_policy_version)) not between 1 and 80 then
    raise exception 'INVALID_POLICY_VERSION';
  end if;
  if p_late_minutes is null or p_late_minutes < 0
    or p_early_leave_minutes is null or p_early_leave_minutes < 0 then
    raise exception 'INVALID_ATTENDANCE_TOTALS';
  end if;
  if p_sample_count is null or p_sample_count not between 0 and 100
    or p_sample_span_ms is null or p_sample_span_ms not between 0 and 120000
    or p_spread_m is null or p_spread_m not between 0 and 10000 then
    raise exception 'INVALID_LOCATION_EVIDENCE';
  end if;

  -- Serializes retries carrying the same user/request pair, including retries
  -- that use a newly opened database connection.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_request_id::text, 0)
  );

  select * into v_existing_attempt
  from public.attendance_attempts
  where user_id = p_user_id and request_id = p_request_id;
  if found then
    if not v_existing_attempt.allowed
      or v_existing_attempt.branch_id is distinct from p_branch_id
      or v_existing_attempt.action is distinct from p_action
      or v_existing_attempt.challenge_id is distinct from p_challenge_id
      or v_existing_attempt.attendance_record_id is null then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_result from public.attendance_records
    where id = v_existing_attempt.attendance_record_id;
    if not found then raise exception 'IDEMPOTENT_RECORD_NOT_FOUND'; end if;
    return v_result;
  end if;

  select * into v_profile from public.profiles where id = p_user_id for share;
  if not found or not v_profile.active then raise exception 'EMPLOYEE_INACTIVE_OR_NOT_FOUND'; end if;
  if v_profile.role not in ('staff'::public.app_role, 'branch_admin'::public.app_role) then raise exception 'EMPLOYEE_ROLE_NOT_ALLOWED'; end if;
  if v_profile.must_reset_password then raise exception 'PASSWORD_RESET_REQUIRED'; end if;
  if v_profile.branch_id is distinct from p_branch_id then raise exception 'EMPLOYEE_BRANCH_MISMATCH'; end if;

  select * into v_branch from public.branches where id = p_branch_id for share;
  if not found or not v_branch.active then raise exception 'BRANCH_INACTIVE_OR_NOT_FOUND'; end if;

  v_local_date := (v_server_now at time zone v_branch.timezone)::date;

  select * into v_challenge
  from public.attendance_challenges
  where id = p_challenge_id
  for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_challenge.user_id <> p_user_id
    or v_challenge.branch_id <> p_branch_id
    or v_challenge.action <> p_action
    or v_challenge.request_id <> p_request_id then
    raise exception 'CHALLENGE_BINDING_MISMATCH';
  end if;
  if v_challenge.created_at > v_server_now + interval '10 seconds'
    or v_challenge.expires_at <= v_server_now then
    raise exception 'CHALLENGE_EXPIRED';
  end if;
  if v_challenge.consumed_at is not null then
    -- The advisory lock makes a committed retry visible here. This secondary
    -- lookup also handles a retry that waited on the challenge row lock.
    select * into v_existing_attempt
    from public.attendance_attempts
    where user_id = p_user_id and request_id = p_request_id;
    if found and v_existing_attempt.allowed and v_existing_attempt.attendance_record_id is not null then
      select * into v_result from public.attendance_records
      where id = v_existing_attempt.attendance_record_id;
      if found then return v_result; end if;
    end if;
    raise exception 'CHALLENGE_ALREADY_USED';
  end if;

  if p_client_ip is not null and btrim(p_client_ip) <> '' then
    begin
      v_client_ip := host(btrim(p_client_ip)::inet)::inet;
    exception when invalid_text_representation then
      raise exception 'INVALID_CLIENT_IP';
    end;
  end if;

  if (v_challenge.ip_hash is null) <> (v_client_ip is null) then
    raise exception 'CHALLENGE_IP_BINDING_MISMATCH';
  end if;
  if v_client_ip is not null
    and v_challenge.ip_hash <> public.attendance_ip_sha256(host(v_client_ip)) then
    raise exception 'CHALLENGE_IP_BINDING_MISMATCH';
  end if;

  if p_matched_network_id is not null then
    select * into v_network
    from public.branch_networks
    where id = p_matched_network_id and branch_id = p_branch_id and active = true;
    if not found then raise exception 'MATCHED_NETWORK_NOT_FOUND'; end if;
    if v_client_ip is null then raise exception 'MATCHED_NETWORK_WITHOUT_IP'; end if;
    begin
      v_network_rule := btrim(v_network.ip_rule)::inet;
    exception when invalid_text_representation then
      raise exception 'MATCHED_NETWORK_RULE_INVALID';
    end;
    if not (v_client_ip <<= v_network_rule) then raise exception 'CLIENT_IP_NETWORK_MISMATCH'; end if;
    if not p_ip_passed then raise exception 'IP_RESULT_MISMATCH'; end if;
  elsif p_ip_passed then
    raise exception 'IP_PASS_WITHOUT_MATCHED_NETWORK';
  end if;

  if p_gps_passed then
    if p_latitude is null or p_latitude not between -90 and 90
      or p_longitude is null or p_longitude not between -180 and 180
      or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 1000
      or p_distance_m is null or p_distance_m < 0
      or p_sample_count < 3 or p_sample_span_ms < 1500 then
      raise exception 'GPS_EVIDENCE_INVALID';
    end if;

    -- Independently recompute the submitted point-to-branch distance. This does
    -- not replace the Node.js sample consensus, but prevents trusting its distance.
    v_distance_a :=
      sin(radians(p_latitude - v_branch.latitude) / 2) ^ 2
      + cos(radians(v_branch.latitude)) * cos(radians(p_latitude))
      * sin(radians(p_longitude - v_branch.longitude) / 2) ^ 2;
    v_computed_distance_m := round(
      6371000 * 2 * atan2(
        sqrt(greatest(0::double precision, least(1::double precision, v_distance_a))),
        sqrt(greatest(0::double precision, 1 - least(1::double precision, v_distance_a)))
      )
    )::integer;
    if abs(v_computed_distance_m - p_distance_m) > 5 then
      raise exception 'GPS_DISTANCE_MISMATCH';
    end if;
    if not (
      (p_accuracy_m <= v_branch.max_accuracy_m
        and v_computed_distance_m <= v_branch.radius_m)
      or
      (p_accuracy_m <= greatest(v_branch.max_accuracy_m, least(200, v_branch.max_accuracy_m * 2))
        and v_computed_distance_m + p_accuracy_m <= v_branch.radius_m)
    ) then
      raise exception 'GPS_OUTSIDE_BRANCH_RADIUS';
    end if;
  end if;

  if (v_branch.verification_mode = 'gps_and_ip' and not (p_gps_passed and p_ip_passed))
    or (v_branch.verification_mode = 'gps_or_ip' and not (p_gps_passed or p_ip_passed))
    or (v_branch.verification_mode = 'gps_only' and not p_gps_passed) then
    raise exception 'PRESENCE_NOT_VERIFIED';
  end if;

  update public.attendance_challenges
  set consumed_at = v_server_now
  where id = p_challenge_id and consumed_at is null;
  if not found then raise exception 'CHALLENGE_ALREADY_USED'; end if;

  if p_action = 'clock_in' then
    if p_status is null then raise exception 'INVALID_ATTENDANCE_STATUS'; end if;
    v_expected_at := (v_local_date + v_profile.expected_arrival) at time zone v_branch.timezone;
    v_effective_late_minutes := greatest(
      0,
      floor(extract(epoch from (v_server_now - v_expected_at)) / 60)::integer
        - v_branch.late_grace_minutes
    );
    v_effective_status := case
      when v_effective_late_minutes > 0 then 'late'::public.attendance_status
      else 'present'::public.attendance_status
    end;
    insert into public.attendance_records (
      user_id, branch_id, attendance_date, clock_in, clock_in_latitude,
      clock_in_longitude, clock_in_accuracy_m, clock_in_distance_m, clock_in_ip,
      gps_passed, ip_passed, status, late_minutes
    ) values (
      p_user_id, p_branch_id, v_local_date, v_server_now, p_latitude,
      p_longitude, p_accuracy_m, coalesce(v_computed_distance_m, p_distance_m),
      case when v_client_ip is null then null else host(v_client_ip) end,
      p_gps_passed, p_ip_passed, v_effective_status, v_effective_late_minutes
    ) on conflict (user_id, attendance_date) do nothing
    returning * into v_result;

    if v_result.id is null then
      select * into v_result
      from public.attendance_records
      where user_id = p_user_id and attendance_date = v_local_date
      for update;
      if not found then raise exception 'ATTENDANCE_CONFLICT'; end if;
      if v_result.branch_id <> p_branch_id then raise exception 'ATTENDANCE_BRANCH_CONFLICT'; end if;
    end if;
  else
    -- Prefer today's open record, then yesterday's. This lets a night shift be
    -- closed after branch-local midnight without creating a second daily record.
    select * into v_result
    from public.attendance_records
    where user_id = p_user_id
      and branch_id = p_branch_id
      and attendance_date between v_local_date - 1 and v_local_date
      and clock_in is not null
      and clock_out is null
    order by attendance_date desc, clock_in desc
    limit 1
    for update;
    if not found then raise exception 'CLOCK_IN_REQUIRED_OR_ALREADY_CLOSED'; end if;

    v_expected_at := (v_result.attendance_date + v_profile.expected_departure)
      at time zone v_branch.timezone;
    v_effective_early_leave_minutes := greatest(
      0,
      floor(extract(epoch from (v_expected_at - v_server_now)) / 60)::integer
        - v_branch.early_leave_grace_minutes
    );

    update public.attendance_records set
      clock_out = v_server_now,
      clock_out_latitude = p_latitude,
      clock_out_longitude = p_longitude,
      clock_out_accuracy_m = p_accuracy_m,
      clock_out_distance_m = coalesce(v_computed_distance_m, p_distance_m),
      clock_out_ip = case when v_client_ip is null then null else host(v_client_ip) end,
      gps_passed = public.attendance_records.gps_passed and p_gps_passed,
      ip_passed = public.attendance_records.ip_passed and p_ip_passed,
      early_leave_minutes = v_effective_early_leave_minutes,
      work_minutes = greatest(0, floor(extract(epoch from (v_server_now - clock_in)) / 60)::integer),
      status = case
        when floor(extract(epoch from (v_server_now - clock_in)) / 60) < 240
          then 'partial'::public.attendance_status
        else status
      end
    where id = v_result.id
    returning * into v_result;
  end if;

  -- An IP positively matched to an active branch network is deliberately not
  -- claimed: many legitimate employees share that public address through NAT.
  -- All other observed IPs may identify only one employee per branch/work date.
  if v_client_ip is not null and p_matched_network_id is null then
    insert into public.attendance_ip_claims (
      branch_id, attendance_date, client_ip, user_id, attendance_record_id,
      first_request_id, last_request_id, first_seen_at, last_seen_at
    ) values (
      p_branch_id, v_result.attendance_date, v_client_ip, p_user_id, v_result.id,
      p_request_id, p_request_id, v_server_now, v_server_now
    ) on conflict (branch_id, attendance_date, client_ip) do update
      set last_request_id = excluded.last_request_id,
          last_seen_at = excluded.last_seen_at,
          attendance_record_id = excluded.attendance_record_id
      where public.attendance_ip_claims.user_id = excluded.user_id
    returning * into v_claim;
    if v_claim.id is null then raise exception 'IP_ALREADY_USED_BY_ANOTHER_EMPLOYEE'; end if;
  end if;

  insert into public.attendance_attempts (
    user_id, branch_id, action, allowed, reason, latitude, longitude, accuracy_m,
    distance_m, client_ip, gps_passed, ip_passed, request_id, challenge_id,
    attendance_record_id, attendance_date, reported_at, ip_source,
    matched_network_id, sample_count, sample_span_ms, spread_m, policy_version,
    calculated_status, calculated_late_minutes, calculated_early_leave_minutes
  ) values (
    p_user_id, p_branch_id, p_action, true, 'Verified', p_latitude, p_longitude,
    p_accuracy_m, coalesce(v_computed_distance_m, p_distance_m),
    case when v_client_ip is null then null else host(v_client_ip) end,
    p_gps_passed, p_ip_passed, p_request_id, p_challenge_id, v_result.id,
    v_result.attendance_date, p_now, btrim(p_ip_source), p_matched_network_id,
    p_sample_count, p_sample_span_ms, p_spread_m, btrim(p_policy_version),
    v_result.status, v_result.late_minutes, v_result.early_leave_minutes
  );

  return v_result;
end;
$$;

create or replace function public.record_attendance_denial_v2(
  p_user_id uuid,
  p_branch_id uuid,
  p_action text,
  p_now timestamptz,
  p_request_id uuid,
  p_challenge_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m integer,
  p_distance_m integer,
  p_client_ip text,
  p_ip_source text,
  p_matched_network_id uuid,
  p_gps_passed boolean,
  p_ip_passed boolean,
  p_status public.attendance_status,
  p_late_minutes integer,
  p_early_leave_minutes integer,
  p_sample_count integer,
  p_sample_span_ms integer,
  p_spread_m integer,
  p_policy_version text,
  p_reason text
) returns public.attendance_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_server_now timestamptz := clock_timestamp();
  v_local_date date;
  v_open_date date;
  v_profile public.profiles%rowtype;
  v_branch public.branches%rowtype;
  v_challenge public.attendance_challenges%rowtype;
  v_existing_attempt public.attendance_attempts%rowtype;
  v_result public.attendance_attempts%rowtype;
  v_network public.branch_networks%rowtype;
  v_client_ip inet;
  v_network_rule inet;
begin
  if p_user_id is null or p_branch_id is null or p_request_id is null or p_challenge_id is null then
    raise exception 'MISSING_REQUEST_IDENTITY';
  end if;
  if p_action is null or p_action not in ('clock_in', 'clock_out') then raise exception 'INVALID_ACTION'; end if;
  if p_gps_passed is null or p_ip_passed is null then
    raise exception 'MISSING_VERIFICATION_RESULT';
  end if;
  if p_now is null or abs(extract(epoch from (p_now - v_server_now))) > 120 then
    raise exception 'STALE_REQUEST_TIME';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'INVALID_DENIAL_REASON';
  end if;
  if p_ip_source is null or char_length(btrim(p_ip_source)) not between 1 and 80 then
    raise exception 'INVALID_IP_SOURCE';
  end if;
  if p_policy_version is null or char_length(btrim(p_policy_version)) not between 1 and 80 then
    raise exception 'INVALID_POLICY_VERSION';
  end if;
  if p_late_minutes is null or p_late_minutes < 0
    or p_early_leave_minutes is null or p_early_leave_minutes < 0
    or p_sample_count is null or p_sample_count not between 0 and 100
    or p_sample_span_ms is null or p_sample_span_ms not between 0 and 120000
    or p_spread_m is null or p_spread_m not between 0 and 10000 then
    raise exception 'INVALID_DENIAL_EVIDENCE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_request_id::text, 0)
  );

  select * into v_existing_attempt
  from public.attendance_attempts
  where user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_existing_attempt.allowed
      or v_existing_attempt.branch_id is distinct from p_branch_id
      or v_existing_attempt.action is distinct from p_action
      or v_existing_attempt.challenge_id is distinct from p_challenge_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing_attempt;
  end if;

  select * into v_profile from public.profiles where id = p_user_id for share;
  if not found or not v_profile.active then raise exception 'EMPLOYEE_INACTIVE_OR_NOT_FOUND'; end if;
  if v_profile.role not in ('staff'::public.app_role, 'branch_admin'::public.app_role) then raise exception 'EMPLOYEE_ROLE_NOT_ALLOWED'; end if;
  if v_profile.must_reset_password then raise exception 'PASSWORD_RESET_REQUIRED'; end if;
  if v_profile.branch_id is distinct from p_branch_id then raise exception 'EMPLOYEE_BRANCH_MISMATCH'; end if;

  select * into v_branch from public.branches where id = p_branch_id for share;
  if not found or not v_branch.active then raise exception 'BRANCH_INACTIVE_OR_NOT_FOUND'; end if;
  v_local_date := (v_server_now at time zone v_branch.timezone)::date;

  -- Associate a denied after-midnight clock-out with the prior open work date in
  -- the audit trail, while leaving the attendance record untouched.
  if p_action = 'clock_out' then
    select attendance_date into v_open_date
    from public.attendance_records
    where user_id = p_user_id
      and branch_id = p_branch_id
      and attendance_date between v_local_date - 1 and v_local_date
      and clock_in is not null
      and clock_out is null
    order by attendance_date desc, clock_in desc
    limit 1;
    if found then v_local_date := v_open_date; end if;
  end if;

  select * into v_challenge
  from public.attendance_challenges
  where id = p_challenge_id
  for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_challenge.user_id <> p_user_id
    or v_challenge.branch_id <> p_branch_id
    or v_challenge.action <> p_action
    or v_challenge.request_id <> p_request_id then
    raise exception 'CHALLENGE_BINDING_MISMATCH';
  end if;
  if v_challenge.created_at > v_server_now + interval '10 seconds'
    or v_challenge.expires_at <= v_server_now then
    raise exception 'CHALLENGE_EXPIRED';
  end if;
  if v_challenge.consumed_at is not null then
    select * into v_existing_attempt from public.attendance_attempts
    where user_id = p_user_id and request_id = p_request_id;
    if found and not v_existing_attempt.allowed then return v_existing_attempt; end if;
    raise exception 'CHALLENGE_ALREADY_USED';
  end if;

  if p_client_ip is not null and btrim(p_client_ip) <> '' then
    begin
      v_client_ip := host(btrim(p_client_ip)::inet)::inet;
    exception when invalid_text_representation then
      raise exception 'INVALID_CLIENT_IP';
    end;
  end if;

  if (v_challenge.ip_hash is null) <> (v_client_ip is null) then
    raise exception 'CHALLENGE_IP_BINDING_MISMATCH';
  end if;
  if v_client_ip is not null
    and v_challenge.ip_hash <> public.attendance_ip_sha256(host(v_client_ip)) then
    raise exception 'CHALLENGE_IP_BINDING_MISMATCH';
  end if;

  if p_matched_network_id is not null then
    select * into v_network from public.branch_networks
    where id = p_matched_network_id and branch_id = p_branch_id and active = true;
    if not found then raise exception 'MATCHED_NETWORK_NOT_FOUND'; end if;
    if v_client_ip is null then raise exception 'MATCHED_NETWORK_WITHOUT_IP'; end if;
    begin
      v_network_rule := btrim(v_network.ip_rule)::inet;
    exception when invalid_text_representation then
      raise exception 'MATCHED_NETWORK_RULE_INVALID';
    end;
    if not (v_client_ip <<= v_network_rule) then raise exception 'CLIENT_IP_NETWORK_MISMATCH'; end if;
    if not p_ip_passed then raise exception 'IP_RESULT_MISMATCH'; end if;
  elsif p_ip_passed then
    raise exception 'IP_PASS_WITHOUT_MATCHED_NETWORK';
  end if;

  update public.attendance_challenges
  set consumed_at = v_server_now
  where id = p_challenge_id and consumed_at is null;
  if not found then raise exception 'CHALLENGE_ALREADY_USED'; end if;

  insert into public.attendance_attempts (
    user_id, branch_id, action, allowed, reason, latitude, longitude, accuracy_m,
    distance_m, client_ip, gps_passed, ip_passed, request_id, challenge_id,
    attendance_date, reported_at, ip_source, matched_network_id, sample_count,
    sample_span_ms, spread_m, policy_version, calculated_status,
    calculated_late_minutes, calculated_early_leave_minutes
  ) values (
    p_user_id, p_branch_id, p_action, false, btrim(p_reason), p_latitude,
    p_longitude, p_accuracy_m, p_distance_m,
    case when v_client_ip is null then null else host(v_client_ip) end,
    p_gps_passed, p_ip_passed, p_request_id, p_challenge_id, v_local_date,
    p_now, btrim(p_ip_source), p_matched_network_id, p_sample_count,
    p_sample_span_ms, p_spread_m, btrim(p_policy_version), p_status,
    p_late_minutes, p_early_leave_minutes
  ) returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.record_attendance_mark_v2(
  uuid, uuid, text, timestamptz, uuid, uuid, double precision, double precision,
  integer, integer, text, text, uuid, boolean, boolean, public.attendance_status,
  integer, integer, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_attendance_mark_v2(
  uuid, uuid, text, timestamptz, uuid, uuid, double precision, double precision,
  integer, integer, text, text, uuid, boolean, boolean, public.attendance_status,
  integer, integer, integer, integer, integer, text
) to service_role;
revoke all on function public.record_attendance_denial_v2(
  uuid, uuid, text, timestamptz, uuid, uuid, double precision, double precision,
  integer, integer, text, text, uuid, boolean, boolean, public.attendance_status,
  integer, integer, integer, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.record_attendance_denial_v2(
  uuid, uuid, text, timestamptz, uuid, uuid, double precision, double precision,
  integer, integer, text, text, uuid, boolean, boolean, public.attendance_status,
  integer, integer, integer, integer, integer, text, text
) to service_role;
