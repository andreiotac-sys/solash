# SoLash

Aplicatie Next.js pentru programari (gene), clienti, servicii si reminder-e.

## Rulare locala

1. Copiaza `.env.example` in `.env.local`.
2. Completeaza variabilele de Supabase.
3. Ruleaza:

```bash
npm install
npm run dev
```

Deschide `http://localhost:3000`.

## Push notifications (iPhone / PWA)

Sunt necesare:

- app instalata pe iPhone (Add to Home Screen),
- permisiune de notificari acordata din aplicatie,
- chei VAPID si `SUPABASE_SERVICE_ROLE_KEY`,
- cron pe Vercel.

### Variabile de mediu

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@solash.app
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

### Tabele Supabase

Ruleaza `supabase/schema.sql` (contine si tabelele `push_subscriptions` + `push_notification_runs`).

### Cron reminder

`vercel.json` ruleaza endpoint-ul `/api/push/send-reminders` la fiecare 30 minute.
Endpoint-ul trimite reminder doar in fereastra 20:30-20:59 `Europe/Bucharest` si evita dublurile in aceeasi zi.

## Reminder cu 15-20 minute inainte (Hobby + scheduler extern)

Endpoint:

`/api/push/send-upcoming?key=CRON_SECRET`

Ruleaza la fiecare 5 minute dintr-un scheduler extern (ex. cron-job.org).
Trimite notificari cu numele clientelor care urmeaza in 15-20 minute si evita duplicatele.
