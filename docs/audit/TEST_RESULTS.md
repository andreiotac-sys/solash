# Test results — 2026-10-15

## Passed locally

| Check | Result |
| --- | --- |
| `npm run lint` | Passed after scheduling and security edits. |
| `npx tsc --noEmit` | Passed after scheduling and security edits. |
| `npm test` / `node --test tests/scheduling.test.mjs` | 21 deterministic cases passed. See `tests/scheduling.test.mjs`. |
| `npx next build --webpack` | Passed after initial scheduling and backup edits; final post-UI build result should be checked in the final validation pass. |
| Read-only production inventory | Counts for seven known tables obtained without customer values in output. |
| Existing backup verification | Latest inspected workbook contained only 1,000 of 3,870 appointment rows. Failure confirmed. |
| Additional snapshot verification | Seven-table row counts, unique IDs, two foreign-key relationships, upload/download SHA-256, decompression, and anonymous access denial passed. No restore test. |
| Local demo browser | App loaded; 375px home header and navigation screenshot inspected; document width equaled viewport at 375/390/430px. |

## Build and audit issues

The default `npm run build` failed because this Mac's Next.js installation has only WASM SWC bindings and Turbopack needs native bindings. Next.js reported `next build --webpack` as the supported fallback; that build passed before the latest visual edits. `npm audit --omit=dev` reported 8 findings (1 critical, 6 high, 1 moderate) in the installed production dependency tree, including direct `next` and `xlsx`; applicability and upgrades remain open.

## Not yet verified

No automated test wrote to production. No isolated test database was available, so authenticated create/edit/cancel/reschedule, concurrency, offline synchronization, push notification, manual cloud backup route, ICS content, and customer delete protection were not exercised end to end. The new backup route was compiled but not invoked against production because that would create a production storage object and the development code is not deployed. A real iPhone Safari/PWA/VoiceOver test was not performed. The initial local dev browser run reported a hydration mismatch from online-state initialization; the code was fixed, but the browser was not rerun yet. A full isolated database restore has not been attempted.

Release acceptance must include non-production authenticated workflow tests across daily/monthly booking entry points, an iPhone interaction pass, a fresh backup verification after deployment approval, and a separate native database restore rehearsal.
