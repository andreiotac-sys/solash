# SoLash — Premium Studio release, 17 October 2026

## Scope and recovery point

Development branch: `codex/premium-studio-redesign`. Parent production commit:
`6d7687ca0b7febedd1334df2a93abb207fdafb0c`, preserved by local tag
`solash-before-premium-20261016`. User explicitly requested the existing Git push
workflow to Production; no Vercel configuration changes are part of this release.

## Delivered

- Scoped black/gold design system across login, dashboard, calendar, booking,
  customer profiles, reports, settings and dialogs; native SVG eyelash branding.
- Compact daily agenda, visible edit/cancel actions, customer booking/history
  shortcuts, eight collapsible settings groups, clearer calendar day labels.
- Larger calendar time scale for usable controls on short appointments; unchanged
  time-to-pixel conversion logic. Personal blocks have no WhatsApp action.
- Semantic login form, accessible notices, offline/synchronization status and a
  service-worker update prompt that reloads only when requested.
- Reports exclude personal blocks from customer visits and average ticket values;
  cancelled customer history remains available. No stored records are rewritten.
- Preview build guard refuses the known production Supabase project URL and
  privileged Supabase keys. Existing older previews are NOT retroactively isolated.
  Preview environments inheriting those variables will intentionally fail to build.

## Verification performed

- 27 tests pass; ESLint, TypeScript, production Webpack build and `git diff --check`
  pass. No new runtime dependencies.
- Local browser tests using only synthetic/demo data: customer create/edit/search,
  booking create/edit/reschedule, overlap rejection, cancellation preserving the
  same historical record, reuse of released time for a personal block, customer
  history and protected deletion, Sunday warning followed by successful override,
  month selection retained after save, and settings disclosure interaction.
- Real macOS Safari: Sunday booking override, cancellation dialog/history and
  actual Excel download. Downloaded XLSX ZIP contains the three expected sheets
  (Cliente, Programari, Servicii); no production customer export was generated.
- Responsive review at 375/390/430/768/1280 during development. Final compiled
  screenshots retained at measured 375 and 390 pixels, with no horizontal overflow
  on all six main screens. The last browser viewport override remained at 390 for
  larger requested sizes, so those duplicate captures were discarded rather than
  presented as desktop proof. See `evidence/premium-studio/viewport-matrix.json`.
- `NEXT_PUBLIC_SOLASH_NEW_UI=false` restores the previous frontend and retains
  synthetic bookings, cancellation history and personal blocks. Login blank-field
  validation and password-manager autocomplete verified separately.

## Data and security boundaries

No production customer or appointment writes, migrations, RLS changes, restores,
credential changes or production environment edits were performed. Existing backup
object metadata was inspected read-only. The verified seven-table JSON snapshot
is NOT a complete native PostgreSQL backup. Native backup access, previously
identified database authorization/atomic concurrency risks and proposed migrations
remain separate outstanding readiness work. This frontend release does not resolve
or certify those items. Vercel connector project lookup was unavailable; deployment
is verified through GitHub commit statuses and the live public application.

## Limits and manual checks

No physical iPhone was available. Installed iOS PWA safe areas, keyboard/touch/drag,
cache update across an existing installed session and push delivery require a real
iPhone check. Authenticated production workflows and offline reconciliation were
not exercised with real customers. Local demo overlap rejection is not evidence of
atomic database protection across devices. No broad production-readiness claim.

## Release and rollback procedure

1. Commit reviewed source and synthetic evidence on the development branch.
2. Push that branch; ensure remote main still descends from the recorded baseline.
3. Push the same commit to main without force; existing Vercel Git integration
   builds Production. Observe raw commit status history, distinguishing Preview
   failures caused by the guard from the Production deployment result.
4. Read-only smoke check the public login, branding, theme, manifest and service
   worker. Do not create real appointments for this check.
5. On an iPhone, close/reopen the PWA after saving work, accept an update if offered,
   confirm login and calendar navigation, then inspect existing history read-only.
6. For frontend-only recovery set `NEXT_PUBLIC_SOLASH_NEW_UI=false` for Production
   and rebuild/redeploy (public flags are build-time values). For complete code
   rollback, use Vercel Instant Rollback to the successful deployment of `6d7687c`,
   or deploy a reviewed Git revert. Do not reset/force-push shared history.
7. This release has no schema migration. A failed build leaves the previous
   successful deployment serving traffic. Never restore a database for a CSS/UI
   failure. If data appears incorrect, stop writes, collect evidence and investigate
   before any database recovery; require explicit approval for production restores.

Deployment commit and final Vercel status are reported in the accompanying release
message, so this document can ship in that same commit without a self-reference.
