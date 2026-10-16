# Database backup and recovery audit — updated 2026-10-16

**Follow-up:** actual public catalog and platform metadata are now accessible through read-only Supabase tools. The organization is Free; native-backup inventory is not exposed by the connected tools, and no native dump/restore has been verified. The private application bucket contains 130 XLSX files and one JSON snapshot, not proof of a native backup. Current source has 3,875 appointments, five more than the preserved snapshot. [NATIVE_BACKUP_RUNBOOK.md](NATIVE_BACKUP_RUNBOOK.md) records the precise remaining native backup and isolated restore steps. Earlier access limitations below describe the initial audit.

## Production baseline and access

The latest successful GitHub `Production` deployment record points to `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058` (2026-09-04). A local annotated tag, `solash-production-baseline-20261015`, points there. Live Vercel project configuration and alias were not independently inspected. The remote `main` tip matched this SHA on 2026-10-15; the local `origin/main` tracking ref was stale at `e148af0` before fetch. No production application-table row or schema was changed; the additional verified backup created one private Storage object.

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
- Contents: every row and column returned by `select('*')` for the seven public application tables listed above, including IDs, foreign keys, statuses, and timestamps. Pages were fetched in ID order, 500 rows at a time. The returned `appointments` rows have **no `notes` column**, although checked-in `supabase/schema.sql` declares one.
- Verification: row counts matched read-only counts before and after export; IDs were unique per table; every appointment referenced an exported client; every reminder referenced an exported appointment; the uploaded object was downloaded again, its SHA-256 matched, decompression succeeded, and downloaded table counts matched. Anonymous download was denied.

This is a **non-transactional table snapshot**, not `pg_dump`. It cannot prove cross-table consistency under concurrent writes beyond the checks above. It does not contain live DDL, sequences, policies, grants, functions, triggers, auth identities, bucket configuration, storage objects other than itself, or browser `localStorage`. It cannot be called a complete database backup. A native logical backup requires database connection credentials or the Supabase dashboard backup capability, neither available in this checkout. The snapshot remains in the private production bucket and must be handled as customer data.

## Isolated restoration performed on 2026-10-15

An authorized download of the private snapshot matched the SHA-256 above. All seven tables were reconstructed into a disposable PostgreSQL 16 container with `--network none`, no published ports, and an in-memory database volume. The import was transactional. Every field of every exported row was compared with the restored row, normalizing timestamp representation. Counts matched all seven values above, IDs were unique, and known appointment-to-client and reminder-to-appointment references remained valid. The snapshot includes 1,848 appointments before 2025 and has appointment dates from 2023-01-30 through 2026-12-30. Thirteen pairs of active bookings overlap on 11 dates; these were preserved, not altered. The proposed SQL protections were then exercised with synthetic data in this isolated database.

This proves that the **seven known exported tables** are restorable from this file. Because the live schema could not be extracted, the test recreated the tables from repository SQL adjusted to the observed `appointments` columns; it is **not a restore of the production schema**. It does not validate Auth login, policies, grants, triggers, cron jobs, Storage, or cross-table transaction consistency. The separate local Supabase Auth/REST tests used synthetic records, not the production snapshot.

The development backup route was invoked separately against **local Supabase** with synthetic data. Its unauthenticated POST returned `401`, authenticated POST returned `200`, and the private XLSX was downloaded from local Storage. The SHA-256 matched and all seven sheets were checked. A unit test generated 1,205 rows in an XLSX sheet to verify the old 1,000-row limit was not repeated. This validates the local endpoint and workbook format; it does not prove the production Vercel cron runs, that a scheduled backup is complete, or that a native schema restore is possible.

## Recovery procedure and outstanding gate

1. Before any restore, obtain a fresh native production backup and preserve new appointments made after the recovery point. Do not restore this snapshot directly over production.
2. Create an isolated Supabase project or local PostgreSQL instance. Recreate and verify the **live** schema, RLS, grants, triggers, functions, and identities from a native dump or Supabase dashboard backup; do not assume checked-in SQL matches production.
3. Download the private snapshot with an authorized service account into encrypted, access-controlled storage. Check its SHA-256 before decompression. Import tables in dependency order into the isolated database and verify counts, IDs, relationships, statuses, and every exported field without publishing customer data. This step passed for the seven known tables; repeat it on a native schema-complete backup.
4. Compare the recovery point with current production by primary key and update timestamp. Merge only intended missing or damaged records, preserving appointments and edits created after 2026-10-15 16:41:04 UTC. Review conflicts manually. A production restore or merge requires explicit owner approval.
5. Test application login, booking, calendar, push, and backup behavior against the isolated restore before considering a production operation.

The remaining data-protection gate is a **native, schema-complete backup plus its isolated restore rehearsal**. The seven-table snapshot restore does not satisfy that gate. Development-only code changes may proceed on the isolated branch; production database changes and deployment remain blocked pending explicit approval. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
