-- Store all selected services and use their combined duration for availability.

begin;

alter table public.bookings
  add constraint bookings_id_company_id_key unique (id, cég_id);

create table public.booking_services (
  booking_id uuid not null,
  cég_id uuid not null,
  service_id uuid not null,
  service_order integer not null check (service_order > 0),
  primary key (booking_id, service_id),
  unique (booking_id, service_order),
  foreign key (booking_id, cég_id)
    references public.bookings (id, cég_id) on delete cascade,
  foreign key (service_id, cég_id)
    references public.services (id, cég_id)
);

insert into public.booking_services (booking_id, cég_id, service_id, service_order)
select b.id, b.cég_id, b.service_id, 1
from public.bookings b
where b.service_id is not null;

alter table public.booking_services enable row level security;
revoke all on public.booking_services from public, anon, authenticated;
grant select on public.booking_services to authenticated;

create policy "Owners and admins can read booking services"
on public.booking_services for select to authenticated
using ((select public.can_manage_company(booking_services.cég_id)));

drop function public.list_available_slots(uuid, uuid, date);
drop function public.create_booking_lock(uuid, uuid, timestamptz, text, text, text);

create function public.list_available_slots(
  p_company_id uuid,
  p_service_ids uuid[],
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
  v_service_count integer;
  v_now timestamptz := statement_timestamp();
begin
  if cardinality(p_service_ids) is null or cardinality(p_service_ids) = 0 then
    raise exception 'At least one service is required.';
  end if;

  select c.time_zone,
         c.slot_interval_minutes,
         coalesce(sum(s.idotartam_percben), 0)::integer,
         count(distinct s.id)::integer
    into v_timezone, v_interval, v_duration, v_service_count
  from public.companies c
  cross join unnest(p_service_ids) requested(service_id)
  join public.services s
    on s.id = requested.service_id
   and s.cég_id = c.id
  where c.id = p_company_id
    and c.status = 'active'
  group by c.time_zone, c.slot_interval_minutes;

  if not found or v_service_count <> cardinality(p_service_ids) then
    raise exception 'Company or selected services are unavailable.';
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

create function public.create_booking_lock(
  p_company_id uuid,
  p_service_ids uuid[],
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
  v_service_count integer;
  v_open time;
  v_close time;
  v_local_start timestamp;
  v_local_close timestamp;
  v_minutes_from_open integer;
  v_now timestamptz;
  v_booking_id uuid;
  v_lock_token uuid := gen_random_uuid();
  v_locked_until timestamptz;
  v_position integer;
begin
  if p_start is null
    or cardinality(p_service_ids) is null
    or cardinality(p_service_ids) = 0
    or nullif(trim(p_vehicle_make), '') is null
    or nullif(trim(p_vehicle_model), '') is null
    or nullif(trim(p_vehicle_registration), '') is null
    or length(trim(p_vehicle_make)) > 100
    or length(trim(p_vehicle_model)) > 100
    or length(trim(p_vehicle_registration)) > 20
  then
    raise exception 'A valid time, at least one service, and all vehicle fields are required.';
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

  select coalesce(sum(s.idotartam_percben), 0)::integer,
         count(distinct s.id)::integer
    into v_duration, v_service_count
  from unnest(p_service_ids) requested(service_id)
  join public.services s
    on s.id = requested.service_id
   and s.cég_id = p_company_id;

  if v_service_count <> cardinality(p_service_ids) then
    raise exception 'A selected service is invalid or does not belong to this company.';
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
    p_company_id, p_service_ids[1], p_start,
    p_start + make_interval(mins => v_duration), 'pending', v_locked_until,
    v_lock_token, trim(p_vehicle_make), trim(p_vehicle_model),
    upper(trim(p_vehicle_registration))
  )
  returning id into v_booking_id;

  for v_position in 1..cardinality(p_service_ids) loop
    insert into public.booking_services (booking_id, cég_id, service_id, service_order)
    values (v_booking_id, p_company_id, p_service_ids[v_position], v_position);
  end loop;

  return query select v_booking_id, v_lock_token, v_locked_until;
exception
  when exclusion_violation then
    raise exception 'The selected time is no longer available.';
end;
$$;

revoke all on function public.list_available_slots(uuid, uuid[], date) from public;
revoke all on function public.create_booking_lock(uuid, uuid[], timestamptz, text, text, text) from public;
grant execute on function public.list_available_slots(uuid, uuid[], date) to anon, authenticated;
grant execute on function public.create_booking_lock(uuid, uuid[], timestamptz, text, text, text) to anon, authenticated;

commit;
