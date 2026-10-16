-- PROPOSAL ONLY. Apply after protect_client_history, with explicit owner approval.
-- RLS allows authenticated deletion of personal blocks, not customer appointments.
-- The service marker is mutable by authenticated users: this prevents accidental
-- deletion through normal app/API flows, not a malicious authenticated editor.
begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_class
    where oid = 'public.appointments'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_roles
    where rolname = 'authenticated' and not rolbypassrls
  ) or exists (
    select 1 from pg_class relation
    join pg_roles owner_role on owner_role.oid = relation.relowner
    where relation.oid = 'public.appointments'::regclass
      and owner_role.rolname = 'authenticated'
  ) or (
    select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'appointments'
      and cmd in ('DELETE', 'ALL')
  ) <> 1 or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'appointments'
      and policyname = 'Allow authenticated users to delete appointments'
      and cmd = 'DELETE'
      and roles = array['authenticated']::name[]
      and qual = 'true'
  ) then
    raise exception 'Unexpected appointment deletion policy; inspect live RLS before migration';
  end if;
end;
$$;

drop policy "Allow authenticated users to delete appointments" on public.appointments;
create policy "Allow authenticated users to delete personal blocks"
on public.appointments
for delete
to authenticated
using (service = 'Blocaj personal');

commit;
