# Database backup and recovery audit — 2026-10-15

## Production baseline and access

The latest successful GitHub `Production` deployment record points to `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058` (2026-09-04). A local annotated tag, `solash-production-baseline-20261015`, points there. Live Vercel project configuration and alias were not independently inspected. The remote `main` tip matched this SHA on 2026-10-15; the local `origin/main` tracking ref was stale at `e148af0` before fetch. No production database row or schema was changed during this audit.

## Read-only inventory

The configured service role was used only for count and export queries. Counts at snapshot time:

| Table | Rows |
| --- | ---: |
| `clients` | 568 |
| `appointments` | 3,870 |
| `services` | 7 |
| `push_subscriptions` | 3 |
| `push_notification_runs` | 69 |
| `push_appointment_reminders` | 492 |
| `push_delivery_logs` | 566 |

The only listed storage bucket was `solash-backups`, marked private. An anonymous download attempt against the new object was denied (storage status 400). This is an access check, not a full review of Storage policies. The repository's `supabase/schema.sql` describes the seven tables, their primary keys, two appointment-related foreign keys, and indexes. Actual `pg_catalog` objects, RLS policies, grants, triggers, functions, auth schema, and scheduled database jobs could not be inventoried through the available PostgREST access. Treat repository SQL as intended schema, not verified live metadata.

## Existing Excel backups: critically incomplete

The latest file inspected was `solash-backups/daily/solash-backup-2026-10-14-18-07-06-944.xlsx`, created 2026-10-14 18:07:07 UTC. Its sheets contained 568 `Cliente`, **1,000 `Programari`**, and 7 `Servicii` rows. At audit time the database had **3,870 appointments**. The backup route performs one unpaged appointment query; Supabase's result limit truncates it. The appointment sheet also omits `client_id` and, in the inspected workbook, `notes`; it does not preserve all relationships. No push tables, auth users, local working hours, days off, WhatsApp template, or offline queue are included. The service query can fail while the endpoint still reports success and writes an empty `Servicii` sheet. The endpoint does not check a download or restore. The existence of daily files does not prove the scheduled invocation succeeded on every day; the Vercel cron is configured in `vercel.json`, but live scheduler settings and logs were not inspected.

**Do not rely on the existing `daily/` Excel files as full recovery points.**

## Additional verified snapshot

- Private object: `solash-backups/verified/solash-known-tables-2026-10-15T16-41-04-387Z.json.gz`
- Timestamp: 2026-10-15 16:41:04 UTC (19:41 Bucharest)
- SHA-256 of compressed bytes: `01ad4081e50a6a372274bda6d7d2fbe1849cc89e685478ce08653a829d56dc2a`
- Size: 88,696 compressed bytes
- Contents: every row and column returned by `select('*')` for the seven public application tables listed above, with IDs, foreign keys, statuses, notes, and timestamps. Pages were fetched in ID order, 500 rows at a time.
- Verification: row counts matched read-only counts before and after export; IDs were unique per table; every appointment referenced an exported client; every reminder referenced an exported appointment; the uploaded object was downloaded again, its SHA-256 matched, decompression succeeded, and downloaded table counts matched. Anonymous download was denied.

This is a **non-transactional table snapshot**, not `pg_dump`. It cannot prove cross-table consistency under concurrent writes beyond the checks above. It does not contain live DDL, sequences, policies, grants, functions, triggers, auth identities, bucket configuration, storage objects other than itself, or browser `localStorage`. It cannot be called a complete database backup. No isolated restore was performed. A native logical backup requires database connection credentials or the Supabase dashboard backup capability, neither available in this checkout. The snapshot remains in the private production bucket and must be handled as customer data.

## Recovery procedure and outstanding gate

1. Before any restore, obtain a fresh native production backup and preserve new appointments made after the recovery point. Do not restore this snapshot directly over production.
2. Create an isolated Supabase project or local PostgreSQL instance. Recreate and verify the **live** schema, RLS, grants, triggers, functions, and identities from a native dump or Supabase dashboard backup; do not assume checked-in SQL matches production.
3. Download the private snapshot with an authorized service account into encrypted, access-controlled storage. Check its SHA-256 before decompression. Import tables in dependency order into the isolated database and verify counts, IDs, relationships, statuses, and representative records without publishing customer data.
4. Compare the recovery point with current production by primary key and update timestamp. Merge only intended missing or damaged records, preserving appointments and edits created after 2026-10-15 16:41:04 UTC. Review conflicts manually. A production restore or merge requires explicit owner approval.
5. Test application login, booking, calendar, push, and backup behavior against the isolated restore before considering a production operation.

The remaining data-protection gate is a **native, schema-complete backup plus an isolated restore rehearsal**. This audit did not satisfy that gate. Development-only code changes may proceed on the isolated branch; production database changes and deployment remain blocked pending explicit approval.
