# SoLash — GO / NO-GO cu dovezi

**Decizie la 16.10.2026: NO-GO pentru lansare.** Compatibilitatea schemei reale este acum verificată, dar lipsesc dovada restaurării unui backup nativ complet, izolarea Vercel și probele iPhone/PWA. Aprobarea execuției nu este cerută sau presupusă în această etapă.

**Continuarea punctuală:** [planul proprietarului](OWNER_ACTION_PLAN.md) include pașii UI și confirmările necesare. GET Auth settings a confirmat înscrierea activată; autorizarea explicită este acum un blocaj confirmat, nu doar o setare necunoscută. [Dovezi noi](evidence/blocker-access-followup-20261016.json). Nicio schimbare locală nu este declarată live.

Codul și dovezile acestei continuări sunt în commitul local `16b3769338328c36d1d0211d66ef13c6631c6871`, după `d2f86cef1eaf4dc91578722bf67e606bb5fb68c5`. Commitul ulterior conține documentația; identificați-l prin `git log -1` și fixați întregul SHA candidat înaintea aprobării. Hashurile celor trei migrări sunt în [manifestul testelor](evidence/migration-validation-20261016.json). Mediul Docker temporar a fost oprit și serverul Safari local închis după probe.

| Gate | Stare | Dovadă / ce mai lipsește |
| --- | --- | --- |
| Baza și istoricul Git păstrate | PASS | Tag `solash-production-baseline-20261015`, SHA `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058`; commiturile existente nu au fost rescrise. Se verifică deploymentul activ din nou înainte de lansare. |
| Snapshotul anterior păstrat | PASS, limitat | Hashul și restaurarea a șapte tabele rămân în [raportul anterior](DATABASE_BACKUP_AND_RECOVERY.md). Nu este backup nativ; numărătoarea live este acum cu cinci programări mai mare, deci snapshotul nu dovedește starea actuală. |
| Catalog real și compatibilitate trei migrări | PASS la citire | [Catalog](evidence/production-schema-20261016.json), [analiză](PRODUCTION_SCHEMA_COMPATIBILITY.md): PostgreSQL 17.6, FK/RLS/coloane compatibile, zero durate invalide sau overnight, 13 perechi istorice păstrate. Recheck imediat înainte de aplicare. |
| Teste pe versiunea PostgreSQL reală | PASS, limitat | [PG17.6](evidence/migration-validation-20261016.json): schema publică reconstruită, test de cursă la instalare, rollback complet, lockuri măsurate, 17/17 runtime. Nu este restaurare de proiect complet. |
| Risc de blocare / ordinea de instalare | REVIEW pregătit | [Runbook](PRODUCTION_DEPLOYMENT_RUNBOOK.md): atomică → FK → RLS, fără db push; AccessExclusive temporar inclusiv pe clients la FK. Necesită fereastră și aprobare. |
| Inventar backup nativ administrat | BLOCKED | Plan Free confirmat; inventar nerecuperat prin toolset. Existența/datele unui punct nativ nu sunt confirmate. [Pași exacți](NATIVE_BACKUP_RUNBOOK.md). |
| Backup nativ complet restaurat | BLOCKED | Sunt necesare conexiune de backup sau punct administrat accesibil, copie nativă, restaurare izolată, comparație completă și timpi măsurați. Storage și configurația proiectului se verifică separat. |
| Vercel Preview izolat de producție | BLOCKED | Proiect identificat; setările și env metadata au returnat 403 pentru `andreiotac-sys-projects`. [Matricea de verificat](VERCEL_ISOLATION_REVIEW.md). Nicio valoare secretă nu a fost decriptată. |
| Safari real pe Mac și layout responsive | PASS, limitat | [Verificare](SAFARI_PWA_VALIDATION.md): 375/430 px, creare/editare/reprogramare/anulare și calendar cu date locale. |
| Persistență cache și revenire UI | PASS local | Defectul de inițializare a cache-ului corectat; reload păstrează datele. Flag=false afișează frontendul vechi; buildul nou true se încarcă după refresh pe același origin. |
| iPhone fizic / PWA instalată / touch / offline autentificat | MANUAL REQUIRED | Nu a fost disponibil iPhone; instalarea, actualizarea, safe areas, tastatura, long-press/drag, background și coada offline necesită proba pe mediu izolat. |
| Auth, privilege minime și service-role | BLOCKED | GET Auth settings: înscriere activată, email cu confirmare, anonymous sign-ins dezactivate. RLS live larg; numărul de utilizatori din audit este datat. TRUNCATE/TRIGGER acordate anon/authenticated, fără login SQL direct/RPC public observat. [Propunere minimă neaplicată](AUTHORIZATION_MINIMAL_PROPOSAL.md): signup administrativ, UUID autorizat în RLS/rute server, revocare TRUNCATE/TRIGGER. |
| Fluxuri autentificate și backup XLSX | PASS anterior, limitat | [Teste](TEST_RESULTS.md): Supabase local cu date sintetice, 401/200 la backup și SHA descărcat egal. Nu au fost reluate fără motiv; cronul live rămâne smoke-test ulterior aprobat. |
| Verificări cod după schimbarea cache-ului | PASS | Lint, 22 teste Node și build Webpack cu TypeScript, cu Supabase dezactivat pentru proba Safari. Aceste verificări nu decid singure GO. |
| Aprobări de producție | NOT GRANTED | Migrări, configurație, push/merge, deployment, promovare și probe care scriu în producție necesită aprobări explicite, distincte. |

## Ce revine proprietarului

1. Asigură un punct nativ accesibil sau conexiunea securizată necesară backupului; aprobă costul unei clone cloud dacă aceasta este aleasă și participă la validarea restaurării.
2. Oferă acces de citire la scope-ul Vercel al proiectului ori verifică manual scopurile/override-urile/artefactele; aprobă separat modificările necesare pentru izolare.
3. Rulează matricea iPhone/PWA în mediul izolat și verifică setările locale și operațiile offline ale dispozitivului real. Revizuiește conturile Auth, signup și privilegiile largi.
4. După închiderea gate-urilor, aprobă exact candidatul și cele trei fișiere/hashuri în fereastra de mentenanță; apoi aprobă separat pașii de lansare și eventualele scrieri de smoke-test. Până atunci verdictul rămâne NO-GO.
