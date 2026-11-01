begin;

alter table public.companies
  add column if not exists can_edit_prices boolean not null default false,
  add column if not exists can_manage_services_advanced boolean not null default false,
  add column if not exists custom_booking_fields jsonb not null default '[]'::jsonb;

update public.companies
set can_edit_prices = true,
    can_manage_services_advanced = true
where can_manage_services is true
  and can_edit_prices is false
  and can_manage_services_advanced is false;

alter table public.companies
  add constraint companies_custom_booking_fields_array_check
  check (jsonb_typeof(custom_booking_fields) = 'array');

alter table public.services
  add column if not exists is_active boolean not null default true,
  add column if not exists leiras text not null default '';

alter table public.bookings
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

alter table public.bookings
  alter column jarmu_marka drop not null,
  alter column jarmu_modell drop not null,
  alter column jarmu_rendszam drop not null;

alter table public.bookings
  add constraint bookings_custom_fields_object_check
  check (jsonb_typeof(custom_fields) = 'object');

grant select (custom_booking_fields) on public.companies to anon, authenticated;
grant select (slot_interval_minutes, primary_color)
  on public.companies to anon;
grant select (can_edit_prices, can_manage_services_advanced)
  on public.companies to authenticated;

drop policy if exists "Public can read active company working hours"
  on public.company_business_hours;
create policy "Public can read active company working hours"
on public.company_business_hours for select to anon, authenticated
using ((select public.can_access_company(company_business_hours.company_id)));
grant select on public.company_business_hours to anon;

drop policy if exists "Public can read active company services" on public.services;
create policy "Public can read active company services"
on public.services for select
using (
  is_active
  and (select public.can_access_company(services.cég_id))
);
drop policy if exists "Owners and admins can read all company services"
  on public.services;
create policy "Owners and admins can read all company services"
on public.services for select to authenticated
using ((select public.can_manage_company(services.cég_id)));

drop policy if exists "Owners can create services" on public.services;
drop policy if exists "Owners can update services" on public.services;
drop policy if exists "Owners can delete services" on public.services;
drop policy if exists "Authorized owners can create services" on public.services;
drop policy if exists "Authorized owners can update services" on public.services;
drop policy if exists "Authorized owners can delete services" on public.services;
drop policy if exists "Owners with advanced access can create services"
  on public.services;
drop policy if exists "Owners with advanced access can update services"
  on public.services;
drop policy if exists "Owners with price access can update service details"
  on public.services;

create or replace function public.can_edit_service_prices(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and (
        (select public.is_platform_admin())
        or (
          c.owner_id = (select auth.uid())
          and c.can_edit_prices
        )
      )
  );
$$;

create or replace function public.can_manage_services_advanced(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and (
        (select public.is_platform_admin())
        or (
          c.owner_id = (select auth.uid())
          and c.can_manage_services_advanced
        )
      )
  );
$$;

revoke all on function public.can_edit_service_prices(uuid) from public;
revoke all on function public.can_manage_services_advanced(uuid) from public;
grant execute on function public.can_edit_service_prices(uuid) to authenticated;
grant execute on function public.can_manage_services_advanced(uuid) to authenticated;

create or replace function public.update_platform_company_booking_settings(
  p_company_id uuid,
  p_can_edit_prices boolean,
  p_can_manage_services_advanced boolean,
  p_custom_booking_fields jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.is_platform_admin()) then
    raise exception 'Platform administrator access is required.';
  end if;

  if p_can_edit_prices is null or p_can_manage_services_advanced is null
    or jsonb_typeof(p_custom_booking_fields) is distinct from 'array'
  then
    raise exception 'Company booking settings are invalid.';
  end if;
  if jsonb_array_length(p_custom_booking_fields) > 20 then
    raise exception 'At most 20 custom booking fields are allowed.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_custom_booking_fields) field(
      key text,
      label text,
      type text,
      required boolean
    )
    where field.key is null
      or field.key !~ '^[a-z0-9_]{1,40}$'
      or field.label is null
      or length(field.label) not between 1 and 80
      or field.type is distinct from 'text'
      or field.required is null
  ) or (
    select count(distinct field.key)
    from jsonb_to_recordset(p_custom_booking_fields) field(
      key text,
      label text,
      type text,
      required boolean
    )
  ) <> jsonb_array_length(p_custom_booking_fields) then
    raise exception 'Company booking fields are invalid.';
  end if;

  update public.companies
  set can_manage_services = p_can_manage_services_advanced,
      can_edit_prices = p_can_edit_prices,
      can_manage_services_advanced = p_can_manage_services_advanced,
      custom_booking_fields = p_custom_booking_fields
  where id = p_company_id;

  if not found then
    raise exception 'Company does not exist.';
  end if;
end;
$$;

revoke all on function public.update_platform_company_booking_settings(
  uuid, boolean, boolean, jsonb
) from public;
grant execute on function public.update_platform_company_booking_settings(
  uuid, boolean, boolean, jsonb
) to authenticated;

create or replace function public.update_platform_company_all_settings(
  p_company_id uuid,
  p_name text,
  p_slug text,
  p_primary_color text,
  p_plan text,
  p_time_zone text,
  p_slot_interval_minutes integer,
  p_can_edit_prices boolean,
  p_can_manage_services_advanced boolean,
  p_schedule jsonb,
  p_custom_booking_fields jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.is_platform_admin()) then
    raise exception 'Platform administrator access is required.';
  end if;

  perform public.update_platform_company_settings(
    p_company_id,
    p_name,
    p_slug,
    p_primary_color,
    p_plan,
    p_time_zone,
    p_slot_interval_minutes,
    p_can_manage_services_advanced,
    p_schedule
  );
  perform public.update_platform_company_booking_settings(
    p_company_id,
    p_can_edit_prices,
    p_can_manage_services_advanced,
    p_custom_booking_fields
  );
end;
$$;

revoke all on function public.update_platform_company_all_settings(
  uuid, text, text, text, text, text, integer, boolean, boolean, jsonb, jsonb
) from public;
grant execute on function public.update_platform_company_all_settings(
  uuid, text, text, text, text, text, integer, boolean, boolean, jsonb, jsonb
) to authenticated;

create policy "Owners with advanced access can create services"
on public.services for insert to authenticated
with check ((select public.can_manage_services_advanced(services.cég_id)));

create policy "Owners with advanced access can update services"
on public.services for update to authenticated
using ((select public.can_manage_services_advanced(services.cég_id)))
with check ((select public.can_manage_services_advanced(services.cég_id)));

create policy "Owners with price access can update service details"
on public.services for update to authenticated
using ((select public.can_edit_service_prices(services.cég_id)))
with check ((select public.can_edit_service_prices(services.cég_id)));

create or replace function public.guard_tenant_service_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cég_id is distinct from old.cég_id then
    raise exception 'A service cannot be moved to another company.';
  end if;

  if (select auth.role()) is distinct from 'service_role'
    and not (select public.is_platform_admin())
    and not (select public.can_manage_services_advanced(old.cég_id))
    and (
        new.nev is distinct from old.nev
        or new.idotartam_percben is distinct from old.idotartam_percben
        or new.display_order is distinct from old.display_order
        or new.is_active is distinct from old.is_active
      )
  then
    raise exception 'Advanced service-management access is required.';
  end if;
  if (select auth.role()) is distinct from 'service_role'
    and not (select public.is_platform_admin())
    and not (select public.can_edit_service_prices(old.cég_id))
    and (
      new.ar is distinct from old.ar
      or new.leiras is distinct from old.leiras
    )
  then
    raise exception 'Price and description editing access is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists services_guard_tenant_update on public.services;
create trigger services_guard_tenant_update
before update on public.services
for each row execute function public.guard_tenant_service_update();

revoke delete on public.services from authenticated;
grant insert on public.services to authenticated;
grant update on public.services to authenticated;

create or replace function public.initialize_company_business_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_business_hours (
    company_id, weekday, opens_at, closes_at
  )
  select new.id, days.weekday, new.nyitvatartas_kezdet, new.nyitvatartas_vege
  from generate_series(1, 5) as days(weekday)
  on conflict (company_id, weekday) do nothing;
  return new;
end;
$$;

drop trigger if exists companies_initialize_business_hours on public.companies;
create trigger companies_initialize_business_hours
after insert on public.companies
for each row execute function public.initialize_company_business_hours();

insert into public.company_business_hours (
  company_id, weekday, opens_at, closes_at
)
select c.id, days.weekday, c.nyitvatartas_kezdet, c.nyitvatartas_vege
from public.companies c
cross join generate_series(1, 5) as days(weekday)
where not exists (
  select 1
  from public.company_business_hours h
  where h.company_id = c.id
    and h.weekday = days.weekday
)
on conflict (company_id, weekday) do nothing;

drop function if exists public.create_booking_lock(
  uuid, uuid[], timestamptz, text, text, text
);

create function public.create_booking_lock(
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

create or replace function public.list_week_slot_grid(
  p_company_id uuid,
  p_service_ids uuid[],
  p_week_start date
)
returns table (slot_start timestamptz, is_available boolean)
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

  if extract(isodow from p_week_start) <> 1 then
    raise exception 'The requested week must start on Monday.';
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
   and s.is_active
  where c.id = p_company_id
    and c.status = 'active'
  group by c.time_zone, c.slot_interval_minutes;

  if not found or v_service_count <> cardinality(p_service_ids) then
    raise exception 'Company or selected active services are unavailable.';
  end if;

  v_slot_duration :=
    ceil(v_duration::numeric / v_interval)::integer * v_interval;

  return query
  with local_slots as (
    select generated.local_start,
           generated.local_start at time zone v_timezone as slot_start
    from generate_series(0, 6) as week_day(day_offset)
    join public.company_business_hours h
      on h.company_id = p_company_id
     and h.weekday = extract(dow from (p_week_start + week_day.day_offset))::smallint
    cross join lateral generate_series(
      (p_week_start + week_day.day_offset) + h.opens_at,
      (p_week_start + week_day.day_offset) + h.closes_at
        - make_interval(mins => v_duration),
      make_interval(mins => v_interval)
    ) as generated(local_start)
  )
  select local_slots.slot_start,
         local_slots.slot_start > v_now
         and not exists (
           select 1
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
         )
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
grant execute on function public.list_week_slot_grid(uuid, uuid[], date)
  to anon, authenticated;

commit;
