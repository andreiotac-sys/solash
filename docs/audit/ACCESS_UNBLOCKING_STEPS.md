# Accesul rămas: pași pentru proprietar

16.10.2026. Verificare punctuală, fără repetarea auditului și fără modificări de producție. [Dovezi redactate](evidence/blocker-access-followup-20261016.json).

## 1. Backup nativ Supabase

Conexiunea actuală poate citi proiectul `vholwdtqcrkohydydmnb`, dar nu expune o unealtă de listare a backupurilor native. Nu există PAT Management API sau conexiune PostgreSQL configurată pentru dump. Cheia REST/service-role nu înlocuiește aceste acreditări. Nu am trimis un request de inventar cu o acreditare nepotrivită. Existența și restaurabilitatea unui backup nativ rămân **necunoscute**; accesul SQL la proiect nu dovedește acces la inventarul platformei.

### Ce faci în Dashboard, numai citire

1. Deschide [proiectul → Database → Backups](https://supabase.com/dashboard/project/vholwdtqcrkohydydmnb/database/backups). Verifică ref-ul din URL, nu doar numele proiectului.
2. În **Scheduled**, notează planul/bannerul afișat, dacă există puncte de backup, tipul, starea și data UTC a celui mai recent punct reușit. În **Point in Time**, notează dacă este activ și intervalul recuperabil. Dacă tabul nu este disponibil, notează exact mesajul de permisiune/plan.
3. Trimite numai aceste metadate sau o captură decupată. Nu apăsa **Restore**, **Start a restore**, activare PITR ori upgrade. Nu presupune că un backup fizic are buton Download.
4. Confirmarea utilă: „ref=…, plan=…, Scheduled=disponibil/indisponibil, ultimul punct reușit UTC=…, PITR=…”. Aceasta închide verificarea inventarului, nu proba restaurării.

Planul Free a fost confirmat anterior. Documentația oferă backupuri zilnice accesibile pe planurile plătite și recomandă exporturi externe pentru Free; nu deducem din plan că nu există copii fizice interne. [Supabase Backups](https://supabase.com/docs/guides/platform/backups).

### Dacă inventarul nu este disponibil

- Pentru o citire programatică, proprietarul poate folosi un PAT autorizat cu `GET /v1/projects/vholwdtqcrkohydydmnb/database/backups`. Conectorul curent nu permite această operație. Nu publica PAT-ul în chat și nu acorda acces larg doar pentru această listă; citirea manuală de mai sus este suficientă pentru inventar.
- Pentru backup logic nativ: în proiect apasă **Connect**, selectează **Direct connection** sau **Session pooler** dacă rețeaua nu suportă IPv6. Nu folosi Transaction pooler pentru acest flux. Configurează local conexiunea aprobată și parola existentă într-un libpq service/password file privat, 0600, cu TLS verificat. Nu reseta parola bazei pentru acest audit. Dacă parola nu este disponibilă, oprește-te și alege cu proprietarul ruta de backup.
- După acces urmează [procedura deja pregătită](NATIVE_BACKUP_RUNBOOK.md): dump PostgreSQL 17 complet fără filtre, roluri, hashuri, Storage separat și restaurare într-o destinație izolată. Upgrade-ul, costul clonei și restaurarea datelor reale se aprobă separat. Snapshotul de șapte tabele rămâne o copie limitată.

[Conexiuni suportate](https://supabase.com/docs/guides/database/connecting-to-postgres). Nu este necesară o nouă migrare pentru a verifica inventarul.

## 2. Diagnosticul Vercel 403

| Element verificat | Rezultat |
| --- | --- |
| Identitatea conectorului | `andreiotac-sys`, user ID `6zJobtROcPr3n6idqeZsd0uj` |
| Echipe vizibile prin conexiune | 0 |
| Echipa țintă | `andreiotac-sys-projects`, ID `team_ks9AvByOp9QSxzsQVDuQHdtz` |
| Proiect | `solash`, ID `prj_GZ5wCC5zUCTvpYMKK3EnZGEx9s1m` |
| Citire echipă și proiect cu scope explicit | 403 `forbidden`: token/conexiune fără acces efectiv la acest scope |
| SSO/SAML în răspuns | `saml=false`, `ssoEnforced=false` |
| Fallback CLI | CLI și acreditări CLI indisponibile |

Este o eroare de autorizare a API-ului, nu Deployment Protection pe pagina aplicației. Nu se rezolvă prin bypass URL. Răspunsul nu expune granturile OAuth ori membershipul real: **nu putem identifica onest un singur rol lipsă**. Trebuie verificate identitatea, membershipul și consimțământul pentru echipă/proiect. Listarea anterioară a proiectului nu dovedește acces la setări.

### Pașii de acces minim

1. În Vercel, autentifică-te cu contul care deține SoLash. Din selectorul de echipă alege **andreiotac-sys-projects**, apoi proiectul **solash**. În **Settings → General**, verifică ID-ul proiectului. Dacă echipa nu apare, verifică contul folosit; nu crea alt proiect.
2. Pentru un cont separat de audit, proprietarul deschide **Team Settings → Members → Invite** și alege **Viewer** pe Pro, dacă planul îl oferă. Pe Enterprise se poate limita la Contributor cu **Project Viewer**: proiect → **Access → Project Access** → contul invitat → Project Viewer. Invitația trebuie acceptată. Nu retrograda contul proprietarului existent și nu acorda Developer/Member/Owner ca soluție de audit. Dacă planul nu oferă rolul necesar, folosește verificarea manuală de mai jos; upgrade-ul nu este autorizat. [Roluri și pași](https://vercel.com/docs/rbac/managing-team-members), [limitele Viewer](https://vercel.com/docs/rbac/access-roles).
3. Dacă această conexiune apare în **Integrations** ale echipei: **Manage → Access → Manage Access**, verifică dacă `solash` este inclus. Selectarea proiectului este o autorizare de acces, nu o schimbare a variabilelor aplicației. Nu instala altă integrare dacă nu apare. [Pașii oficiali](https://vercel.com/docs/integrations/install-an-integration/manage-integrations-reference).
4. Reautorizează conexiunea existentă cu identitatea corectă și echipa/proiectul de mai sus, dacă dialogul permite selecția. Capacitățile necesare sunt **Team: Read Only**, **Projects: Read Only**, **Deployments: Read Only**, **Production Environment Variables: Read Only** și **Non-Production Environment Variables: Read Only**. Nu sunt necesare permisiuni de deploy, editare variabile, bypass sau Team Members write. Acestea sunt capabilitățile necesare, nu o afirmație că toate lipsesc acum. Scopurile oferite sunt controlate de aplicația OAuth: dacă dialogul nu oferă citirile necesare, simpla reconectare nu le adaugă. Nu selecta **All Environment Variables: Read and Write** pentru a compensa. [Permisiuni oficiale](https://vercel.com/docs/sign-in-with-vercel/scopes-and-permissions).
5. Confirmă aici „contul…, echipa…, proiectul…, accesul Viewer/consimțământul verificat”. Eu verific apoi doar citirea proiectului și metadatele env cu `decrypt=false`. Criteriul este răspuns 200 pentru ID-ul așteptat și citirea scopurilor, nu doar dispariția unei pagini de login. Un token limitat pe proiect poate avea vizibilitate redusă asupra echipei; nu cerem drepturi de scriere pentru a face lista echipelor să apară.

### Alternativa fără extinderea accesului

Proprietarul deschide **solash → Settings → Environment Variables** și notează numai nume, medii, override-uri de ramură și sursa shared/integration, fără valori. Verifică Production separat de Preview/custom; confirmă privat că URL/key/service-role Preview aparțin altui proiect Supabase. Verifică în **Settings → Git** ramura Production și în **Deployments** commitul și mediul deploymentului activ. Completează [matricea existentă](VERCEL_ISOLATION_REVIEW.md). Pro Viewer nu garantează acces la toate setările echipei; o dovadă manuală a proprietarului este preferabilă unui rol mai puternic. Nu salva schimbări și nu folosi `env pull` pentru această verificare.
