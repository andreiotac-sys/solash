-- PROPOSAL ONLY. Apply to an isolated clone first; production requires owner approval.
-- Existing historical overlaps remain untouched. New active intervals are serialized per date.
-- This does not enforce working hours; the application's explicit hours override stays valid.
begin;
set local lock_timeout = '5s';

do $$
begin
  if (
    select count(*) from pg_attribute
    where attrelid = 'public.appointments'::regclass
      and attname in ('appointment_date', 'start_time', 'duration', 'status')
      and attnotnull and not attisdropped
  ) <> 4 then
    raise exception 'Appointment date, time, duration, and status must be NOT NULL';
  end if;
end;
$$;

create function public.solash_guard_duration_minutes(value text)
returns integer
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  parts text[];
  minutes bigint;
begin
  parts := regexp_match(lower(btrim(value)),
    '^(?:([0-9]+)[[:space:]]*h)?[[:space:]]*(?:([0-9]+)[[:space:]]*(?:min|m))?$');
  if parts is null or (parts[1] is null and parts[2] is null) then
    if btrim(value) ~ '^[0-9]+$' then
      minutes := btrim(value)::bigint;
    else
      raise exception 'Invalid appointment duration' using errcode = '22023';
    end if;
  else
    minutes := coalesce(parts[1]::bigint, 0) * 60 + coalesce(parts[2]::bigint, 0);
  end if;
  if minutes < 1 or minutes > 1440 then
    raise exception 'Invalid appointment duration' using errcode = '22023';
  end if;
  return minutes::integer;
end;
$$;

-- A legacy overnight interval would bypass the per-date lock on the next date.
-- Refuse installation until all existing duration formats and boundaries are known.
do $$
begin
  perform public.solash_guard_duration_minutes(duration)
  from public.appointments
  where status is distinct from 'Anulata';
  if exists (
    select 1 from public.appointments
    where status is distinct from 'Anulata'
      and extract(epoch from start_time)
        + 60 * public.solash_guard_duration_minutes(duration) > 86400
  ) then
    raise exception 'Existing appointment extends past midnight; review before guard installation';
  end if;
end;
$$;

create function public.solash_prevent_booking_overlap()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  new_start numeric;
  new_end numeric;
begin
  if new.appointment_date is null or new.start_time is null or
     new.duration is null or new.status is null then
    raise exception 'Appointment date, time, duration, and status are required'
      using errcode = '23502';
  end if;

  if tg_op = 'UPDATE' and
     new.appointment_date is not distinct from old.appointment_date and
     new.start_time is not distinct from old.start_time and
     new.duration is not distinct from old.duration and
     old.status is distinct from 'Anulata' and
     new.status is distinct from 'Anulata' then
    -- Status changes between active values do not introduce a new interval.
    -- Existing historical overlaps must remain editable without moving them.
    return new;
  end if;

  if new.status = 'Anulata' then
    return new;
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Booking writes require READ COMMITTED' using errcode = '25000';
  end if;

  new_start := extract(epoch from new.start_time);
  new_end := new_start + 60 * public.solash_guard_duration_minutes(new.duration);
  if new_end > 86400 then
    raise exception 'Appointment extends past midnight' using errcode = '22023';
  end if;

  -- All active writes for a date acquire the same transaction lock before checking.
  perform pg_advisory_xact_lock(260151015, new.appointment_date - date '2000-01-01');
  if exists (
    select 1
    from public.appointments other
    where other.appointment_date = new.appointment_date
      and other.id is distinct from new.id
      and other.status is distinct from 'Anulata'
      and extract(epoch from other.start_time) < new_end
      and extract(epoch from other.start_time)
          + 60 * public.solash_guard_duration_minutes(other.duration) > new_start
  ) then
    raise exception 'Appointment overlaps an active booking or personal block'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke all on function public.solash_guard_duration_minutes(text) from public;
revoke all on function public.solash_prevent_booking_overlap() from public;

create trigger solash_prevent_booking_overlap_trigger
before insert or update of appointment_date, start_time, duration, status
on public.appointments
for each row execute function public.solash_prevent_booking_overlap();

commit;
