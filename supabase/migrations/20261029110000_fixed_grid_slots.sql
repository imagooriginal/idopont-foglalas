-- Use fixed company-specific grid slots and reserve complete grid blocks.

begin;

alter table public.companies
  alter column slot_interval_minutes set default 30;

grant select (slot_interval_minutes) on public.companies to anon;

create or replace function public.list_available_slots(
  p_company_id uuid,
  p_service_id uuid,
  p_day date
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_duration integer;
  v_interval integer;
  v_slot_duration integer;
  v_now timestamptz := statement_timestamp();
begin
  select c.time_zone, c.slot_interval_minutes, s.idotartam_percben
    into v_timezone, v_interval, v_duration
  from public.companies c
  join public.services s on s.cég_id = c.id
  where c.id = p_company_id
    and s.id = p_service_id
    and c.status = 'active';

  if not found then
    raise exception 'Company or service is unavailable.';
  end if;

  v_slot_duration :=
    ceil(v_duration::numeric / v_interval)::integer * v_interval;

  return query
  select local_slots.local_start at time zone v_timezone
  from public.company_business_hours h
  cross join lateral generate_series(
    p_day + h.opens_at,
    p_day + h.closes_at - make_interval(mins => v_duration),
    make_interval(mins => v_interval)
  ) as local_slots(local_start)
  where h.company_id = p_company_id
    and h.weekday = extract(dow from p_day)::smallint
    and (local_slots.local_start at time zone v_timezone) > v_now
    and not exists (
      select 1
      from public.bookings b
      where b.cég_id = p_company_id
        and b.status in ('pending', 'confirmed')
        and (b.status = 'confirmed' or b.locked_until > v_now)
        and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
            && tstzrange(
              local_slots.local_start at time zone v_timezone,
              (local_slots.local_start at time zone v_timezone)
                + make_interval(mins => v_slot_duration),
              '[)'
            )
    )
    and not exists (
      select 1
      from public.manual_blockouts m
      where m.cég_id = p_company_id
        and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
            && tstzrange(
              local_slots.local_start at time zone v_timezone,
              (local_slots.local_start at time zone v_timezone)
                + make_interval(mins => v_slot_duration),
              '[)'
            )
    )
  order by local_slots.local_start;
end;
$$;

create or replace function public.create_booking_lock(
  p_company_id uuid,
  p_service_id uuid,
  p_start timestamptz,
  p_vehicle_make text,
  p_vehicle_model text,
  p_vehicle_registration text
)
returns table (booking_id uuid, lock_token uuid, locked_until timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_duration integer;
  v_slot_duration integer;
  v_open time;
  v_close time;
  v_local_start timestamp;
  v_local_close timestamp;
  v_minutes_from_open integer;
  v_now timestamptz;
  v_booking_id uuid;
  v_lock_token uuid := gen_random_uuid();
  v_locked_until timestamptz;
begin
  if p_start is null
    or nullif(trim(p_vehicle_make), '') is null
    or nullif(trim(p_vehicle_model), '') is null
    or nullif(trim(p_vehicle_registration), '') is null
    or length(trim(p_vehicle_make)) > 100
    or length(trim(p_vehicle_model)) > 100
    or length(trim(p_vehicle_registration)) > 20
  then
    raise exception 'A valid time and all vehicle fields are required.';
  end if;

  select c.* into v_company
  from public.companies c
  where c.id = p_company_id
    and c.status = 'active'
  for update;

  if not found then
    raise exception 'Company is unavailable.';
  end if;

  v_now := clock_timestamp();
  v_locked_until := v_now + interval '5 minutes';

  select s.idotartam_percben into v_duration
  from public.services s
  where s.id = p_service_id
    and s.cég_id = p_company_id;

  if not found then
    raise exception 'Service does not belong to this company.';
  end if;

  v_slot_duration :=
    ceil(v_duration::numeric / v_company.slot_interval_minutes)::integer
      * v_company.slot_interval_minutes;
  v_local_start := p_start at time zone v_company.time_zone;

  select h.opens_at, h.closes_at
    into v_open, v_close
  from public.company_business_hours h
  where h.company_id = p_company_id
    and h.weekday = extract(dow from v_local_start)::smallint;

  if not found then
    raise exception 'The company is closed on the selected day.';
  end if;

  v_local_close := v_local_start::date + v_close;
  v_minutes_from_open := floor(
    extract(epoch from (v_local_start - (v_local_start::date + v_open))) / 60
  )::integer;

  if p_start <= v_now
    or v_local_start::date + v_open > v_local_start
    or v_local_start + make_interval(mins => v_duration) > v_local_close
    or v_local_start <> date_trunc('minute', v_local_start)
    or mod(v_minutes_from_open, v_company.slot_interval_minutes) <> 0
  then
    raise exception 'The selected time is outside business hours or not a valid slot.';
  end if;

  update public.bookings
  set status = 'cancelled'
  where cég_id = p_company_id
    and status = 'pending'
    and (locked_until is null or locked_until <= v_now);

  if exists (
    select 1
    from public.bookings b
    where b.cég_id = p_company_id
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_start, p_start + make_interval(mins => v_slot_duration), '[)')
  ) or exists (
    select 1
    from public.manual_blockouts m
    where m.cég_id = p_company_id
      and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
          && tstzrange(p_start, p_start + make_interval(mins => v_slot_duration), '[)')
  ) then
    raise exception 'The selected time is no longer available.';
  end if;

  insert into public.bookings (
    cég_id, service_id, kezdes_ideje, vege_ideje, status, locked_until,
    lock_token, jarmu_marka, jarmu_modell, jarmu_rendszam
  )
  values (
    p_company_id, p_service_id, p_start,
    p_start + make_interval(mins => v_duration), 'pending', v_locked_until,
    v_lock_token, trim(p_vehicle_make), trim(p_vehicle_model),
    upper(trim(p_vehicle_registration))
  )
  returning id into v_booking_id;

  return query select v_booking_id, v_lock_token, v_locked_until;
exception
  when exclusion_violation then
    raise exception 'The selected time is no longer available.';
end;
$$;

commit;
