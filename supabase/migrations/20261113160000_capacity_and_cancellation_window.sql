-- =============================================================================
-- Migration: Parallel Capacity (max_concurrent_bookings) &
-- Configurable Cancellation/Reschedule Window (cancellation_window_hours)
-- =============================================================================

begin;

-- 1. Extend public.companies with capacity and cancellation window columns
alter table public.companies
  add column if not exists max_concurrent_bookings integer not null default 1,
  add column if not exists cancellation_window_hours integer not null default 24;

alter table public.companies
  drop constraint if exists companies_max_concurrent_bookings_check;

alter table public.companies
  add constraint companies_max_concurrent_bookings_check
  check (max_concurrent_bookings between 1 and 50);

alter table public.companies
  drop constraint if exists companies_cancellation_window_hours_check;

alter table public.companies
  add constraint companies_cancellation_window_hours_check
  check (cancellation_window_hours between 0 and 168);

grant select (max_concurrent_bookings, cancellation_window_hours)
  on public.companies to anon, authenticated;

grant update (max_concurrent_bookings, cancellation_window_hours)
  on public.companies to authenticated;

-- 2. Drop single-booking exclusion constraint so parallel capacity > 1 is supported;
-- serialization continues to be enforced by row-locking the company in booking RPCs.
alter table public.bookings
  drop constraint if exists bookings_no_overlapping_active_periods;

-- 3. Update list_available_slots to respect max_concurrent_bookings
create or replace function public.list_available_slots(
  p_company_id uuid,
  p_service_ids uuid[],
  p_day date
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_duration integer;
  v_interval integer;
  v_slot_duration integer;
  v_service_count integer;
  v_capacity integer;
  v_now timestamptz := statement_timestamp();
begin
  if cardinality(p_service_ids) is null or cardinality(p_service_ids) = 0 then
    raise exception 'At least one service is required.';
  end if;

  select c.time_zone,
         c.slot_interval_minutes,
         greatest(1, coalesce(c.max_concurrent_bookings, 1)),
         coalesce(sum(s.idotartam_percben), 0)::integer,
         count(distinct s.id)::integer
    into v_timezone, v_interval, v_capacity, v_duration, v_service_count
  from public.companies c
  cross join unnest(p_service_ids) requested(service_id)
  join public.services s
    on s.id = requested.service_id
   and s.cég_id = c.id
   and s.is_active
  where c.id = p_company_id
    and c.status = 'active'
  group by c.time_zone, c.slot_interval_minutes, c.max_concurrent_bookings;

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
    and (
      select count(*)
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
    ) < v_capacity
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

revoke all on function public.list_available_slots(uuid, uuid[], date) from public;
grant execute on function public.list_available_slots(uuid, uuid[], date) to anon, authenticated;

-- 4. Update list_week_slot_grid to respect max_concurrent_bookings
create or replace function public.list_week_slot_grid(
  p_company_id uuid,
  p_service_ids uuid[],
  p_week_start date
)
returns table (slot_start timestamptz, is_available boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_duration integer;
  v_interval integer;
  v_slot_duration integer;
  v_service_count integer;
  v_capacity integer;
  v_now timestamptz := statement_timestamp();
begin
  if cardinality(p_service_ids) is null or cardinality(p_service_ids) = 0 then
    raise exception 'At least one service is required.';
  end if;

  if extract(isodow from p_week_start) <> 1 then
    raise exception 'The requested week must start on Monday.';
  end if;

  select c.time_zone,
         c.slot_interval_minutes,
         greatest(1, coalesce(c.max_concurrent_bookings, 1)),
         coalesce(sum(s.idotartam_percben), 0)::integer,
         count(distinct s.id)::integer
    into v_timezone, v_interval, v_capacity, v_duration, v_service_count
  from public.companies c
  cross join unnest(p_service_ids) requested(service_id)
  join public.services s
    on s.id = requested.service_id
   and s.cég_id = c.id
   and s.is_active
  where c.id = p_company_id
    and c.status = 'active'
  group by c.time_zone, c.slot_interval_minutes, c.max_concurrent_bookings;

  if not found or v_service_count <> cardinality(p_service_ids) then
    raise exception 'Company or selected active services are unavailable.';
  end if;

  v_slot_duration :=
    ceil(v_duration::numeric / v_interval)::integer * v_interval;

  return query
  with effective_hours as (
    select h.weekday, h.opens_at, h.closes_at
    from public.company_business_hours h
    where h.company_id = p_company_id

    union all

    select fallback.weekday::smallint, time '08:00', time '16:00'
    from generate_series(1, 5) as fallback(weekday)
    where not exists (
      select 1
      from public.company_business_hours configured
      where configured.company_id = p_company_id
    )
  ),
  local_slots as (
    select generated.local_start,
           generated.local_start at time zone v_timezone as slot_start
    from generate_series(0, 6) as week_day(day_offset)
    join effective_hours h
      on h.weekday = extract(dow from (p_week_start + week_day.day_offset))::smallint
    cross join lateral generate_series(
      (p_week_start + week_day.day_offset) + h.opens_at,
      (p_week_start + week_day.day_offset) + h.closes_at
        - make_interval(mins => v_duration),
      make_interval(mins => v_interval)
    ) as generated(local_start)
  )
  select local_slots.slot_start,
         local_slots.slot_start > v_now
         and (
           select count(*)
           from public.bookings b
           where b.cég_id = p_company_id
             and b.status in ('pending', 'confirmed')
             and (b.status = 'confirmed' or b.locked_until > v_now)
             and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
                 && tstzrange(
                   local_slots.slot_start,
                   local_slots.slot_start
                     + make_interval(mins => v_slot_duration),
                   '[)'
                 )
         ) < v_capacity
         and not exists (
           select 1
           from public.manual_blockouts m
           where m.cég_id = p_company_id
             and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
                 && tstzrange(
                   local_slots.slot_start,
                   local_slots.slot_start
                     + make_interval(mins => v_slot_duration),
                   '[)'
                 )
         )
  from local_slots
  order by local_slots.slot_start;
end;
$$;

revoke all on function public.list_week_slot_grid(uuid, uuid[], date) from public;
grant execute on function public.list_week_slot_grid(uuid, uuid[], date) to anon, authenticated;

-- 5. Update create_booking_lock to allow up to max_concurrent_bookings concurrent bookings
create or replace function public.create_booking_lock(
  p_company_id uuid,
  p_service_ids uuid[],
  p_start timestamptz,
  p_vehicle_make text,
  p_vehicle_model text,
  p_vehicle_registration text,
  p_custom_fields jsonb,
  p_client_fingerprint text default null
)
returns table (booking_id uuid, lock_token uuid, locked_until timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
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
  v_active_client_locks integer;
  v_cleaned_custom_fields jsonb := '{}'::jsonb;
  v_fingerprint text := nullif(trim(p_client_fingerprint), '');
  v_effective_custom_defs jsonb;
begin
  if p_start is null
    or cardinality(p_service_ids) is null
    or cardinality(p_service_ids) = 0
    or p_custom_fields is null
    or jsonb_typeof(p_custom_fields) is distinct from 'object'
  then
    raise exception 'A valid time, at least one service, and booking fields are required.';
  end if;

  if v_fingerprint is null then
    v_fingerprint := md5(
      coalesce(
        nullif(
          trim(
            split_part(
              coalesce(
                (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-forwarded-for'),
                ''
              ),
              ',',
              1
            )
          ),
          ''
        ),
        nullif(
          trim(
            coalesce(
              (coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-real-ip'),
              ''
            )
          ),
          ''
        ),
        coalesce((select auth.uid())::text, 'anon-direct-rpc')
      )
    );
  end if;

  perform public.enforce_rate_limit('booking_lock', v_fingerprint, 5, 600);

  select c.* into v_company
  from public.companies c
  where c.id = p_company_id
    and c.status = 'active'
  for update;

  if not found then
    raise exception 'Company is unavailable.';
  end if;

  v_effective_custom_defs := case
    when v_company.plan = 'pro' then coalesce(v_company.custom_booking_fields, '[]'::jsonb)
    else '[]'::jsonb
  end;

  if v_company.plan = 'pro' then
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
        from jsonb_to_recordset(v_effective_custom_defs) field(
          key text,
          label text,
          type text,
          required boolean
        )
        where field.key = supplied.key
      )
        or jsonb_typeof(supplied.value) is distinct from 'string'
        or length(trim(supplied.value #>> '{}')) > 200
    ) or exists (
      select 1
      from jsonb_to_recordset(v_effective_custom_defs) field(
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

    select coalesce(
      jsonb_object_agg(
        supplied.key,
        to_jsonb(regexp_replace(trim(supplied.value #>> '{}'), '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'))
      ),
      '{}'::jsonb
    )
      into v_cleaned_custom_fields
    from jsonb_each(p_custom_fields) supplied(key, value)
    where length(trim(supplied.value #>> '{}')) > 0;
  else
    v_cleaned_custom_fields := '{}'::jsonb;
  end if;

  v_now := clock_timestamp();
  v_locked_until := v_now + interval '5 minutes';

  update public.bookings as b
  set status = 'cancelled'
  where b.status = 'pending'
    and (b.locked_until is null or b.locked_until <= v_now);

  select count(*)::integer
    into v_active_client_locks
  from public.bookings b
  where b.status = 'pending'
    and b.locked_until > v_now
    and b.lock_client_fingerprint = v_fingerprint;

  if v_active_client_locks >= 3 then
    raise exception 'Too many active booking locks.';
  end if;

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

  if (
    select count(*)
    from public.bookings b
    where b.cég_id = p_company_id
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_start, p_start + make_interval(mins => v_slot_duration), '[)')
  ) >= greatest(1, coalesce(v_company.max_concurrent_bookings, 1)) or exists (
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
    lock_token, jarmu_marka, jarmu_modell, jarmu_rendszam, custom_fields,
    lock_client_fingerprint, cancellation_token
  )
  values (
    p_company_id, p_service_ids[1], p_start,
    p_start + make_interval(mins => v_duration), 'pending', v_locked_until,
    v_lock_token, nullif(trim(p_vehicle_make), ''),
    nullif(trim(p_vehicle_model), ''),
    nullif(upper(trim(p_vehicle_registration)), ''), v_cleaned_custom_fields,
    v_fingerprint, gen_random_uuid()
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

revoke all on function public.create_booking_lock(uuid, uuid[], timestamptz, text, text, text, jsonb, text) from public;
grant execute on function public.create_booking_lock(uuid, uuid[], timestamptz, text, text, text, jsonb, text) to anon, authenticated;

-- 6. Update create_manual_booking to allow up to max_concurrent_bookings concurrent bookings
create or replace function public.create_manual_booking(
  p_company_id uuid,
  p_service_ids uuid[],
  p_start timestamptz,
  p_customer_name text,
  p_customer_phone text default null,
  p_customer_email text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_duration integer;
  v_slot_duration integer;
  v_service_count integer;
  v_booking_id uuid;
  v_position integer;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if p_start is null
    or cardinality(p_service_ids) is null
    or cardinality(p_service_ids) = 0
    or nullif(trim(p_customer_name), '') is null
    or length(trim(p_customer_name)) > 200
  then
    raise exception 'Customer name, valid start time, and at least one service are required.';
  end if;

  select c.* into v_company
  from public.companies c
  where c.id = p_company_id
    and (
      c.owner_id = (select auth.uid())
      or (select public.is_platform_admin())
    )
  for update;

  if not found then
    raise exception 'You are not allowed to manage this company.';
  end if;

  select coalesce(sum(s.idotartam_percben), 0)::integer,
         count(distinct s.id)::integer
    into v_duration, v_service_count
  from unnest(p_service_ids) requested(service_id)
  join public.services s
    on s.id = requested.service_id
   and s.cég_id = p_company_id
   and s.is_active;

  if v_service_count <> cardinality(p_service_ids) then
    raise exception 'One or more selected services are invalid or inactive.';
  end if;

  v_slot_duration :=
    ceil(v_duration::numeric / v_company.slot_interval_minutes)::integer
      * v_company.slot_interval_minutes;

  if (
    select count(*)
    from public.bookings b
    where b.cég_id = p_company_id
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_start, p_start + make_interval(mins => v_slot_duration), '[)')
  ) >= greatest(1, coalesce(v_company.max_concurrent_bookings, 1)) or exists (
    select 1
    from public.manual_blockouts m
    where m.cég_id = p_company_id
      and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
          && tstzrange(p_start, p_start + make_interval(mins => v_slot_duration), '[)')
  ) then
    raise exception 'The selected time slot conflicts with an existing booking or blockout.';
  end if;

  insert into public.bookings (
    cég_id,
    service_id,
    kezdes_ideje,
    vege_ideje,
    status,
    ugyfel_nev,
    ugyfel_telefon,
    ugyfel_email,
    custom_fields,
    cancellation_token,
    confirmation_email_sent
  )
  values (
    p_company_id,
    p_service_ids[1],
    p_start,
    p_start + make_interval(mins => v_duration),
    'confirmed',
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(lower(trim(coalesce(p_customer_email, ''))), ''),
    '{}'::jsonb,
    gen_random_uuid(),
    case when nullif(trim(coalesce(p_customer_email, '')), '') is null then true else false end
  )
  returning id into v_booking_id;

  for v_position in 1..cardinality(p_service_ids) loop
    insert into public.booking_services (booking_id, cég_id, service_id, service_order)
    values (v_booking_id, p_company_id, p_service_ids[v_position], v_position);
  end loop;

  return v_booking_id;
end;
$$;

revoke all on function public.create_manual_booking(uuid, uuid[], timestamptz, text, text, text) from public, anon;
grant execute on function public.create_manual_booking(uuid, uuid[], timestamptz, text, text, text) to authenticated;

-- 7. Update reschedule_booking_by_provider to respect max_concurrent_bookings and per-staff conflicts
create or replace function public.reschedule_booking_by_provider(
  p_booking_id uuid,
  p_new_start timestamptz,
  p_staff_id uuid default null
)
returns table (
  booking_id uuid,
  company_id uuid,
  company_name text,
  customer_name text,
  customer_email text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_company public.companies%rowtype;
  v_duration_minutes integer;
  v_slot_duration integer;
  v_new_end timestamptz;
  v_target_staff uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if p_booking_id is null or p_new_start is null then
    raise exception 'Booking ID and new start time are required.';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  select c.* into v_company
  from public.companies c
  where c.id = v_booking.cég_id
    and (
      c.owner_id = (select auth.uid())
      or (select public.is_platform_admin())
    )
  for update;

  if not found then
    raise exception 'You are not allowed to manage this company.';
  end if;

  v_duration_minutes := greatest(
    5,
    round(extract(epoch from (v_booking.vege_ideje - v_booking.kezdes_ideje)) / 60.0)::integer
  );
  v_slot_duration :=
    ceil(v_duration_minutes::numeric / v_company.slot_interval_minutes)::integer
      * v_company.slot_interval_minutes;
  v_new_end := p_new_start + make_interval(mins => v_duration_minutes);
  v_target_staff := coalesce(p_staff_id, v_booking.staff_id);

  if (
    v_target_staff is not null
    and exists (
      select 1
      from public.bookings b
      where b.cég_id = v_company.id
        and b.id <> v_booking.id
        and b.staff_id = v_target_staff
        and b.status in ('pending', 'confirmed')
        and (b.status = 'confirmed' or b.locked_until > v_now)
        and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
            && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
    )
  ) or (
    select count(*)
    from public.bookings b
    where b.cég_id = v_company.id
      and b.id <> v_booking.id
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
  ) >= greatest(1, coalesce(v_company.max_concurrent_bookings, 1)) or exists (
    select 1
    from public.manual_blockouts m
    where m.cég_id = v_company.id
      and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
          && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
  ) then
    raise exception 'The selected time slot conflicts with an existing booking or blockout.';
  end if;

  update public.bookings
  set kezdes_ideje = p_new_start,
      vege_ideje = v_new_end,
      staff_id = v_target_staff,
      status = 'confirmed',
      rescheduled_at = v_now
  where id = v_booking.id;

  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (
    v_company.id,
    auth.uid(),
    'booking.rescheduled_by_provider',
    'booking',
    v_booking.id::text,
    jsonb_build_object(
      'previous_start', v_booking.kezdes_ideje,
      'new_start', p_new_start,
      'customer_name', coalesce(v_booking.ugyfel_nev, '')
    )
  );

  return query
  select
    v_booking.id,
    v_company.id,
    v_company.nev,
    coalesce(v_booking.ugyfel_nev, ''),
    coalesce(v_booking.ugyfel_email, ''),
    p_new_start,
    v_new_end;
end;
$$;

revoke all on function public.reschedule_booking_by_provider(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.reschedule_booking_by_provider(uuid, timestamptz, uuid) to authenticated;

-- 8. Update cancel_booking_by_token to enforce configurable cancellation_window_hours
create or replace function public.cancel_booking_by_token(
  p_cancellation_token uuid
)
returns table (
  booking_id uuid,
  company_id uuid,
  company_name text,
  customer_name text,
  customer_email text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_company public.companies%rowtype;
  v_cutoff_hours integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_cancellation_token is null then
    raise exception 'Invalid cancellation token.';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.cancellation_token = p_cancellation_token
    and b.status = 'confirmed'
  for update;

  if not found then
    raise exception 'Booking not found or already cancelled.';
  end if;

  select c.* into v_company
  from public.companies c
  where c.id = v_booking.cég_id;

  if not found or v_company.plan <> 'pro' then
    raise exception 'Online cancellation is only available for Pro tier providers.';
  end if;

  v_cutoff_hours := greatest(0, least(168, coalesce(v_company.cancellation_window_hours, 24)));

  if v_booking.kezdes_ideje <= v_now + make_interval(hours => v_cutoff_hours) then
    raise exception 'Cancellation is only allowed more than % hours before the appointment.', v_cutoff_hours;
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = v_now,
      cancellation_token = null
  where id = v_booking.id;

  return query
  select
    v_booking.id,
    v_company.id,
    v_company.nev,
    coalesce(v_booking.ugyfel_nev, ''),
    coalesce(v_booking.ugyfel_email, ''),
    v_booking.kezdes_ideje,
    v_booking.vege_ideje;
end;
$$;

revoke all on function public.cancel_booking_by_token(uuid) from public;
grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;

-- 9. Update reschedule_booking_by_token to enforce configurable cancellation_window_hours & max_concurrent_bookings
create or replace function public.reschedule_booking_by_token(
  p_cancellation_token uuid,
  p_new_start timestamptz
)
returns table (
  booking_id uuid,
  company_id uuid,
  company_name text,
  customer_name text,
  customer_email text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
  v_company public.companies%rowtype;
  v_cutoff_hours integer;
  v_duration_minutes integer;
  v_slot_duration integer;
  v_new_end timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_cancellation_token is null or p_new_start is null then
    raise exception 'Invalid reschedule request.';
  end if;

  if p_new_start <= v_now + interval '1 hour' then
    raise exception 'The new appointment time must be in the future.';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.cancellation_token = p_cancellation_token
    and b.status = 'confirmed'
  for update;

  if not found then
    raise exception 'Booking not found or already cancelled.';
  end if;

  select c.* into v_company
  from public.companies c
  where c.id = v_booking.cég_id
  for update;

  if not found or v_company.plan <> 'pro' then
    raise exception 'Online rescheduling is only available for Pro tier providers.';
  end if;

  v_cutoff_hours := greatest(0, least(168, coalesce(v_company.cancellation_window_hours, 24)));

  if v_booking.kezdes_ideje <= v_now + make_interval(hours => v_cutoff_hours) then
    raise exception 'Rescheduling is only allowed more than % hours before the appointment.', v_cutoff_hours;
  end if;

  v_duration_minutes := greatest(
    5,
    round(extract(epoch from (v_booking.vege_ideje - v_booking.kezdes_ideje)) / 60.0)::integer
  );
  v_slot_duration :=
    ceil(v_duration_minutes::numeric / v_company.slot_interval_minutes)::integer
      * v_company.slot_interval_minutes;
  v_new_end := p_new_start + make_interval(mins => v_duration_minutes);

  if (
    v_booking.staff_id is not null
    and exists (
      select 1
      from public.bookings b
      where b.cég_id = v_company.id
        and b.id <> v_booking.id
        and b.staff_id = v_booking.staff_id
        and b.status in ('pending', 'confirmed')
        and (b.status = 'confirmed' or b.locked_until > v_now)
        and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
            && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
    )
  ) or (
    select count(*)
    from public.bookings b
    where b.cég_id = v_company.id
      and b.id <> v_booking.id
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
  ) >= greatest(1, coalesce(v_company.max_concurrent_bookings, 1)) or exists (
    select 1
    from public.manual_blockouts m
    where m.cég_id = v_company.id
      and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
          && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
  ) then
    raise exception 'The selected new time slot is no longer available.';
  end if;

  update public.bookings
  set kezdes_ideje = p_new_start,
      vege_ideje = v_new_end,
      rescheduled_at = v_now
  where id = v_booking.id;

  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (
    v_company.id,
    null,
    'booking.rescheduled_by_customer',
    'booking',
    v_booking.id::text,
    jsonb_build_object(
      'previous_start', v_booking.kezdes_ideje,
      'new_start', p_new_start,
      'customer_name', coalesce(v_booking.ugyfel_nev, '')
    )
  );

  return query
  select
    v_booking.id,
    v_company.id,
    v_company.nev,
    coalesce(v_booking.ugyfel_nev, ''),
    coalesce(v_booking.ugyfel_email, ''),
    p_new_start,
    v_new_end;
end;
$$;

revoke all on function public.reschedule_booking_by_token(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking_by_token(uuid, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
