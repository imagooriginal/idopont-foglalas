-- Consolidated Security Hardening Migration
-- Covers:
-- 1. Slot-Lock Exhaustion & Rate Limiting (max 3 active locks per client fingerprint, max 5 lock attempts / 10 min)
-- 2. Strict server-side & DB validation for custom_booking_fields (max 20 fields, max 200 chars trimmed per value)
-- 3. PII & RLS / Column Grant hardening (no anon/guest access to bookings or internal company columns)
-- 4. Multi-tenant isolation & strict permission checks
-- 5. SECURITY DEFINER search_path = public, pg_temp & REVOKE EXECUTE from public/anon on privileged RPCs
-- 7. Atomic single-statement booking confirmation with server-side now() lock expiration check

begin;

-- 1. Rate limiting & client lock tracking
alter table public.bookings
  add column if not exists lock_client_fingerprint text;

create index if not exists bookings_active_lock_fingerprint_idx
  on public.bookings (lock_client_fingerprint, status, locked_until)
  where status = 'pending';

create table if not exists public.security_rate_limits (
  id bigserial primary key,
  scope text not null,
  identifier_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists security_rate_limits_lookup_idx
  on public.security_rate_limits (scope, identifier_hash, created_at);

alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;

create or replace function public.enforce_rate_limit(
  p_scope text,
  p_identifier_hash text,
  p_max_attempts integer default 5,
  p_window_seconds integer default 600
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cutoff timestamptz;
  v_attempts integer;
begin
  if nullif(trim(p_scope), '') is null
    or nullif(trim(p_identifier_hash), '') is null
    or p_max_attempts is null
    or p_max_attempts < 1
    or p_window_seconds is null
    or p_window_seconds < 1
  then
    raise exception 'Invalid rate limit parameters.';
  end if;

  v_cutoff := v_now - make_interval(secs => p_window_seconds);

  delete from public.security_rate_limits
  where created_at < v_now - interval '1 day';

  select count(*)::integer
    into v_attempts
  from public.security_rate_limits
  where scope = p_scope
    and identifier_hash = p_identifier_hash
    and created_at >= v_cutoff;

  if v_attempts >= p_max_attempts then
    raise exception 'Rate limit exceeded.';
  end if;

  insert into public.security_rate_limits (scope, identifier_hash, created_at)
  values (p_scope, p_identifier_hash, v_now);
end;
$$;

revoke all on function public.enforce_rate_limit(text, text, integer, integer) from public;
grant execute on function public.enforce_rate_limit(text, text, integer, integer) to anon, authenticated;

-- 2. Harden helper functions with SET search_path = public, pg_temp
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to anon, authenticated;

create or replace function public.can_access_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and (
        c.status = 'active'
        or c.owner_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  );
$$;

create or replace function public.can_manage_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and (
        c.owner_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  );
$$;

create or replace function public.can_manage_services(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and (
        (select public.is_platform_admin())
        or (
          c.owner_id = (select auth.uid())
          and c.can_manage_services
        )
      )
  );
$$;

create or replace function public.can_edit_service_prices(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
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
set search_path = public, pg_temp
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

revoke all on function public.can_access_company(uuid) from public;
revoke all on function public.can_manage_company(uuid) from public, anon;
revoke all on function public.can_manage_services(uuid) from public, anon;
revoke all on function public.can_edit_service_prices(uuid) from public, anon;
revoke all on function public.can_manage_services_advanced(uuid) from public, anon;

grant execute on function public.can_access_company(uuid) to anon, authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;
grant execute on function public.can_manage_services(uuid) to authenticated;
grant execute on function public.can_edit_service_prices(uuid) to authenticated;
grant execute on function public.can_manage_services_advanced(uuid) to authenticated;

-- 3. Trigger functions with SET search_path = public, pg_temp
create or replace function public.initialize_company_business_hours()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

create or replace function public.guard_tenant_service_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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

-- 4. PII & RLS / Column Grant Hardening on bookings, manual_blockouts, booking_services, companies
revoke all on public.bookings, public.booking_services, public.manual_blockouts
  from public, anon;

-- Ensure authenticated users cannot insert/update/delete companies directly (managed via superadmin / RPCs)
drop policy if exists "Owners can create pending companies" on public.companies;
drop policy if exists "Owners can update their companies" on public.companies;
drop policy if exists "Public can read active companies" on public.companies;
drop policy if exists "Anon can read active companies" on public.companies;
drop policy if exists "Owners and admins can read their companies" on public.companies;
revoke insert, update, delete on public.companies from anon, authenticated;
revoke select on public.companies from public, anon, authenticated;

-- Anon role can only SELECT public non-sensitive columns on active companies
grant select (
  id,
  nev,
  slug,
  nyitvatartas_kezdet,
  nyitvatartas_vege,
  time_zone,
  slot_interval_minutes,
  primary_color,
  custom_booking_fields
) on public.companies to anon;

-- Authenticated role can SELECT company columns, but RLS strictly restricts rows to owner_id = auth.uid() or platform admins
grant select (
  id,
  owner_id,
  nev,
  slug,
  nyitvatartas_kezdet,
  nyitvatartas_vege,
  status,
  time_zone,
  slot_interval_minutes,
  primary_color,
  plan,
  subscription_started_at,
  can_manage_services,
  can_edit_prices,
  can_manage_services_advanced,
  custom_booking_fields
) on public.companies to authenticated;

create policy "Anon can read active companies"
  on public.companies
  for select
  to anon
  using (status = 'active');

create policy "Owners and admins can read their companies"
  on public.companies
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (select public.is_platform_admin())
  );

-- Public safe company lookup RPC (never exposes owner_id, plan, or internal permission flags)
create or replace function public.get_public_company_by_slug(p_slug text)
returns table (
  id uuid,
  nev text,
  slug text,
  time_zone text,
  slot_interval_minutes integer,
  primary_color text,
  custom_booking_fields jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.nev,
    c.slug,
    c.time_zone,
    c.slot_interval_minutes,
    c.primary_color,
    c.custom_booking_fields
  from public.companies c
  where lower(c.slug) = lower(trim(p_slug))
    and c.status = 'active'
  limit 1;
$$;

revoke all on function public.get_public_company_by_slug(text) from public;
grant execute on function public.get_public_company_by_slug(text) to anon, authenticated;

-- 5. Slot calculation RPCs with SET search_path = public, pg_temp
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
   and s.is_active
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

revoke all on function public.list_available_slots(uuid, uuid[], date) from public;
grant execute on function public.list_available_slots(uuid, uuid[], date) to anon, authenticated;

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
grant execute on function public.list_week_slot_grid(uuid, uuid[], date) to anon, authenticated;

-- 6. Hardened create_booking_lock with active-lock limit, rate limiting, and trimmed <=200-char custom fields
drop function if exists public.create_booking_lock(
  uuid, uuid[], timestamptz, text, text, text, jsonb
);
drop function if exists public.create_booking_lock(
  uuid, uuid[], timestamptz, text, text, text, jsonb, text
);

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
      or length(trim(supplied.value #>> '{}')) > 200
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
    lock_token, jarmu_marka, jarmu_modell, jarmu_rendszam, custom_fields,
    lock_client_fingerprint
  )
  values (
    p_company_id, p_service_ids[1], p_start,
    p_start + make_interval(mins => v_duration), 'pending', v_locked_until,
    v_lock_token, nullif(trim(p_vehicle_make), ''),
    nullif(trim(p_vehicle_model), ''),
    nullif(upper(trim(p_vehicle_registration)), ''), v_cleaned_custom_fields,
    v_fingerprint
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
  uuid, uuid[], timestamptz, text, text, text, jsonb, text
) from public;
grant execute on function public.create_booking_lock(
  uuid, uuid[], timestamptz, text, text, text, jsonb, text
) to anon, authenticated;

-- Helper RPC to verify active pending lock before sending OTP
create or replace function public.has_active_booking_lock(p_lock_token uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.bookings b
    where b.lock_token = p_lock_token
      and b.status = 'pending'
      and b.locked_until > now()
  );
$$;

revoke all on function public.has_active_booking_lock(uuid) from public;
grant execute on function public.has_active_booking_lock(uuid) to anon, authenticated;

-- 7. Atomic single-UPDATE booking confirmation & race-condition protection
drop function if exists public.confirm_booking(uuid, text, text, text);

create or replace function public.confirm_booking_with_privacy(
  p_lock_token uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null,
  p_privacy_accepted boolean default false,
  p_privacy_policy_version text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_id uuid;
  v_row_count integer := 0;
begin
  if p_privacy_accepted is not true
    or nullif(trim(p_privacy_policy_version), '') is null
  then
    raise exception 'Privacy notice acceptance is required.';
  end if;

  if p_lock_token is null
    or nullif(trim(p_customer_name), '') is null
    or nullif(trim(p_customer_email), '') is null
    or length(trim(p_customer_name)) > 200
    or length(trim(p_customer_email)) > 320
    or position('@' in trim(p_customer_email)) = 0
    or length(coalesce(trim(p_customer_phone), '')) > 40
  then
    raise exception 'A valid lock, customer name, and email are required.';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(trim(p_customer_email))
  ) then
    raise exception 'A confirmed email address matching the booking is required.';
  end if;

  update public.bookings as b
  set ugyfel_nev = trim(p_customer_name),
      ugyfel_email = lower(trim(p_customer_email)),
      ugyfel_telefon = nullif(trim(p_customer_phone), ''),
      status = 'confirmed',
      locked_until = null,
      lock_token = null,
      privacy_accepted_at = now(),
      privacy_policy_version = trim(p_privacy_policy_version)
  where b.lock_token = p_lock_token
    and b.status = 'pending'
    and b.locked_until > now()
  returning b.id into v_booking_id;

  get diagnostics v_row_count = row_count;

  if v_row_count <> 1 or v_booking_id is null then
    raise exception 'The booking lock is invalid or has expired.';
  end if;

  return v_booking_id;
end;
$$;

revoke all on function public.confirm_booking_with_privacy(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.confirm_booking_with_privacy(uuid, text, text, text, boolean, text) to authenticated;

-- 8. Tenant & Superadmin management RPCs with SET search_path = public, pg_temp and strict REVOKE
create or replace function public.add_manual_blockout(
  p_company_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockout_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_start <= v_now then
    raise exception 'Enter a valid future time range.';
  end if;

  perform 1
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

  if exists (
    select 1
    from public.bookings b
    where b.cég_id = p_company_id
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_start, p_end, '[)')
  ) then
    raise exception 'The blockout conflicts with an active booking.';
  end if;

  insert into public.manual_blockouts (cég_id, kezdes_ideje, vege_ideje, megjegyzes)
  values (p_company_id, p_start, p_end, nullif(trim(p_note), ''))
  returning id into v_blockout_id;

  return v_blockout_id;
end;
$$;

create or replace function public.delete_manual_blockout(p_blockout_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  delete from public.manual_blockouts m
  using public.companies c
  where m.id = p_blockout_id
    and c.id = m.cég_id
    and (
      c.owner_id = (select auth.uid())
      or (select public.is_platform_admin())
    );

  if not found then
    raise exception 'Blockout not found or access denied.';
  end if;
end;
$$;

create or replace function public.set_company_status(
  p_company_id uuid,
  p_status text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not (select public.is_platform_admin()) then
    raise exception 'Platform administrator access is required.';
  end if;
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'Invalid company status.';
  end if;

  update public.companies
  set status = p_status
  where id = p_company_id;

  if not found then
    raise exception 'Company not found.';
  end if;
end;
$$;

create or replace function public.update_company_business_hours(
  p_company_id uuid,
  p_schedule jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_open time;
  v_close time;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if jsonb_typeof(p_schedule) is distinct from 'array'
    or jsonb_array_length(p_schedule) <> 7
    or exists (
      select 1
      from jsonb_to_recordset(p_schedule) as item(
        weekday integer,
        is_open boolean,
        opens_at text,
        closes_at text
      )
      where item.weekday not between 0 and 6
        or item.weekday is null
        or item.is_open is null
        or item.opens_at is null
        or item.closes_at is null
        or item.opens_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or item.closes_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or (
          item.is_open
          and (
            item.opens_at::time >= item.closes_at::time
          )
        )
    )
    or (
      select count(distinct item.weekday)
      from jsonb_to_recordset(p_schedule) as item(
        weekday integer,
        is_open boolean,
        opens_at text,
        closes_at text
      )
    ) <> 7
  then
    raise exception 'The weekly business-hours schedule is invalid.';
  end if;

  if not exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and (
        c.owner_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  ) then
    raise exception 'You are not allowed to manage this company.';
  end if;

  select min(item.opens_at::time), max(item.closes_at::time)
    into v_open, v_close
  from jsonb_to_recordset(p_schedule) as item(
    weekday integer,
    is_open boolean,
    opens_at text,
    closes_at text
  )
  where item.is_open;

  if v_open is null or v_close is null or v_open >= v_close then
    raise exception 'At least one valid opening day is required.';
  end if;

  update public.companies
  set nyitvatartas_kezdet = v_open,
      nyitvatartas_vege = v_close
  where id = p_company_id;

  delete from public.company_business_hours h
  where h.company_id = p_company_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_schedule) as item(
        weekday integer,
        is_open boolean,
        opens_at text,
        closes_at text
      )
      where item.weekday = h.weekday
        and item.is_open
    );

  insert into public.company_business_hours (
    company_id, weekday, opens_at, closes_at
  )
  select p_company_id, item.weekday, item.opens_at::time, item.closes_at::time
  from jsonb_to_recordset(p_schedule) as item(
    weekday integer,
    is_open boolean,
    opens_at text,
    closes_at text
  )
  where item.is_open
  on conflict (company_id, weekday)
  do update set opens_at = excluded.opens_at,
                closes_at = excluded.closes_at;
end;
$$;

create or replace function public.update_platform_company_settings(
  p_company_id uuid,
  p_name text,
  p_slug text,
  p_primary_color text,
  p_plan text,
  p_time_zone text,
  p_slot_interval_minutes integer,
  p_can_manage_services boolean,
  p_schedule jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not (select public.is_platform_admin()) then
    raise exception 'Platform administrator access is required.';
  end if;
  if nullif(trim(p_name), '') is null
    or length(trim(p_name)) > 100
    or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_primary_color !~ '^#[0-9A-Fa-f]{6}$'
    or p_plan not in ('free', 'starter', 'pro')
    or nullif(trim(p_time_zone), '') is null
    or length(p_time_zone) > 100
    or p_slot_interval_minutes not between 5 and 240
    or p_can_manage_services is null
  then
    raise exception 'Company settings are invalid.';
  end if;

  update public.companies
  set nev = trim(p_name),
      slug = p_slug,
      primary_color = p_primary_color,
      plan = p_plan,
      time_zone = trim(p_time_zone),
      slot_interval_minutes = p_slot_interval_minutes,
      can_manage_services = p_can_manage_services
  where id = p_company_id;

  if not found then
    raise exception 'Company not found.';
  end if;

  perform public.update_company_business_hours(p_company_id, p_schedule);
end;
$$;

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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
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

create or replace function public.reorder_company_services(
  p_company_id uuid,
  p_service_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_service_count integer;
begin
  if auth.uid() is null or not (select public.is_platform_admin()) then
    raise exception 'Platform administrator access is required.';
  end if;

  select count(*)::integer
    into v_company_service_count
  from public.services
  where "cég_id" = p_company_id;

  if cardinality(p_service_ids) is distinct from v_company_service_count
    or cardinality(p_service_ids) <> (
      select count(distinct service_id)::integer
      from unnest(p_service_ids) as requested(service_id)
    )
    or exists (
      select 1
      from public.services s
      where s."cég_id" = p_company_id
        and not (s.id = any(p_service_ids))
    )
    or exists (
      select 1
      from unnest(p_service_ids) as requested(service_id)
      where not exists (
        select 1
        from public.services s
        where s.id = requested.service_id
          and s."cég_id" = p_company_id
      )
    )
  then
    raise exception 'The service order must contain each company service exactly once.';
  end if;

  update public.services s
  set display_order = requested.position - 1
  from unnest(p_service_ids) with ordinality as requested(service_id, position)
  where s.id = requested.service_id
    and s."cég_id" = p_company_id;
end;
$$;

revoke all on function public.add_manual_blockout(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.delete_manual_blockout(uuid) from public, anon;
revoke all on function public.set_company_status(uuid, text) from public, anon;
revoke all on function public.update_company_business_hours(uuid, jsonb) from public, anon;
revoke all on function public.update_platform_company_settings(uuid, text, text, text, text, text, integer, boolean, jsonb) from public, anon;
revoke all on function public.update_platform_company_booking_settings(uuid, boolean, boolean, jsonb) from public, anon;
revoke all on function public.update_platform_company_all_settings(uuid, text, text, text, text, text, integer, boolean, boolean, jsonb, jsonb) from public, anon;
revoke all on function public.reorder_company_services(uuid, uuid[]) from public, anon;

grant execute on function public.add_manual_blockout(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.delete_manual_blockout(uuid) to authenticated;
grant execute on function public.set_company_status(uuid, text) to authenticated;
grant execute on function public.update_company_business_hours(uuid, jsonb) to authenticated;
grant execute on function public.update_platform_company_settings(uuid, text, text, text, text, text, integer, boolean, jsonb) to authenticated;
grant execute on function public.update_platform_company_booking_settings(uuid, boolean, boolean, jsonb) to authenticated;
grant execute on function public.update_platform_company_all_settings(uuid, text, text, text, text, text, integer, boolean, boolean, jsonb, jsonb) to authenticated;
grant execute on function public.reorder_company_services(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';

commit;
