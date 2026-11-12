-- =============================================================================
-- Migration: Multi-Staff, Provider & Customer Reschedule, Two-Way Calendar Sync,
-- Automated Google Review Requests, and Audit Logs
-- =============================================================================

begin;

-- 1. Extend companies with Google Review URL and Calendar Sync fields
alter table public.companies
  add column if not exists google_review_url text default null,
  add column if not exists calendar_feed_token uuid unique not null default gen_random_uuid(),
  add column if not exists external_calendar_ics_url text default null,
  add column if not exists external_calendar_last_synced_at timestamptz default null;

alter table public.companies
  drop constraint if exists companies_google_review_url_length_check;

alter table public.companies
  add constraint companies_google_review_url_length_check
  check (google_review_url is null or length(google_review_url) <= 500);

alter table public.companies
  drop constraint if exists companies_external_calendar_ics_url_length_check;

alter table public.companies
  add constraint companies_external_calendar_ics_url_length_check
  check (external_calendar_ics_url is null or length(external_calendar_ics_url) <= 1000);

grant select (
  google_review_url,
  calendar_feed_token,
  external_calendar_ics_url,
  external_calendar_last_synced_at
) on public.companies to authenticated;

grant update (
  google_review_url,
  external_calendar_ics_url,
  external_calendar_last_synced_at
) on public.companies to authenticated;

drop policy if exists "Owners and admins can update company integrations" on public.companies;
create policy "Owners and admins can update company integrations"
  on public.companies
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (select public.is_platform_admin())
  )
  with check (
    owner_id = (select auth.uid())
    or (select public.is_platform_admin())
  );

-- 2. Create company_staff table (Multi-Staff / Workstations)
create table if not exists public.company_staff (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  role_title text not null default '' check (length(role_title) <= 100),
  email text default null,
  color text not null default '#2563eb',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.company_staff
  add column if not exists email text default null,
  add column if not exists color text not null default '#2563eb';

create index if not exists company_staff_company_active_idx
  on public.company_staff (company_id, is_active);

alter table public.company_staff enable row level security;
revoke all on public.company_staff from public;
grant select on public.company_staff to anon, authenticated;
grant insert, update, delete on public.company_staff to authenticated;

drop policy if exists "Public can read active staff of active companies" on public.company_staff;
create policy "Public can read active staff of active companies"
  on public.company_staff
  for select
  to anon, authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.companies c
      where c.id = company_staff.company_id
        and c.status = 'active'
    )
  );

drop policy if exists "Owners and admins can manage company staff" on public.company_staff;
create policy "Owners and admins can manage company staff"
  on public.company_staff
  for all
  to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = company_staff.company_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = company_staff.company_id
        and c.owner_id = (select auth.uid())
    )
  );

-- 3. Extend bookings with staff_id, review_email_sent, and rescheduled_at
alter table public.bookings
  add column if not exists staff_id uuid references public.company_staff(id) on delete set null,
  add column if not exists review_email_sent boolean not null default false,
  add column if not exists review_email_sent_at timestamptz default null,
  add column if not exists rescheduled_at timestamptz default null;

create index if not exists bookings_review_queue_idx
  on public.bookings (status, review_email_sent, vege_ideje)
  where status = 'confirmed' and review_email_sent = false;

create index if not exists bookings_staff_idx
  on public.bookings (cég_id, staff_id, kezdes_ideje);

grant insert, delete on public.manual_blockouts to authenticated;

drop policy if exists "Owners and admins can manage blockouts" on public.manual_blockouts;
create policy "Owners and admins can manage blockouts"
  on public.manual_blockouts
  for all
  to authenticated
  using ((select public.can_manage_company(manual_blockouts.cég_id)))
  with check ((select public.can_manage_company(manual_blockouts.cég_id)));

-- 4. Create audit_logs table (Eseménynapló)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid default null,
  action text not null check (length(trim(action)) between 1 and 100),
  entity_type text not null default 'booking' check (length(entity_type) <= 50),
  entity_id text default null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_company_created_idx
  on public.audit_logs (company_id, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon;
grant select, insert on public.audit_logs to authenticated;

drop policy if exists "Owners and admins can view and insert audit logs" on public.audit_logs;
create policy "Owners and admins can view and insert audit logs"
  on public.audit_logs
  for all
  to authenticated
  using (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = audit_logs.company_id
        and c.owner_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_platform_admin())
    or exists (
      select 1
      from public.companies c
      where c.id = audit_logs.company_id
        and c.owner_id = (select auth.uid())
    )
  );

-- 5. Provider Booking Reschedule RPC
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
    );

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

  if exists (
    select 1
    from public.bookings b
    where b.cég_id = v_company.id
      and b.id <> v_booking.id
      and (v_target_staff is null or b.staff_id is null or b.staff_id = v_target_staff)
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
  ) or exists (
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

-- 6. Provider Booking Cancellation RPC
create or replace function public.cancel_booking_by_provider(
  p_booking_id uuid,
  p_reason text default null
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
  if auth.uid() is null then
    raise exception 'Authentication is required.';
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
    );

  if not found then
    raise exception 'You are not allowed to manage this company.';
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = v_now,
      cancellation_token = null
  where id = v_booking.id;

  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (
    v_company.id,
    auth.uid(),
    'booking.cancelled_by_provider',
    'booking',
    v_booking.id::text,
    jsonb_build_object(
      'starts_at', v_booking.kezdes_ideje,
      'customer_name', coalesce(v_booking.ugyfel_nev, ''),
      'reason', coalesce(p_reason, '')
    )
  );

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

revoke all on function public.cancel_booking_by_provider(uuid, text) from public, anon;
grant execute on function public.cancel_booking_by_provider(uuid, text) to authenticated;

-- 7. Customer Online Reschedule RPC with strict 24-hour cutoff (Pro feature)
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
  where c.id = v_booking.cég_id;

  if not found or v_company.plan <> 'pro' then
    raise exception 'Online rescheduling is only available for Pro tier providers.';
  end if;

  if v_booking.kezdes_ideje <= v_now + interval '24 hours' then
    raise exception 'Rescheduling is only allowed more than 24 hours before the appointment.';
  end if;

  v_duration_minutes := greatest(
    5,
    round(extract(epoch from (v_booking.vege_ideje - v_booking.kezdes_ideje)) / 60.0)::integer
  );
  v_slot_duration :=
    ceil(v_duration_minutes::numeric / v_company.slot_interval_minutes)::integer
      * v_company.slot_interval_minutes;
  v_new_end := p_new_start + make_interval(mins => v_duration_minutes);

  if exists (
    select 1
    from public.bookings b
    where b.cég_id = v_company.id
      and b.id <> v_booking.id
      and (v_booking.staff_id is null or b.staff_id is null or b.staff_id = v_booking.staff_id)
      and b.status in ('pending', 'confirmed')
      and (b.status = 'confirmed' or b.locked_until > v_now)
      and tstzrange(b.kezdes_ideje, b.vege_ideje, '[)')
          && tstzrange(p_new_start, p_new_start + make_interval(mins => v_slot_duration), '[)')
  ) or exists (
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
