# Calendar actions and personal blocks — 16 October 2026

## Scope and authorization

Owner requested direct edit/trash actions, personal blocks from selected calendar intervals, an eyelash logo, and deployment to Vercel Production. Owner chose **cancellation preserving history**, rather than permanent deletion, for customer appointment trash actions. No production database migration or test-record writes are authorized by this release.

## Changes

- Accessible edit/trash icons in customer history, monthly appointment cards, daily timeline and appointment list. Customer trash opens a keyboard-accessible confirmation dialog and updates only status to `Anulata`; cancelled records remain visible in history. Personal-block trash retains the existing deletion handler and confirmation.
- `Pentru mine` panel reuses the Settings personal-block form. Switching from a calendar draft copies its date, start and duration. Presets include Eu gene, Eu par, Eu unghii and existing personal labels; custom labels remain supported.
- Editing a personal block updates its existing appointment ID, keeps its status and zero price, and uses the existing conflict/work-hours checks. No new columns or migration are needed; the production schema without appointment notes remains supported.
- Mouse interval selection works by dragging; touch retains the existing hold threshold to distinguish selection from scrolling.
- New frontend brand symbol is a vector eyelash mark. Original logo and theme remain available with `NEXT_PUBLIC_SOLASH_NEW_UI=false` (rebuild/redeploy required).

## Verification evidence

All browser writes used synthetic data on loopback with Supabase URL, publishable key, service-role key and VAPID public key blank. No production rows were used.

- Calendar mouse drag 09:00–10:30 → draft → Pentru mine → Eu unghii → save: identical date/time/90-minute duration, price 0, visible in timeline and after reload.
- Existing personal block 12:00/90 minutes → edit icon → 120 minutes: updated in place, one block, price 0.
- Overlap attempt against active synthetic customer booking: rejected.
- History trash → Păstrează: active status retained. History trash → confirm: cancelled status, same row remains; repeat trash disabled; reload retains cancelled history.
- History edit opens the editor with the selected booking and closes history.
- Mobile viewport 390px: document width 390px, no horizontal page overflow. Screenshots in `evidence/calendar-personal-actions/`.
- Real macOS Safari: new personal panel rendered; preset, 90-minute duration and save succeeded with a local-only synthetic block.
- Existing automated suite: 22/22 pass. ESLint passed. Final optimized Next/Webpack build and TypeScript check passed; the compiled local server rendered the new personal panel at 390px.
- An intermediate compact-card reference error was found during testing and fixed before the final build.

Physical iPhone touch gestures, installed PWA behavior and authenticated production write flows were not tested. macOS Safari does not establish physical iPhone/PWA success.

## Deployment and recovery

Target: existing Vercel team `andreiotac-sys-projects`, project `solash`, production domain `solash-pink.vercel.app`; current Git Production branch `main`. Verify remote main is still baseline `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058` before a non-force fast-forward release. Push the reviewed development commit to main only after local checks. Wait for the Vercel GitHub status to complete and inspect the public production login without submitting credentials or creating records.

Frontend rollback: set Production `NEXT_PUBLIC_SOLASH_NEW_UI=false` and redeploy the same release to restore the previous frontend theme/logo. For full code rollback, use Vercel Instant Rollback to the previous Production deployment at `1a8d8b3` (preserved baseline tag `solash-production-baseline-20261015`). Reverting frontend/code does not revert customer status changes or other legitimate writes made after release. Do not restore old data over production as a frontend recovery step.

Existing backup inventory, authorization and database concurrency readiness limitations remain documented in the readiness reports; this UI release is not evidence that those blockers have been resolved. The three proposed SQL migrations remain unapplied.

## Sunday exception fix — 16 October 2026

Personal-block creation previously rejected closed days and out-of-hours intervals outright. It now uses the shared booking validator: invalid intervals and overlaps remain blocking, while closed days/out-of-hours produce a warning with `Nu` / `Da, salveaza`. The latter explicitly confirms only the hours exception; validation and conflict detection run again before saving. The recurring schedule is not changed. Customer booking creation already supported confirmation and was verified again.

Loopback browser tests with all Supabase credentials blank: Sunday 18 October 2026, personal block 10:00–11:30, decline leaves no record, confirm saves; duplicate overlap rejected; customer booking 12:00–13:00 warns then saves; both remain visible after reload in the monthly calendar. A regression test covers a disabled Sunday, conflict priority and an invalid overnight interval. Automated suite: 23/23 pass. No production test rows or schema changes.
