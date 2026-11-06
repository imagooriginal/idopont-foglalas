begin;

create or replace function public.create_booking_lock(
  p_company_id uuid,
  p_service_ids uuid[],
  p_start timestamptz,
  p_vehicle_make text,
  p_vehicle_model text,
  p_vehicle_registration text,
  p_custom_fields jsonb
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
    or p_custom_fields is null
    or jsonb_typeof(p_custom_fields) is distinct from 'object'
  then
    raise exception 'A valid time, at least one service, and booking fields are required.';
  end if;

  select c.* into v_company
  from public.companies c
  where c.id = p_company_id
    and c.status = 'active'
  for update;

  if not found then
    raise exception 'Company is unavailable.';
  end if;

  if (select count(*) from jsonb_object_keys(p_custom_fields)) > 20
    or length(p_vehicle_make) > 100
    or length(p_vehicle_model) > 100
    or length(p_vehicle_registration) > 20
  then
    raise exception 'The supplied booking fields are too long.';
  end if;

  if exists (
    select 1
    from jsonb_each(p_custom_fields) supplied(key, value)
    where not exists (
      select 1
      from jsonb_to_recordset(v_company.custom_booking_fields) field(
        key text,
        label text,
        type text,
        required boolean
      )
      where field.key = supplied.key
    )
      or jsonb_typeof(supplied.value) is distinct from 'string'
      or length(supplied.value #>> '{}') > 500
  ) or exists (
    select 1
    from jsonb_to_recordset(v_company.custom_booking_fields) field(
      key text,
      label text,
      type text,
      required boolean
    )
    where field.required
      and nullif(trim(p_custom_fields ->> field.key), '') is null
  ) then
    raise exception 'The supplied booking fields are invalid.';
  end if;

  v_now := clock_timestamp();
  v_locked_until := v_now + interval '5 minutes';

  select coalesce(sum(s.idotartam_percben), 0)::integer,
         count(distinct s.id)::integer
    into v_duration, v_service_count
  from unnest(p_service_ids) requested(service_id)
  join public.services s
    on s.id = requested.service_id
   and s.cég_id = p_company_id
   and s.is_active;

  if v_service_count <> cardinality(p_service_ids) then
    raise exception 'A selected service is invalid, inactive, or does not belong to this company.';
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

  update public.bookings as b
  set status = 'cancelled'
  where b.cég_id = p_company_id
    and b.status = 'pending'
    and (b.locked_until is null or b.locked_until <= v_now);

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
    lock_token, jarmu_marka, jarmu_modell, jarmu_rendszam, custom_fields
  )
  values (
    p_company_id, p_service_ids[1], p_start,
    p_start + make_interval(mins => v_duration), 'pending', v_locked_until,
    v_lock_token, nullif(trim(p_vehicle_make), ''),
    nullif(trim(p_vehicle_model), ''),
    nullif(upper(trim(p_vehicle_registration)), ''), p_custom_fields
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

revoke all on function public.create_booking_lock(
  uuid, uuid[], timestamptz, text, text, text, jsonb
) from public;
grant execute on function public.create_booking_lock(
  uuid, uuid[], timestamptz, text, text, text, jsonb
) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
