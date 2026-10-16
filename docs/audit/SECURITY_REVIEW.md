# Security review — updated 2026-10-16

## Verified controls

The browser Supabase client uses a publishable key (`src/lib/supabase.ts`). Server handlers obtain service-role access through `src/lib/push-server.ts`. The `solash-backups` bucket is marked private, and anonymous download of the new snapshot was denied. Backup GET checks `CRON_SECRET`; POST checks a Supabase user token. The ICS feed checks `CALENDAR_FEED_TOKEN` and returns `Cache-Control: private, no-store`. The service worker does not cache client records.

## Findings and action

| Severity | Finding | Action |
| --- | --- | --- |
| High | Live catalog confirms broad authenticated customer/booking policies, one Auth user, and broad SQL TRUNCATE/TRIGGER grants. API roles have no direct login and do not inherit postgres ownership; no public RPC exists. Signup configuration remains unreviewed. | Review least privilege and administrator authorization. Proposed guards do not protect against privileged SQL/service-role or an editor relabelling a row as a personal block. No production policy was changed. |
| High | Push subscribe/unsubscribe used service-role writes without authentication. | Fixed in development branch with bearer-token verification and client token forwarding. Push subscription/PWA integration test with non-production auth is still needed. |
| High | `clients` deletion cascades to appointments in repository schema; broad appointment DELETE policy permits direct deletion through normal authenticated API calls. | UI guards known client history and hides direct customer-appointment deletion when Supabase is configured, while allowing personal-block deletion. Proposed `ON DELETE RESTRICT` FK and narrowed appointment DELETE RLS policy passed isolated SQL/REST tests. The RLS service marker is editable by authenticated users and `service_role` bypasses it; actual live FK/RLS and all deletion paths need review. No production schema change was made. |
| High | Client-only conflict checks permit concurrent devices to save overlapping bookings. | Proposed transaction-serialized trigger passed an isolated concurrent insert test and local REST rejection. It is not installed in production. Existing 13 historical overlap pairs are preserved. |
| Medium | ICS secret is in a query string and the feed exposes name, phone, notes, price. It may appear in request logs or calendar provider storage. | Keep the URL private; assess whether the feed can omit sensitive description fields and support scoped/revocable tokens. Do not publish or rotate the current token in this task. |
| Medium | `send-upcoming` accepts `CRON_SECRET` in a query parameter, which can be logged. | Move scheduler to an Authorization header after coordinating the external scheduler. |
| Medium | Initial production-tree audit flagged eight advisories, including `xlsx` and `next`. | Updated Next and ESLint config to 16.4.2 and replaced `xlsx` with `write-excel-file`; later `npm audit --omit=dev` reported zero production-tree findings. Five high development-tool findings remain in the Next ESLint chain (`braces`, `micromatch`, `fast-glob`). Lint, tests, TypeScript and Webpack build passed after final UI edits. |
| Medium | Browser `localStorage` contains working schedule, WhatsApp template, customer/booking cache, and queued writes. | Document retention and device-loss behavior; design secure sync. Browser access on a shared device remains a privacy consideration. |
| Medium | Preview environment isolation is unverified; connected Vercel project/env reads returned 403 for the project team scope. | Obtain correct read scope or complete the matrix in [VERCEL_ISOLATION_REVIEW.md](VERCEL_ISOLATION_REVIEW.md) before any push or preview. |

No secrets, feed URL, customer names, or phone numbers are included in this report. No production secrets or RLS policies were changed. Local Supabase Auth/REST exercised synthetic data only. This review does not establish live security configuration or Vercel environment isolation. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
