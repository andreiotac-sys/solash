# Reports by day, week and month — 24 October 2026

Scope: existing Reports screen, Light Luxury theme and original frontend fallback.
No database schema, records, credentials, dependencies or environment settings changed.

## Delivered

- Day / Week / Month selection, shared date anchor, previous/next period and Today.
- Week is Monday–Sunday; inclusive date filtering works across months and years.
- All visible totals, statuses, top services/customers, busiest days and hourly
  distribution follow the same selected period. Existing monthly/year selectors remain.
- Daily breakdown includes zero-booking days, active/cancelled counts and value;
  collapsed initially for monthly reports to keep the screen manageable.
- Personal blocks remain excluded. Cancelled rows count in history/statuses but
  never in value, active customers or average ticket. Labels distinguish booking
  values from collected payments.
- Hourly distribution now includes appointments outside the old 08:00–21:00 range.

## Evidence

30 tests, ESLint, production Webpack build including TypeScript and diff checks pass.
New tests cover cross-year weeks, inclusive boundaries, cancellation/personal-block
exclusion, zero days, leap February, short-month navigation, year transitions,
DST calendar dates and source immutability.

Local compiled demo UI: day 14 April 2026, week 13–19 April and April month each
show 3 appointments, 3 customers, 870 lei and average 290 lei; forward/backward
navigation restores the totals. Cross-year week 28 December–3 January verified in UI.
Native date editing updates the report; empty periods render zero without NaN.
All three modes reviewed at 375/390/430/768/1280 pixels. Measured responsive matrix
for 390/430/768/1280 shows no horizontal overflow; 375px screenshots inspected too.
Evidence: `evidence/report-periods/` (synthetic data only).

No authenticated production records were created or altered for testing. No physical
iPhone was available. Prior database/native-backup readiness blockers remain separate.

Release: user-authorized non-force push to main, existing Git→Vercel Production
integration for andreiotac-sys-projects/solash. Verify deployment status and live
application assets after push. Recovery: roll back to the successful deployment of
`a76689a`; no database rollback is required.
