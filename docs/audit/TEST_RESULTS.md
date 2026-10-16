# Test results — updated 2026-10-16

All state-changing application tests below used isolated PostgreSQL or local Supabase with synthetic records. The seven known production tables were exported read-only; a private production Storage object was created and verified for the authorized snapshot. No test changed application-table rows or the production schema.

| Check | Result and limit |
| --- | --- |
| Read-only production inventory | Seven table counts established; see [DATABASE_BACKUP_AND_RECOVERY.md](DATABASE_BACKUP_AND_RECOVERY.md). Live DDL/RLS/Auth settings were unavailable. |
| Existing daily workbook | Only 1,000 of 3,870 appointments were present. It is not a complete recovery point. |
| Private snapshot download | SHA-256 of uploaded/downloaded compressed bytes matched; anonymous download was denied. Snapshot is non-transactional and omits schema/Auth/settings. |
| Seven-table isolated restoration | PostgreSQL 16 container with `--network none` and no published ports; every field of every exported row compared after import. Seven counts, unique IDs, known relationships, statuses, and historical appointments passed. Not a native schema restore. |
| Three proposed database migrations | Applied only in disposable PostgreSQL and local Supabase. **17/17** synthetic SQL checks passed on the final SQL, including concurrent inserts, second-level boundaries, cancelled-slot reactivation, personal blocks, historical overlap status, and client/appointment deletion guards. Nullable-status, overnight historical interval, and repeat-install preflight cases aborted as intended; the failed overnight migration rolled back completely. Local authenticated REST returned `23P01` on overlap and `23503` on client deletion; authenticated SQL DELETE affected zero customer appointments but allowed a personal block. No production schema change. See [MIGRATION_READINESS.md](MIGRATION_READINESS.md). |
| Local authenticated browser | Synthetic customer create/edit and deletion block; appointment create, edit/reschedule and cancellation; monthly calendar navigation; authorized outside-hours booking and calendar visibility passed with local Supabase. The day-off booking exposed a hidden appointment; the development UI now displays it as an exception. These are not real iPhone or production tenant tests. |
| Local backup endpoint | Unauthenticated POST returned `401`, authenticated POST returned `200`. The private XLSX was downloaded from **local** Storage, SHA-256 matched, and all seven sheets were verified. Vercel cron invocation and production backup behavior are untested. |
| Mobile-sized browser | Demo viewport at 375, 390, and 430 CSS px had no horizontal overflow. Home and booking screens and bottom navigation were inspected in the in-app browser. Safari control timed out; Safari/PWA/VoiceOver remain untested. |
| XLSX export unit test | `tests/backup-workbook.test.mjs` verified 1,205 rows, headers, IDs, string values and absence of formula nodes in the generated workbook. The local cloud backup endpoint was also verified as above; scheduled production backups remain unverified. |
| `npm test` | 22 tests passed: 21 deterministic scheduling cases plus one workbook test. |
| `npm run lint`; `npx tsc --noEmit`; `npm run build` | All passed **after the final UI changes**. The build script now uses Webpack and passed with both the redesigned UI and `NEXT_PUBLIC_SOLASH_NEW_UI=false`. Turbopack passed once, then failed intermittently in this sandbox because its CSS worker could not bind a local port; it is not the release build path. |
| `npm audit --omit=dev` | Zero production-tree advisories after updating Next and replacing `xlsx`. Full audit found five high advisories in the development-only Next ESLint chain (`braces`, `micromatch`, `fast-glob`). |

## Release checks still required

1. Run the scheduled backup after any separately approved deployment and verify its downloaded file. The local manual endpoint passed; Vercel cron operation has not been observed.
2. Complete any remaining customer-history and browser conflict-feedback checks with isolated records. The SQL concurrent-write path passed, but drag/long-press and offline queue reconciliation still need end-to-end coverage.
3. Test Safari on a physical iPhone, installed PWA, safe areas, VoiceOver, long-press/drag and offline/reconnection behavior. The attempted Safari control timed out. Confirm both `NEXT_PUBLIC_SOLASH_NEW_UI` settings in an isolated deployment.
4. Obtain a native database backup and restore it in isolation with Auth, RLS, grants, Storage and the exact live schema. Inspect all foreign keys and deletion paths before any migration approval.
5. Verify Vercel Production/Preview variable isolation and active cron configuration before any push, preview or production deployment. No Vercel project settings were accessible in this test session.

The tests show meaningful improvements but do **not** establish production release readiness. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for the decision and approval gates.
