-- Read-only evidence collection, NOT a migration.
-- Save the results privately: policies/trigger arguments may reveal internal details.
-- Run the entire file with psql -X --set ON_ERROR_STOP=1 --file ... .
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '1s';

select 'environment' as section, jsonb_build_object(
  'captured_at', now(), 'database', current_database(),
  'current_user', current_user, 'session_user', session_user,
  'server_version', current_setting('server_version'),
  'transaction_read_only', current_setting('transaction_read_only'),
  'transaction_isolation', current_setting('transaction_isolation'),
  'session_replication_role', current_setting('session_replication_role')
) as evidence;

select 'relations' as section, jsonb_agg(jsonb_build_object(
  'schema', n.nspname, 'name', c.relname, 'kind', c.relkind,
  'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity,
  'force_rls', c.relforcerowsecurity, 'partition', c.relispartition
) order by n.nspname, c.relname) as evidence
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
  and c.relkind in ('r', 'p', 'v', 'm', 'f');

select 'public_columns' as section, jsonb_agg(jsonb_build_object(
  'table', c.relname, 'column', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
  'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
  'default', pg_get_expr(d.adbin, d.adrelid)
) order by c.relname, a.attnum) as evidence
from pg_attribute a join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and a.attnum > 0 and not a.attisdropped;

select 'constraints_and_delete_graph' as section, jsonb_agg(jsonb_build_object(
  'table', co.conrelid::regclass::text, 'name', co.conname, 'type', co.contype,
  'referenced_table', case when co.confrelid <> 0 then co.confrelid::regclass::text end,
  'definition', pg_get_constraintdef(co.oid), 'validated', co.convalidated,
  'deferrable', co.condeferrable, 'initially_deferred', co.condeferred,
  'delete_action', co.confdeltype, 'update_action', co.confupdtype, 'match_type', co.confmatchtype
) order by co.conrelid::regclass::text, co.conname) as evidence
from pg_constraint co join pg_class c on c.oid = co.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' or co.confrelid in
  (select oid from pg_class where relnamespace = 'public'::regnamespace);

select 'indexes' as section, jsonb_agg(jsonb_build_object(
  'table', i.indrelid::regclass::text, 'name', i.indexrelid::regclass::text,
  'valid', i.indisvalid, 'ready', i.indisready, 'definition', pg_get_indexdef(i.indexrelid)
) order by i.indrelid::regclass::text, i.indexrelid::regclass::text) as evidence
from pg_index i join pg_class c on c.oid = i.indrelid
where c.relnamespace = 'public'::regnamespace;

select 'triggers' as section, jsonb_agg(jsonb_build_object(
  'table', t.tgrelid::regclass::text, 'name', t.tgname, 'enabled', t.tgenabled,
  'internal', t.tgisinternal, 'function', t.tgfoid::regprocedure::text,
  'definition', pg_get_triggerdef(t.oid)
) order by t.tgrelid::regclass::text, t.tgname) as evidence
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where c.relnamespace = 'public'::regnamespace or p.pronamespace = 'public'::regnamespace;

-- Source hashes identify unexpected functions; review relevant source privately.
-- Do not publish function bodies or copy arbitrary SQL from them into a session.
select 'public_functions' as section, jsonb_agg(jsonb_build_object(
  'signature', p.oid::regprocedure::text, 'owner', pg_get_userbyid(p.proowner),
  'security_definer', p.prosecdef, 'volatility', p.provolatile, 'source_md5', md5(p.prosrc),
  'search_path', (select string_agg(value, ',') from unnest(p.proconfig) value where value like 'search_path=%'),
  'acl', p.proacl::text
) order by p.oid::regprocedure::text) as evidence
from pg_proc p where p.pronamespace = 'public'::regnamespace;

select 'policies' as section, jsonb_agg(to_jsonb(p) order by p.schemaname, p.tablename, p.policyname) as evidence
from pg_policies p where p.schemaname in ('public', 'auth', 'storage');

select 'roles' as section, jsonb_agg(jsonb_build_object(
  'name', rolname, 'superuser', rolsuper, 'bypass_rls', rolbypassrls,
  'inherit', rolinherit, 'can_login', rolcanlogin, 'create_role', rolcreaterole
) order by rolname) as evidence from pg_roles;

select 'role_memberships' as section, jsonb_agg(jsonb_build_object(
  'role', pg_get_userbyid(roleid), 'member', pg_get_userbyid(member), 'admin_option', admin_option
)) as evidence from pg_auth_members;

select 'table_grants' as section, jsonb_agg(to_jsonb(g) order by g.table_schema, g.table_name, g.grantee, g.privilege_type) as evidence
from information_schema.role_table_grants g where g.table_schema in ('public', 'auth', 'storage');

select 'sequence_grants' as section, jsonb_agg(to_jsonb(g) order by g.object_schema, g.object_name, g.grantee) as evidence
from information_schema.role_usage_grants g where g.object_schema = 'public';

select 'migration_object_collisions' as section, jsonb_build_object(
  'duration_function', to_regprocedure('public.solash_guard_duration_minutes(text)'),
  'guard_function', to_regprocedure('public.solash_prevent_booking_overlap()'),
  'migration_history_table', to_regclass('supabase_migrations.schema_migrations'),
  'guard_trigger_count', (select count(*) from pg_trigger where tgrelid = 'public.appointments'::regclass
                         and tgname = 'solash_prevent_booking_overlap_trigger')
) as evidence;

-- Aggregate application checks; no customer names, phones, notes, or row IDs.
select 'application_counts' as section, jsonb_build_object(
  'clients', (select count(*) from public.clients),
  'appointments', (select count(*) from public.appointments),
  'personal_blocks', (select count(*) from public.appointments where service = 'Blocaj personal'),
  'historical_before_2025', (select count(*) from public.appointments where appointment_date < date '2025-01-01'),
  'appointments_without_client', (select count(*) from public.appointments a left join public.clients c on c.id = a.client_id where c.id is null),
  'reminders_without_appointment', (select count(*) from public.push_appointment_reminders r left join public.appointments a on a.id = r.appointment_id where a.id is null)
) as evidence;

select 'statuses' as section, jsonb_agg(to_jsonb(s)) as evidence
from (select status, count(*) from public.appointments group by status order by status) s;
select 'duration_formats' as section, jsonb_agg(to_jsonb(s)) as evidence
from (select duration, count(*) from public.appointments group by duration order by duration) s;

rollback;
