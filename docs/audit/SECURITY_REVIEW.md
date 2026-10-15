# Security review

## Verified controls

The browser Supabase client uses a publishable key (`src/lib/supabase.ts`). Server handlers obtain service-role access through `src/lib/push-server.ts`. The `solash-backups` bucket is marked private, and anonymous download of the new snapshot was denied. Backup GET checks `CRON_SECRET`; POST checks a Supabase user token. The ICS feed checks `CALENDAR_FEED_TOKEN` and returns `Cache-Control: private, no-store`. The service worker does not cache client records.

## Findings and action

| Severity | Finding | Action |
| --- | --- | --- |
| High | Repository RLS SQL grants all authenticated users full customer/booking access. Live policy state and auth user list were not inspected. | Inspect live policies/grants and define an administrator authorization rule. Production policy changes require approval. |
| High | Push subscribe/unsubscribe used service-role writes without authentication. | Fixed in development branch with bearer-token verification and client token forwarding. Integration test with non-production auth still needed. |
| High | `clients` deletion cascades to appointments in repository schema. | Development UI guards known history; live FK behavior and other API clients still need a database-level solution with approval. |
| Medium | ICS secret is in a query string and the feed exposes name, phone, notes, price. It may appear in request logs or calendar provider storage. | Keep the URL private; assess whether the feed can omit sensitive description fields and support scoped/revocable tokens. Do not publish or rotate the current token in this task. |
| Medium | `send-upcoming` accepts `CRON_SECRET` in a query parameter, which can be logged. | Move scheduler to an Authorization header after coordinating the external scheduler. |
| Medium | `xlsx` and `next` are among packages flagged by `npm audit`; direct and transitive advisories require applicability review. | Update in a separate tested branch/commit. No silent dependency replacement. |
| Medium | Browser `localStorage` contains working schedule, WhatsApp template, customer/booking cache, and queued writes. | Document retention and device-loss behavior; design secure sync. Browser access on a shared device remains a privacy consideration. |
| Medium | Preview environment data isolation is unverified. | Verify Vercel variables and branch deployment rules before any push or preview release. Never run state-changing tests against production. |

No secrets, feed URL, customer names, or phone numbers are included in this report. No production secrets or RLS policies were changed. This source review does not establish live security configuration.
