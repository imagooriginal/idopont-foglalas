-- Apply after the initial schema has been created.
-- Public booking writes must go through the RPC functions in this migration.

begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Bootstrap the first platform admin manually in the SQL editor:
-- insert into public.platform_admins (user_id)
-- select id from auth.users where email = 'admin@example.com';
revoke all on public.platform_admins from public, anon, authenticated;
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to anon, authenticated;

alter table public.companies
  add column if not exists status text not null default 'active',
  add column if not exists time_zone text not null default 'Europe/Budapest',
  add column if not exists slot_interval_minutes integer not null default 15;

alter table public.companies
  alter column status set default 'pending';

create or replace function public.can_access_company(p_company_id uuid)
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
set search_path = ''
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

revoke all on function public.can_access_company(uuid) from public;
revoke all on function public.can_manage_company(uuid) from public;
grant execute on function public.can_access_company(uuid) to anon, authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_status_check'
  ) then
    alter table public.companies
      add constraint companies_status_check
      check (status in ('pending', 'active', 'suspended'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_slot_interval_check'
  ) then
    alter table public.companies
      add constraint companies_slot_interval_check
      check (slot_interval_minutes between 5 and 240);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_business_hours_check'
  ) then
    alter table public.companies
      add constraint companies_business_hours_check
      check (nyitvatartas_kezdet < nyitvatartas_vege);
  end if;
end;
$$;

create table if not exists public.company_business_hours (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  unique (company_id, weekday),
  check (opens_at < closes_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_duration_positive_check'
  ) then
    alter table public.services
      add constraint services_duration_positive_check
      check (idotartam_percben between 1 and 1440);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_price_nonnegative_check'
  ) then
    alter table public.services
      add constraint services_price_nonnegative_check check (ar >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and conname = 'services_id_company_id_key'
  ) then
    alter table public.services
      add constraint services_id_company_id_key unique (id, cég_id);
  end if;
end;
$$;

alter table public.bookings
  alter column ugyfel_nev drop not null,
  alter column ugyfel_email drop not null,
  add column if not exists jarmu_marka text,
  add column if not exists jarmu_modell text,
  add column if not exists jarmu_rendszam text,
  add column if not exists lock_token uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_lock_token_key'
  ) then
    alter table public.bookings
      add constraint bookings_lock_token_key unique (lock_token);
  end if;
end;
$$;

alter table public.bookings
  drop constraint if exists bookings_service_id_fkey;

update public.bookings
set status = 'cancelled'
where status = 'pending'
  and (locked_until is null or locked_until <= clock_timestamp());

update public.bookings
set lock_token = gen_random_uuid()
where status = 'pending'
  and lock_token is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_valid_time_check'
  ) then
    alter table public.bookings
      add constraint bookings_valid_time_check
      check (vege_ideje > kezdes_ideje);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_service_company_fkey'
  ) then
    alter table public.bookings
      add constraint bookings_service_company_fkey
      foreign key (service_id, cég_id)
      references public.services (id, cég_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manual_blockouts'::regclass
      and conname = 'manual_blockouts_valid_time_check'
  ) then
    alter table public.manual_blockouts
      add constraint manual_blockouts_valid_time_check
      check (vege_ideje > kezdes_ideje);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_no_overlapping_active_periods'
  ) and exists (
    select 1
    from public.bookings a
    join public.bookings b
      on a.cég_id = b.cég_id
     and a.id < b.id
     and tstzrange(a.kezdes_ideje, a.vege_ideje, '[)')
         && tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
    where a.status in ('pending', 'confirmed')
      and b.status in ('pending', 'confirmed')
  ) then
    raise exception
      'Overlapping active bookings exist. Resolve them before applying the exclusion constraint.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_no_overlapping_active_periods'
  ) then
    alter table public.bookings
      add constraint bookings_no_overlapping_active_periods
      exclude using gist (
        cég_id with =,
        tstzrange(kezdes_ideje, vege_ideje, '[)') with &&
      )
      where (status in ('pending', 'confirmed'));
  end if;
end;
$$;

alter table public.companies enable row level security;
alter table public.services enable row level security;
alter table public.bookings enable row level security;
alter table public.manual_blockouts enable row level security;
alter table public.company_business_hours enable row level security;

drop policy if exists "Bárki láthatja a cégeket" on public.companies;
drop policy if exists "Cégtulajdonosok módosíthatják a saját cégüket" on public.companies;
drop policy if exists "Cégtulajdonosok létrehozhatják a saját cégüket" on public.companies;
drop policy if exists "Bárki láthatja a szolgáltatásokat" on public.services;
drop policy if exists "Tulajdonos kezelheti a szolgáltatásait" on public.services;
drop policy if exists "Bárki létrehozhat foglalást" on public.bookings;
drop policy if exists "Tulajdonos kezelheti a foglalásait" on public.bookings;
drop policy if exists "Bárki láthatja a blokkolt időpontokat" on public.manual_blockouts;
drop policy if exists "Tulajdonos kezelheti a blokkolásokat" on public.manual_blockouts;
drop policy if exists "Public can read active companies" on public.companies;
drop policy if exists "Owners can create pending companies" on public.companies;
drop policy if exists "Owners can update their companies" on public.companies;
drop policy if exists "Platform admins can manage companies" on public.companies;
drop policy if exists "Public can read active company services" on public.services;
drop policy if exists "Owners can create services" on public.services;
drop policy if exists "Owners can update services" on public.services;
drop policy if exists "Owners can delete services" on public.services;
drop policy if exists "Platform admins can manage services" on public.services;
drop policy if exists "Owners and admins can read bookings" on public.bookings;
drop policy if exists "Owners and admins can read blockouts" on public.manual_blockouts;
drop policy if exists "Owners and admins can read working hours" on public.company_business_hours;
drop policy if exists "Owners can manage working hours" on public.company_business_hours;
drop policy if exists "Platform admins can manage working hours" on public.company_business_hours;

create policy "Public can read active companies"
on public.companies for select
using (
  status = 'active'
  or owner_id = (select auth.uid())
  or (select public.is_platform_admin())
);

create policy "Owners can create pending companies"
on public.companies for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and status = 'pending'
);

create policy "Owners can update their companies"
on public.companies for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Platform admins can manage companies"
on public.companies for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "Public can read active company services"
on public.services for select
using ((select public.can_access_company(services.cég_id)));

create policy "Owners can create services"
on public.services for insert to authenticated
with check ((select public.can_manage_company(services.cég_id)));

create policy "Owners can update services"
on public.services for update to authenticated
using ((select public.can_manage_company(services.cég_id)))
with check ((select public.can_manage_company(services.cég_id)));

create policy "Owners can delete services"
on public.services for delete to authenticated
using ((select public.can_manage_company(services.cég_id)));

create policy "Platform admins can manage services"
on public.services for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "Owners and admins can read bookings"
on public.bookings for select to authenticated
using ((select public.can_manage_company(bookings.cég_id)));

create policy "Owners and admins can read blockouts"
on public.manual_blockouts for select to authenticated
using ((select public.can_manage_company(manual_blockouts.cég_id)));

create policy "Owners and admins can read working hours"
on public.company_business_hours for select to authenticated
using ((select public.can_manage_company(company_business_hours.company_id)));

create policy "Owners can manage working hours"
on public.company_business_hours for all to authenticated
using ((select public.can_manage_company(company_business_hours.company_id)))
with check ((select public.can_manage_company(company_business_hours.company_id)));

create policy "Platform admins can manage working hours"
on public.company_business_hours for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

revoke all on public.companies, public.services, public.bookings,
  public.manual_blockouts, public.company_business_hours
from public, anon, authenticated;

grant select (id, nev, slug, nyitvatartas_kezdet, nyitvatartas_vege, time_zone)
  on public.companies to anon;
grant select (id, owner_id, nev, slug, nyitvatartas_kezdet, nyitvatartas_vege,
  status, time_zone, slot_interval_minutes)
  on public.companies to authenticated;
grant insert (owner_id, nev, slug, nyitvatartas_kezdet, nyitvatartas_vege,
  time_zone, slot_interval_minutes)
  on public.companies to authenticated;
grant update (nev, slug, nyitvatartas_kezdet, nyitvatartas_vege,
  time_zone, slot_interval_minutes)
  on public.companies to authenticated;

grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;
grant select on public.bookings, public.manual_blockouts,
  public.company_business_hours to authenticated;
grant insert, update, delete on public.company_business_hours to authenticated;

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
                + make_interval(mins => v_duration),
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
                + make_interval(mins => v_duration),
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
          && tstzrange(p_start, p_start + make_interval(mins => v_duration), '[)')
  ) or exists (
    select 1
    from public.manual_blockouts m
    where m.cég_id = p_company_id
      and tstzrange(m.kezdes_ideje, m.vege_ideje, '[)')
          && tstzrange(p_start, p_start + make_interval(mins => v_duration), '[)')
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

create or replace function public.confirm_booking(
  p_lock_token uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
begin
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

  update public.bookings
  set ugyfel_nev = trim(p_customer_name),
      ugyfel_email = trim(p_customer_email),
      ugyfel_telefon = nullif(trim(p_customer_phone), ''),
      status = 'confirmed',
      locked_until = null,
      lock_token = null
  where lock_token = p_lock_token
    and status = 'pending'
    and locked_until > clock_timestamp()
  returning id into v_booking_id;

  if v_booking_id is null then
    raise exception 'The booking lock is invalid or has expired.';
  end if;

  return v_booking_id;
end;
$$;

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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
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

revoke all on function public.list_available_slots(uuid, uuid, date) from public;
revoke all on function public.create_booking_lock(uuid, uuid, timestamptz, text, text, text) from public;
revoke all on function public.confirm_booking(uuid, text, text, text) from public;
revoke all on function public.add_manual_blockout(uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.delete_manual_blockout(uuid) from public;
revoke all on function public.set_company_status(uuid, text) from public;

grant execute on function public.list_available_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.create_booking_lock(uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
grant execute on function public.confirm_booking(uuid, text, text, text) to anon, authenticated;
grant execute on function public.add_manual_blockout(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.delete_manual_blockout(uuid) to authenticated;
grant execute on function public.set_company_status(uuid, text) to authenticated;

commit;
