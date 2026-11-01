begin;

alter table public.companies
  add column if not exists nyitvatartas_kezdet time not null default time '09:00',
  add column if not exists nyitvatartas_vege time not null default time '17:00',
  add column if not exists can_manage_services boolean not null default false;

update public.companies
set nyitvatartas_kezdet = coalesce(nyitvatartas_kezdet, time '09:00'),
    nyitvatartas_vege = coalesce(nyitvatartas_vege, time '17:00'),
    can_manage_services = coalesce(can_manage_services, false)
where nyitvatartas_kezdet is null
   or nyitvatartas_vege is null
   or can_manage_services is null;

alter table public.companies
  alter column nyitvatartas_kezdet set default time '09:00',
  alter column nyitvatartas_vege set default time '17:00',
  alter column can_manage_services set default false,
  alter column nyitvatartas_kezdet set not null,
  alter column nyitvatartas_vege set not null,
  alter column can_manage_services set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_business_hours_check'
  ) then
    alter table public.companies
      add constraint companies_business_hours_check
      check (nyitvatartas_kezdet < nyitvatartas_vege);
  end if;
end;
$$;

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
)
on conflict (company_id, weekday) do nothing;

create or replace function public.can_manage_services(p_company_id uuid)
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
          and c.can_manage_services
        )
      )
  );
$$;

revoke all on function public.can_manage_services(uuid) from public;
grant execute on function public.can_manage_services(uuid) to authenticated;

drop policy if exists "Owners can create services" on public.services;
drop policy if exists "Owners can update services" on public.services;
drop policy if exists "Owners can delete services" on public.services;

create policy "Authorized owners can create services"
on public.services for insert to authenticated
with check ((select public.can_manage_services(services.cég_id)));

create policy "Authorized owners can update services"
on public.services for update to authenticated
using ((select public.can_manage_services(services.cég_id)))
with check ((select public.can_manage_services(services.cég_id)));

create policy "Authorized owners can delete services"
on public.services for delete to authenticated
using ((select public.can_manage_services(services.cég_id)));

grant select (can_manage_services) on public.companies to authenticated;

create or replace function public.update_company_business_hours(
  p_company_id uuid,
  p_schedule jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
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

revoke all on function public.update_company_business_hours(uuid, jsonb) from public;
grant execute on function public.update_company_business_hours(uuid, jsonb) to authenticated;

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
set search_path = ''
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

revoke all on function public.update_platform_company_settings(
  uuid, text, text, text, text, text, integer, boolean, jsonb
) from public;
grant execute on function public.update_platform_company_settings(
  uuid, text, text, text, text, text, integer, boolean, jsonb
) to authenticated;

commit;
