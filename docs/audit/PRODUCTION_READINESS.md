# SoLash — evaluarea pregătirii pentru producție

**Pașii rămași pentru proprietar:** [OWNER_ACTION_PLAN.md](OWNER_ACTION_PLAN.md). Verificarea punctuală ulterioară confirmă înscrierea Auth activată, fără a crea conturi; autorizarea administratorilor este un blocaj explicit. Accesul la backupurile native și la scope-ul Vercel nu este încă suficient. Testarea iPhone pe aplicația publicată are o listă separată, fără presupunerea că schimbările locale sunt live.

**Continuare, 16.10.2026:** schema reală a fost acum verificată prin SELECT. Compatibilitatea celor trei migrări este confirmată la momentul citirii; testele noi pe PostgreSQL 17.6 au trecut. Safari real pe Mac, cache-ul local și revenirea UI au fost testate, iar suprascrierea cache-ului la inițializare a fost corectată. Backupul nativ complet, izolarea Vercel și iPhone/PWA rămân gate-uri deschise. Integrarea Vercel identifică proiectul, dar refuză setările/env metadata cu 403. [Checklistul actual](GO_NO_GO_CHECKLIST.md), [compatibilitatea exactă](PRODUCTION_SCHEMA_COMPATIBILITY.md) și [runbookul neexecutat](PRODUCTION_DEPLOYMENT_RUNBOOK.md) actualizează dovezile istorice de mai jos.

**Situație la 16 octombrie 2026. Verdict: SoLash nu este încă pregătit pentru o lansare controlată în producție.** Modificările de pe `audit/solash-safe-improvements` au fost dezvoltate și testate fără schimbări ale rândurilor din tabelele aplicației, schemei sau deploymentului de producție. Un obiect privat cu snapshotul verificat a fost creat în Storage. Testele locale dovedesc recuperarea datelor din cele șapte tabele cunoscute și comportamentul propus al protecțiilor SQL; nu dovedesc recuperarea întregului proiect Supabase sau siguranța configurației Vercel.

## Baza păstrată și evidența codului

Continuarea cu schema live, proba PG17.6, lockul de instalare și corecția cache-ului Safari: `16b3769338328c36d1d0211d66ef13c6631c6871`. Documentația de lansare este într-un commit local ulterior. Lista de mai jos păstrează identificatorii etapei precedente; verdictul curent și dovezile sunt în [GO_NO_GO_CHECKLIST.md](GO_NO_GO_CHECKLIST.md).

| Element | Identificator / stare |
| --- | --- |
| Ultimul deployment GitHub `Production` confirmat și `main` remote verificat la audit | `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058` |
| Eticheta locală adnotată a bazei de producție | `solash-production-baseline-20261015` |
| Ramura de dezvoltare | `audit/solash-safe-improvements` |
| Ultimul commit înaintea acestei etape | `66a93b2` (`Record final build and browser verification`) |
| Migrări propuse și teste SQL | `56262fc65f23c624c04d0ee6d1c715797d7260c9` |
| Dependențe, backup XLSX și build reproductibil | `a506bfda46e426b25690eea293b3ee9b7acae3bc` |
| Protecții în interfață și corecții calendar | `8d3a2f181ff1a30273d9ebc3f27776ae38d0c0e8` |
| Raport și dovezi de pregătire | `e3cd72be542b846b7c32655d728f291f87426c3f` |
| Versiuni Next fixate exact | `c871acd775541415a4993024f894138fc9334903` |

Ramura și cele opt commituri anterioare se păstrează integral. Intervalul exact al ramurii este `solash-production-baseline-20261015..HEAD`; `git log --reverse --format='%H %s' solash-production-baseline-20261015..HEAD` afișează toate SHA-urile, inclusiv commitul care salvează acest raport. Nu s-a făcut push la `main`, merge, deployment sau schimbare a schemei ori a rândurilor din tabelele aplicației de producție. Fișierele private deja existente, neînregistrate în Git, au rămas în afara modificărilor.

## Ce a fost verificat

### Copie de siguranță și restaurare

Instantaneul privat `solash-backups/verified/solash-known-tables-2026-10-15T16-41-04-387Z.json.gz` are SHA-256 `01ad4081e50a6a372274bda6d7d2fbe1849cc89e685478ce08653a829d56dc2a`. Descărcarea autorizată a fost comparată cu acest hash. Datele au fost restaurate într-un container PostgreSQL 16 de unică folosință, fără interfață de rețea și fără porturi publicate. Nu a existat conexiune de scriere la producție.

| Tabel cunoscut | Rânduri restaurate |
| --- | ---: |
| `clients` | 568 |
| `appointments` | 3.870 |
| `services` | 7 |
| `push_subscriptions` | 3 |
| `push_notification_runs` | 69 |
| `push_appointment_reminders` | 492 |
| `push_delivery_logs` | 566 |

Pentru fiecare rând s-au comparat toate câmpurile exportate cu valoarea restaurată, cu normalizarea reprezentării timestampurilor. Numărul de rânduri, unicitatea ID-urilor și relațiile cunoscute au corespuns. Au fost păstrate 1.848 de programări istorice de dinainte de 2025; intervalul de date din instantaneu este 30 ianuarie 2023–30 decembrie 2026. Snapshotul conține 13 perechi de programări active suprapuse pe 11 date. Acestea sunt date istorice existente, nu erori introduse de migrarea propusă.

Restaurarea a fost o **reconstrucție a tabelelor cunoscute**, nu o restaurare nativă a întregului proiect. Instantaneul este netranzacțional și nu conține DDL-ul real, secvențele, RLS, drepturile, trigger-ele, funcțiile, identitățile Auth, politicile și obiectele Storage sau setările din browser. Schema din repository diferă deja de datele observate: declară `appointments.notes`, câmp care lipsește din snapshot. Este necesar un backup nativ complet și o restaurare izolată a acestuia înainte de aprobarea unei migrări sau a lansării.

### Protecții pentru programări și istoric

Au fost pregătite, **fără executare în producție**, trei migrări:

1. [`20261015_atomic_booking_guard.sql`](../../supabase/migrations/20261015_atomic_booking_guard.sql) serializează scrierile pentru aceeași dată printr-un lock tranzacțional și respinge suprapunerile noi cu SQLSTATE `23P01`. Exclude statusul `Anulata`, include blocajele personale reprezentate ca programări, acceptă intervale alăturate și permite o excepție autorizată de program de lucru numai când nu există suprapunere reală. Păstrează suprapunerile istorice deja existente. Scrierile la un alt nivel de izolare decât `READ COMMITTED` eșuează controlat.
2. [`20261015_protect_client_history.sql`](../../supabase/migrations/20261015_protect_client_history.sql) verifică mai întâi existența FK-ului așteptat și propune schimbarea lui din `ON DELETE CASCADE` în `ON DELETE RESTRICT`. Astfel, un client cu istoric nu poate fi șters nici dacă toate programările sunt anulate.
3. [`20261015_protect_appointment_history.sql`](../../supabase/migrations/20261015_protect_appointment_history.sql) înlocuiește politica RLS largă de `DELETE` pentru utilizatorii autentificați cu una care permite numai ștergerea rândurilor marcate prin `service = 'Blocaj personal'`. Astfel pot fi eliminate blocajele personale fără ștergerea accidentală a programărilor clienților. Un utilizator rău intenționat cu drept de editare poate schimba acest marcaj înainte de ștergere, iar `service_role` poate ocoli RLS; protecția privește fluxurile obișnuite, nu un actor ostil.

Toate trei au fost aplicate numai în PostgreSQL-ul izolat și în stiva Supabase locală. Cele **17/17 verificări SQL** din [`db_guards_isolated.py`](../../tests/db_guards_isolated.py) au trecut, inclusiv două inserări concurente, limite la nivel de secunde, reactivarea unei programări anulate, blocaj personal, reprogramare, schimbarea statusului unei suprapuneri istorice și ștergerea unui client cu istoric activ sau anulat. Preflightul migrației de rezervare a respins o coloană `status` devenită nullable și, în testul versiunii SQL finale, un interval sintetic peste miezul nopții; tranzacția eșuată nu a lăsat funcții instalate. După eliminarea fixture-ului, versiunea finală a trecut din nou 17/17 teste într-un PostgreSQL fără rețea. FK-ul și politica RLS au respins reaplicarea pe schema deja protejată. Cereri REST autentificate către Supabase local au primit codurile așteptate `23P01` și `23503`; un `DELETE` autentificat al unei programări de client a afectat zero rânduri, iar eliminarea unui blocaj personal a fost permisă într-o tranzacție anulată după test. Aceste probe nu substituie inspectarea constrângerilor, politicilor și tuturor căilor de ștergere din schema reală.

### Aplicație, dependențe și interfață

- Actualizarea online eșuată a unei programări nu mai afișează succes și nu mai mută silențios operația în coada offline. Erorile de conflict din baza de date și durată invalidă sunt prezentate utilizatorului. Ștergerea unui client respinsă prin FK are un mesaj explicit.
- Rezervarea rapidă păstrează data selectată. Cardul următoarei programări afișează intervalul acelei programări. O rezervare autorizată în afara programului apare vizibil ca excepție în agenda zilei, inclusiv într-o zi liberă; acest defect a fost descoperit prin fluxul local autentificat.
- Fluxul autentificat cu utilizator și date sintetice în Supabase local a acoperit crearea și editarea unui client, crearea, editarea și anularea unei programări, navigarea calendarului pe luni, confirmarea unei rezervări în afara programului și afișarea ei în agenda zilei. Ștergerea clientului cu istoric a fost blocată. Când Supabase este configurat, UI nu mai oferă ștergerea directă a unei programări de client, dar păstrează ștergerea unui blocaj personal.
- Ruta locală autentificată de backup a respins cererea fără autentificare (`401`) și a acceptat cererea autorizată (`200`). Fișierul XLSX privat din Storage local a fost descărcat, hashul a corespuns și au fost verificate șapte foi. Testul nu dovedește rularea cronului Vercel sau recuperarea întregii scheme.
- La lățimi de 375, 390 și 430 CSS px, interfața demo nu a depășit viewportul; captura și navigarea de jos au fost inspectate. Controlul Safari a expirat, deci Safari real, iPhone fizic, instalare PWA și VoiceOver rămân netestate.
- `next` și `eslint-config-next` au fost actualizate la 16.4.2. `xlsx` a fost înlocuit cu `write-excel-file` pentru exportul local și cel din ruta de backup. Un test XLSX verifică peste limita veche de 1.000 de rânduri. `npm audit --omit=dev` raportează zero avertismente pentru arborele de producție; auditul complet mai raportează **cinci high** în lanțul de dezvoltare Next ESLint (`braces`, `micromatch`, `fast-glob`). După ultimele schimbări UI au trecut `npm run lint`, 22 de teste Node, `npx tsc --noEmit` și `npm run build` cu ambele valori ale comutatorului UI. Scriptul `build` folosește explicit Webpack: Turbopack a trecut o dată, dar a eșuat apoi intermitent în sandbox când procesorul CSS nu a putut deschide un port local. Patru reguli noi ale compilatorului React au fost dezactivate numai pentru componenta mare preexistentă `src/app/page.tsx`; această datorie tehnică trebuie revizuită separat.

## Blocaje de lansare

| Prioritate | Cerință încă nedovedită / risc | Următorul pas verificabil |
| --- | --- | --- |
| Blocant | Backupul verificat acoperă numai șapte tabele publice și nu este un dump nativ; schema reală și Auth/RLS/Storage nu au fost restaurate. | Obțineți backup nativ complet și repetați restaurarea într-un proiect Supabase izolat, inclusiv login, politici și Storage. Comparați obiectele din `pg_catalog` cu migrările. |
| Blocant | Vercel identifică proiectul, dar setările și env metadata au returnat 403 pentru scope-ul echipei. Izolarea Production/Preview nu este dovedită. | Oferiți accesul de citire corect ori verificați manual [matricea Vercel](VERCEL_ISOLATION_REVIEW.md) înainte de orice push. |
| Gate de execuție | Cele trei migrări sunt structural compatibile cu schema reală observată și au trecut pe PG17.6. Nu sunt aplicate în producție; restaurarea nativă fidelă și aprobarea sunt încă necesare. | Revizuiți [raportul exact](PRODUCTION_SCHEMA_COMPATIBILITY.md), refaceți preflightul în fereastră și aplicați numai în ordinea aprobată. |
| Important | Safari pe Mac a trecut verificările locale; iPhone/PWA instalată, reconectarea autentificată, drag/long-press, push și ICS nu sunt încheiate. | Efectuați [matricea manuală](SAFARI_PWA_VALIDATION.md) cu date izolate; păstrați setările și operațiile dispozitivului real. |
| Important | RLS live și privilegiile largi sunt confirmate; în Auth există un utilizator. Signup nu a fost inspectat. | Revizuiți TRUNCATE/TRIGGER și autorizarea; protecțiile propuse nu împiedică service-role sau un editor ostil. |
| Important | Rutele ICS și unele citiri push nu sunt paginate; ICS pune un token în URL și include date sensibile. | Revizuiți paginarea, minimizarea datelor și distribuirea tokenului înainte de lansare. |

## Aprobări necesare și plan de revenire

Lucrul pe ramură și testele izolate sunt autorizate. **Este necesară aprobarea explicită a proprietarului** pentru executarea oricărei migrări sau schimbări de politică pe Supabase de producție, pentru o restaurare/îmbinare a datelor reale și pentru deploymentul sau promovarea în producție. Nu se va presupune că aprobarea unei versiuni de cod autorizează automat și schimbarea schemei.

- Interfață: `NEXT_PUBLIC_SOLASH_NEW_UI=false` la build revine la aspectul anterior al paginii principale; este necesar un build nou. Logica comună și datele rămân aceleași.
- Deployment: după o lansare aprobată, se poate promova ultimul deployment de producție confirmat, pornind de la SHA-ul de bază de mai sus, după verificarea commitului și a variabilelor de mediu. Revenirea Vercel nu inversează scrierile sau schema din Supabase.
- Guard SQL: într-un mediu verificat, triggerul și funcțiile se pot elimina în ordinea de mai jos, conform [`README.md`](../../supabase/migrations/README.md). Aceasta îndepărtează protecția împotriva rezervărilor duble; un rollback în producție necesită analiză și aprobare, nu execuție automată.
- Istoricul clienților și programărilor: revenirea de la `RESTRICT` la `CASCADE` sau restaurarea politicii RLS largi de `DELETE` ar reintroduce pierderea istoricului; niciuna nu este o procedură standard de rollback. Pentru recuperarea datelor, faceți un backup nativ proaspăt, restaurați în izolare, comparați ID-uri și timestampuri și păstrați programările create după punctul de recuperare. Nu încărcați instantaneul datat peste producție.

```sql
begin;
drop trigger solash_prevent_booking_overlap_trigger on public.appointments;
drop function public.solash_prevent_booking_overlap();
drop function public.solash_guard_duration_minutes(text);
commit;
```

Aplicarea fiecărei migrări este învelită într-o tranzacție; un eșec în timpul aplicării cere verificarea tranzacției și a stării schemei înainte de orice altă acțiune. Pentru migrările de protecție a istoricului, remedierea preferată după rollout este corectarea aplicației sau îngustarea politicii, păstrând `RESTRICT`, nu revenirea automată la `CASCADE` ori la `DELETE` larg. [MIGRATION_READINESS.md](MIGRATION_READINESS.md) conține inversările SQL exacte și limitele lor.

Vezi [DATABASE_BACKUP_AND_RECOVERY.md](DATABASE_BACKUP_AND_RECOVERY.md), [TEST_RESULTS.md](TEST_RESULTS.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) și [ROLLBACK_PLAN.md](ROLLBACK_PLAN.md) pentru evidența detaliată. Verdictul rămâne **nepregătit pentru lansare controlată** până la închiderea blocajelor și aprobările explicite.
