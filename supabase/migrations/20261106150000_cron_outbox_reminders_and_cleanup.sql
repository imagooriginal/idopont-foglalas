-- Migration: 24h Reminder Emails, Outbox Email Retry, Abandoned Lock & Guest GC, and Hungarian GDPR Data Retention Cleanup

begin;

-- 1. Outbox & 24-hour reminder columns on public.bookings
alter table public.bookings
  add column if not exists confirmation_email_sent boolean not null default false,
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists reminder_sent boolean not null default false,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

create index if not exists bookings_outbox_pending_idx
  on public.bookings (kezdes_ideje)
  where status = 'confirmed' and confirmation_email_sent = false;

create index if not exists bookings_reminder_pending_idx
  on public.bookings (kezdes_ideje)
  where status = 'confirmed' and reminder_sent = false;

create index if not exists bookings_retention_cleanup_idx
  on public.bookings (status, vege_ideje);

-- 2. Garbage Collection: 24h+ abandoned booking locks & orphaned temporary OTP guest users
create or replace function public.cleanup_abandoned_locks_and_guests()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz := clock_timestamp() - interval '24 hours';
  v_deleted_locks integer := 0;
  v_deleted_rate_limits integer := 0;
  v_deleted_orphan_users integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role'
    and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'Service role or database administrator access is required.';
  end if;

  -- Delete unfinished / abandoned 5-minute booking locks older than 24 hours
  delete from public.bookings b
  where b.status in ('pending', 'cancelled')
    and b.ugyfel_email is null
    and coalesce(b.locked_until, b.created_at, b.kezdes_ideje) < v_cutoff;

  get diagnostics v_deleted_locks = row_count;

  -- Delete expired rate limit records older than 24 hours
  delete from public.security_rate_limits r
  where r.created_at < v_cutoff;

  get diagnostics v_deleted_rate_limits = row_count;

  -- Delete orphaned temporary OTP guest accounts in auth.users older than 24 hours
  -- Never deletes company owners, platform admins, password-based accounts, or users with confirmed bookings
  delete from auth.users u
  where u.created_at < v_cutoff
    and coalesce(u.encrypted_password, '') = ''
    and not exists (
      select 1
      from public.companies c
      where c.owner_id = u.id
    )
    and not exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = u.id
    )
    and not exists (
      select 1
      from public.bookings b
      where b.ugyfel_email is not null
        and lower(b.ugyfel_email) = lower(u.email)
        and b.status = 'confirmed'
    );

  get diagnostics v_deleted_orphan_users = row_count;

  return jsonb_build_object(
    'deleted_abandoned_locks', v_deleted_locks,
    'deleted_rate_limits', v_deleted_rate_limits,
    'deleted_orphan_users', v_deleted_orphan_users
  );
end;
$$;

revoke all on function public.cleanup_abandoned_locks_and_guests() from public, anon, authenticated;
grant execute on function public.cleanup_abandoned_locks_and_guests() to service_role;

-- 3. Hungarian GDPR / Infotv. Data Retention Cleanup for past bookings
-- Default retention period: 365 days (1 year) after appointment end time (vege_ideje)
-- in accordance with GDPR Art. 5(1)(e) storage limitation & Hungarian civil/consumer claim periods for non-invoicing appointment records.
create or replace function public.cleanup_expired_bookings_retention(
  p_retention_days integer default 365
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_effective_days integer := greatest(coalesce(p_retention_days, 365), 30);
  v_cutoff timestamptz := clock_timestamp() - make_interval(days => v_effective_days);
  v_deleted_bookings integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role'
    and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'Service role or database administrator access is required.';
  end if;

  delete from public.bookings b
  where b.vege_ideje < v_cutoff;

  get diagnostics v_deleted_bookings = row_count;

  return jsonb_build_object(
    'deleted_expired_bookings', v_deleted_bookings,
    'retention_days', v_effective_days,
    'cutoff', v_cutoff
  );
end;
$$;

revoke all on function public.cleanup_expired_bookings_retention(integer) from public, anon, authenticated;
grant execute on function public.cleanup_expired_bookings_retention(integer) to service_role;

-- 4. Combined Daily Database Maintenance entrypoint (used by pg_cron and Vercel Cron)
create or replace function public.run_daily_database_maintenance(
  p_retention_days integer default 365
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_retention jsonb;
  v_gc jsonb;
begin
  if (select auth.role()) is distinct from 'service_role'
    and current_user not in ('postgres', 'supabase_admin')
  then
    raise exception 'Service role or database administrator access is required.';
  end if;

  -- Run expired booking retention cleanup first so any newly-orphaned guest users are also cleaned up in step 2
  v_retention := public.cleanup_expired_bookings_retention(p_retention_days);
  v_gc := public.cleanup_abandoned_locks_and_guests();

  return v_gc || v_retention;
end;
$$;

revoke all on function public.run_daily_database_maintenance(integer) from public, anon, authenticated;
grant execute on function public.run_daily_database_maintenance(integer) to service_role;

-- 5. Automatically register daily pg_cron job if pg_cron extension is enabled in Supabase
do $$
begin
  if exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) then
    execute $cron$
      select cron.schedule(
        'daily-booking-maintenance',
        '0 3 * * *',
        'select public.run_daily_database_maintenance(365)'
      );
    $cron$;
  end if;
exception
  when others then
    raise notice 'pg_cron schedule registration skipped: %', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';

commit;
