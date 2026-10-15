# Rollback plan

## Baseline

The verified latest successful GitHub Production deployment record is `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058`, recorded at 2026-09-04 18:42 UTC. The local annotated tag `solash-production-baseline-20261015` points to it. The tag has not been pushed or protected remotely. Local `main` was left unchanged; development work lives on `audit/solash-safe-improvements`.

## Revert the frontend while retaining bug fixes

Set `NEXT_PUBLIC_SOLASH_NEW_UI=false` in the build environment and create a new preview deployment. This uses the prior home markup/styling path while retaining shared scheduling, backup, and security code. The value is compile-time; redeploy to apply it. For a code-only rollback, revert the visual redesign commit(s) on the development branch, then rebuild and retest. Do not revert the booking validation or backup commits if only the appearance is unwanted.

## Production deployment rollback

No production deployment was performed in this task. If a later approved deployment has problems, select the previous verified successful deployment in the Vercel project and promote/rollback through Vercel's deployment UI after confirming the target commit and environment variables. Recheck the GitHub deployment status and the running app. Do not assume Vercel rollback changes Supabase data.

## Database recovery is separate

Git or Vercel rollback does not undo bookings, deletions, or schema changes. Never restore a dated snapshot directly over live production. Capture a fresh native backup, restore into an isolated database, compare IDs and update times with current production, preserve newer appointments, and obtain explicit owner approval for any production merge or restore. See [DATABASE_BACKUP_AND_RECOVERY.md](DATABASE_BACKUP_AND_RECOVERY.md).
