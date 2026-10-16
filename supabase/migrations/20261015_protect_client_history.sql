-- PROPOSAL ONLY. Abort if the actual live FK differs from the expected cascade.
-- RESTRICT protects all appointment history, including cancelled rows.
begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.appointments'::regclass
      and constraint_row.conname = 'appointments_client_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.clients'::regclass
      and constraint_row.conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.appointments'::regclass and attname = 'client_id'
      )]::smallint[]
      and constraint_row.confkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.clients'::regclass and attname = 'id'
      )]::smallint[]
      and constraint_row.confdeltype = 'c'
      and constraint_row.confupdtype = 'a'
      and constraint_row.confmatchtype = 's'
      and not constraint_row.condeferrable
      and constraint_row.convalidated
  ) then
    raise exception 'Unexpected appointments/client foreign key; inspect live schema before migration';
  end if;
end;
$$;

alter table public.appointments
  drop constraint appointments_client_id_fkey;
alter table public.appointments
  add constraint appointments_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict not valid;
alter table public.appointments
  validate constraint appointments_client_id_fkey;

commit;
