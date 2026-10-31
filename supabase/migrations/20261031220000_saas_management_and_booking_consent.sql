begin;

alter table public.companies
  add column if not exists primary_color text not null default '#1d4ed8',
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_started_at timestamptz not null default now();

alter table public.companies
  add constraint companies_primary_color_check
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint companies_plan_check
    check (plan in ('free', 'starter', 'pro'));

grant select (primary_color) on public.companies to anon, authenticated;

create unique index if not exists companies_slug_lower_unique
  on public.companies (lower(slug));

alter table public.services
  add column if not exists display_order integer not null default 0;

with ordered_services as (
  select id,
         row_number() over (partition by "cég_id" order by nev, id) - 1 as position
  from public.services
)
update public.services s
set display_order = ordered_services.position
from ordered_services
where s.id = ordered_services.id;

create or replace function public.reorder_company_services(
  p_company_id uuid,
  p_service_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_service_count integer;
begin
  if not (select public.is_platform_admin()) then
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

revoke all on function public.reorder_company_services(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_company_services(uuid, uuid[]) to authenticated;

alter table public.bookings
  add column if not exists privacy_accepted_at timestamptz,
  add column if not exists privacy_policy_version text;

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
set search_path = ''
as $$
declare
  v_booking_id uuid;
begin
  if p_privacy_accepted is not true
    or nullif(trim(p_privacy_policy_version), '') is null
  then
    raise exception 'Privacy notice acceptance is required.';
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

  v_booking_id := public.confirm_booking(
    p_lock_token,
    p_customer_name,
    p_customer_email,
    p_customer_phone
  );

  update public.bookings
  set privacy_accepted_at = statement_timestamp(),
      privacy_policy_version = p_privacy_policy_version
  where id = v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.confirm_booking(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.confirm_booking_with_privacy(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.confirm_booking_with_privacy(uuid, text, text, text, boolean, text) to authenticated;

commit;
