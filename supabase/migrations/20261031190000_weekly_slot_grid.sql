begin;

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
  where c.id = p_company_id
    and c.status = 'active'
  group by c.time_zone, c.slot_interval_minutes;

  if not found or v_service_count <> cardinality(p_service_ids) then
    raise exception 'Company or selected services are unavailable.';
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
grant execute on function public.list_week_slot_grid(uuid, uuid[], date) to anon, authenticated;

commit;
