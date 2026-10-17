# SoLash — Light Luxury / Soft Pink Premium

17 October 2026. Parent production commit: `988700253b876fe62fe599744f4dafdb9d358d1f`.

## Changes

Presentation only: warm ivory canvas, warm white cards, powder pink/dusty rose
controls, lavender personal appointments, champagne details and dark gray text.
All existing layouts, scheduling handlers, reports, authentication and data access
are retained. Scoped styling preserves the original UI flag fallback.

Coverage includes dashboard, monthly/daily calendar, customer cards and history,
all three editor tabs, reports, all eight expanded settings sections, date picker,
cancellation dialog, notices/toasts, autofill, focus/hover/selected/disabled states,
framework fallback backgrounds, native input color scheme and mobile safe areas.
Manifest, Apple status bar metadata, favicon, Apple touch icon and notification
icons use the light theme; icon filenames are versioned to avoid stale asset URLs.
The service worker still does not cache application pages or customer API data.

## Evidence

- 27 existing tests pass; ESLint, TypeScript production compilation and Webpack
  production build pass. No new dependencies. `page.tsx` and business logic unchanged.
- Six main screens at each measured viewport: 375, 390, 430, 768, 1280 pixels.
  All 30 observations have scrollWidth equal to viewport width, and no visible
  opaque dark surfaces detected. Screenshots and matrix: `evidence/light-luxury/`.
- Expanded all eight settings groups at 375px: no overflow or dark surfaces.
- Inspected customer, personal and client forms; date picker; active/cancelled
  agenda; populated calendar; cancellation modal opened and dismissed without
  changing a booking. All browser data used for these checks is synthetic local data.
- Login layout inspected at 375 and 1280px with an unreachable loopback backend.
  No credentials entered or authentication performed.
- Real macOS Safari rendered the light dashboard and successfully handled the
  existing service-worker update/reload notice. No physical iPhone was available.
- Main text contrast 12.38:1; muted text on rose surface 5.10:1; rose links on
  warm white 5.41:1; button text 6.88:1; lavender 6.07:1; champagne 5.24:1;
  danger 5.77:1; success 6.01:1. Ratios are for these explicit palette pairs,
  not a claim of a complete WCAG certification. Outside-month dates remain fully
  opaque for readability. Disabled controls are intentionally faded.

## Release / recovery

User authorized push to main and automatic Vercel Production release. Same project
and Git flow as the previous successful release: `andreiotac-sys-projects/solash`,
https://solash-pink.vercel.app/. Confirm the commit's Production status and live
light login, manifest and versioned assets after push. Existing unsafe Preview
configuration may still be rejected by the previously installed build guard.

No production records, database schema, RLS, secrets or environment configuration
are changed. Native-backup/database authorization blockers from prior audits remain
outside this palette-only release. Rollback code to deployment of `9887002` for the
previous premium black/gold design; `NEXT_PUBLIC_SOLASH_NEW_UI=false` plus rebuild
still selects the original frontend. Database recovery is not needed for a theme
rollback. Installed iPhone PWA appearance, OS icon refresh and dark-mode behavior
must still be confirmed on a physical device; an existing iOS install may retain
its old home-screen icon until the OS refreshes it or the app is re-added.
