-- Standard office hours and per-employee half-day defaults.

alter table public.profiles alter column expected_arrival set default time '09:00';
alter table public.profiles alter column expected_departure set default time '17:00';

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
      (new.id, 6, 'half_day', time '09:00', time '14:00'),
      (new.id, 7, 'off', new.expected_arrival, new.expected_departure)
    on conflict (user_id, weekday) do nothing;
  end if;
  return new;
end;
$$;
