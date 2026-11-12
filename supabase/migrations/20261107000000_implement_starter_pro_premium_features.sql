-- Migration: Starter vs. Pro (Premium) Tier Architecture, Manual Bookings,
-- Customer Cancellation (24h limit), Mini-CRM Notes, and No-Show Blacklist

-- Add 'no_show' to public.booking_status enum (if bookings.status uses the enum type)
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'booking_status'
  ) then
    execute 'alter type public.booking_status add value if not exists ''no_show''';
  end if;
end;
$$;

begin;

-- 1. Convert any legacy 'free' tier to 'starter' and enforce ('starter', 'pro') only
update public.companies
set plan = 'starter'
where plan = 'free' or plan is null;

alter table public.companies
  alter column plan set default 'starter',
  alter column can_manage_services set default true,
  alter column can_edit_prices set default true,
  alter column can_manage_services_advanced set default true;

-- Enable full service & price management by default for existing companies
update public.companies
set can_manage_services = true,
    can_edit_prices = true,
    can_manage_services_advanced = true
where can_edit_prices = false
  and can_manage_services_advanced = false;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'companies'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan%'
  loop
    execute format('alter table public.companies drop constraint if exists %I', v_constraint_name);
  end loop;
end;
$$;

alter table public.companies
  add constraint companies_plan_starter_pro_check
  check (plan in ('starter', 'pro'));

alter table public.companies
  add column if not exists subscription_tier text generated always as (plan) stored;

-- Grant anon SELECT on plan & subscription_tier so the public booking page can gate Pro custom fields
grant select (
  id,
  nev,
  slug,
  nyitvatartas_kezdet,
  nyitvatartas_vege,
  time_zone,
  slot_interval_minutes,
  primary_color,
  custom_booking_fields,
  plan,
  subscription_tier
) on public.companies to anon;

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
  subscription_tier,
  subscription_started_at,
  can_manage_services,
  can_edit_prices,
  can_manage_services_advanced,
  custom_booking_fields
) on public.companies to authenticated;

-- 2. Extend public.bookings with 'no_show' status and cancellation_token
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'bookings'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.bookings drop constraint if exists %I', v_constraint_name);
  end loop;
end;
$$;

alter table public.bookings
  add constraint bookings_status_check
  check (status::text in ('pending', 'confirmed', 'cancelled', 'no_show'));

alter table public.bookings
  add column if not exists cancellation_token uuid unique default gen_random_uuid(),
  add column if not exists cancelled_at timestamptz;

grant update (status) on public.bookings to authenticated;

drop policy if exists "Owners and admins can update booking status" on public.bookings;
create policy "Owners and admins can update booking status"
  on public.bookings
  for update
  to authenticated
  using ((select public.can_manage_company(bookings.cég_id)))
  with check ((select public.can_manage_company(bookings.cég_id)));

create index if not exists bookings_cancellation_token_idx
  on public.bookings (cancellation_token)
  where cancellation_token is not null;

-- 3. Mini-CRM: Customer private notes table (Pro feature)
create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_name text not null default '',
  customer_email text not null,
  customer_phone text,
  customer_key text generated always as (lower(customer_email)) stored,
  private_note text not null default '' check (length(private_note) <= 2000),
  updated_at timestamptz not null default now(),
  constraint customer_notes_company_email_unique unique (company_id, customer_email)
);

alter table public.customer_notes
  add column if not exists customer_name text not null default '',
  add column if not exists customer_key text generated always as (lower(customer_email)) stored;

create index if not exists customer_notes_company_idx
  on public.customer_notes (company_id, customer_email);

alter table public.customer_notes enable row level security;
revoke all on public.customer_notes from public, anon;
grant select, insert, update, delete on public.customer_notes to authenticated;

drop policy if exists "Pro owners and admins can manage customer notes" on public.customer_notes;
create policy "Pro owners and admins can manage customer notes"
  on public.customer_notes
  for all
  to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = customer_notes.company_id
        and c.owner_id = (select auth.uid())
        and c.plan = 'pro'
    )
  )
  with check (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = customer_notes.company_id
        and c.owner_id = (select auth.uid())
        and c.plan = 'pro'
    )
  );

-- 4. No-Show Blacklist table (Pro feature)
create table if not exists public.company_blacklist (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text,
  phone text,
  reason text not null default '' check (length(reason) <= 500),
  created_at timestamptz not null default now(),
  constraint company_blacklist_contact_required check (
    nullif(trim(coalesce(email, '')), '') is not null
    or nullif(trim(coalesce(phone, '')), '') is not null
  )
);

create index if not exists company_blacklist_lookup_idx
  on public.company_blacklist (company_id, lower(email), phone);

alter table public.company_blacklist enable row level security;
revoke all on public.company_blacklist from public, anon;
grant select, insert, update, delete on public.company_blacklist to authenticated;

drop policy if exists "Pro owners and admins can manage blacklist" on public.company_blacklist;
create policy "Pro owners and admins can manage blacklist"
  on public.company_blacklist
  for all
  to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = company_blacklist.company_id
        and c.owner_id = (select auth.uid())
        and c.plan = 'pro'
    )
  )
  with check (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = company_blacklist.company_id
        and c.owner_id = (select auth.uid())
        and c.plan = 'pro'
    )
  );

-- 5. Update Superadmin settings RPCs to enforce ('starter', 'pro') plans
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
    or p_plan not in ('starter', 'pro')
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

revoke all on function public.update_platform_company_settings(uuid, text, text, text, text, text, integer, boolean, jsonb) from public, anon;
grant execute on function public.update_platform_company_settings(uuid, text, text, text, text, text, integer, boolean, jsonb) to authenticated;

-- 6. Update create_booking_lock to gate custom_booking_fields strictly to 'pro' companies
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

  -- Only 'pro' tier companies use custom_booking_fields
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

-- 7. Update confirm_booking_with_privacy to enforce Pro company_blacklist check
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
  v_company_id uuid;
  v_company_plan text;
  v_row_count integer := 0;
  v_clean_email text := lower(trim(coalesce(p_customer_email, '')));
  v_clean_phone text := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if p_privacy_accepted is not true
    or nullif(trim(p_privacy_policy_version), '') is null
  then
    raise exception 'Privacy notice acceptance is required.';
  end if;

  if p_lock_token is null
    or nullif(trim(p_customer_name), '') is null
    or v_clean_email = ''
    or length(trim(p_customer_name)) > 200
    or length(v_clean_email) > 320
    or position('@' in v_clean_email) = 0
    or length(coalesce(trim(p_customer_phone), '')) > 40
  then
    raise exception 'A valid lock, customer name, and email are required.';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and lower(u.email) = v_clean_email
  ) then
    raise exception 'A confirmed email address matching the booking is required.';
  end if;

  select b.cég_id, c.plan
    into v_company_id, v_company_plan
  from public.bookings b
  join public.companies c on c.id = b.cég_id
  where b.lock_token = p_lock_token
    and b.status = 'pending'
    and b.locked_until > now();

  if not found then
    raise exception 'The booking lock is invalid or has expired.';
  end if;

  -- Pro Blacklist enforcement
  if v_company_plan = 'pro' and exists (
    select 1
    from public.company_blacklist bl
    where bl.company_id = v_company_id
      and (
        (bl.email is not null and lower(trim(bl.email)) = v_clean_email)
        or (
          v_clean_phone is not null
          and bl.phone is not null
          and regexp_replace(bl.phone, '[^0-9+]', '', 'g') = v_clean_phone
        )
      )
  ) then
    raise exception 'Online booking is restricted for this contact.';
  end if;

  update public.bookings as b
  set ugyfel_nev = trim(p_customer_name),
      ugyfel_email = v_clean_email,
      ugyfel_telefon = nullif(trim(p_customer_phone), ''),
      status = 'confirmed',
      locked_until = null,
      lock_token = null,
      privacy_accepted_at = now(),
      privacy_policy_version = trim(p_privacy_policy_version),
      cancellation_token = coalesce(b.cancellation_token, gen_random_uuid())
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

-- 8. Manual Booking RPC for Providers (Starter & Pro) without OTP
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

-- 9. Pro Online Customer Cancellation RPC with strict 24-hour cutoff
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

  if v_booking.kezdes_ideje <= v_now + interval '24 hours' then
    raise exception 'Cancellation is only allowed more than 24 hours before the appointment.';
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

notify pgrst, 'reload schema';

commit;
