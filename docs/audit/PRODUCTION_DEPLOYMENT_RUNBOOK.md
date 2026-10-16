# SoLash — runbook de lansare controlată

**Stare: pregătit pentru revizie; nicio etapă de producție nu este autorizată prin acest document.** La 16.10.2026 verdictul este NO-GO, conform [checklistului](GO_NO_GO_CHECKLIST.md). Comenzile de schimbare de mai jos sunt instrucțiuni pentru o execuție viitoare, după aprobările explicite; nu au fost rulate.

## 1. Identitate, responsabil și aprobări

Proprietarul desemnează operatorul, intervalul de mentenanță și persoana care decide oprirea lansării. Sursa este ramura `audit/solash-safe-improvements`. Se fixează SHA-ul candidatului aprobat prin `git rev-parse HEAD`, fișierele de migrare și SHA-256-urile lor. Baza istorică de producție este `1a8d8b37dbb3da62a3aaddd3f2b48bbb1ceb9058`, tag `solash-production-baseline-20261015`; înainte de lansare se verifică și deploymentul activ real, care ar putea fi mai nou.

Destinații care trebuie potrivite explicit:

- Supabase producție: `vholwdtqcrkohydydmnb`; PostgreSQL observat 17.6.
- Vercel: `solash`, proiect `prj_GZ5wCC5zUCTvpYMKK3EnZGEx9s1m`, echipă `team_ks9AvByOp9QSxzsQVDuQHdtz`, scope `andreiotac-sys-projects`.
- Clona de test: proiect/container distinct, fără acreditări, utilizatori sau subscripții push de producție în buildul Preview.

Se aprobă separat: crearea/restaurarea unui backup nativ și eventualul cost al clonei cloud; schimbările necesare de configurare Vercel; cele trei migrări exacte; push/merge dacă sunt alese; deploymentul țintă Production; promovarea domeniului; orice scriere sintetică de smoke-test în producție. Niciuna nu este implicită prin aprobarea altei etape.

## 2. Gate înainte de orice push sau deployment

1. Închideți blocajele din [GO_NO_GO_CHECKLIST.md](GO_NO_GO_CHECKLIST.md). În special, demonstrați [izolarea Vercel](VERCEL_ISOLATION_REVIEW.md): niciun Preview, override de ramură, mediu custom sau secret comun nu trebuie să folosească Supabase de producție. Un push poate declanșa deployment automat.
2. Obțineți și restaurați un backup nativ după [procedura dedicată](NATIVE_BACKUP_RUNBOOK.md). Păstrați snapshotul anterior, fără a-l considera complet sau actual. Arhivați privat hashuri, dată/punct de recuperare, rezultatul restaurării, timpi și limite de pierdere a datelor.
3. Reproduceți schema completă într-o clonă Supabase fidelă, inclusiv Auth, politici, granturi, Storage și extensii. Testul PG17.6 cu schema publică reconstruită a trecut, dar nu înlocuiește această restaurare. Dezactivați ieșirile clonei către dispozitive reale și schedulere.
4. Testați candidatul autentificat pe clonă: clientă nouă/editare, rezervare/editare/reprogramare/anulare/reactivare, blocaj personal și eliminarea lui, override de program, calendar, backup privat, coadă offline și reconectare. Parcurgeți matricea [Safari/PWA](SAFARI_PWA_VALIDATION.md) pe iPhone fizic.
5. Verificați că buildul și controalele obligatorii trec pentru SHA-ul candidatului; nu reluați audituri fără schimbări relevante. Interfața false trebuie probată pe același candidat. Revizuiți explicit cele cinci avize de dezvoltare rămase și autorizarea conturilor Auth/privilegiile SQL largi.

## 3. Backup și preflight imediat înainte de migrare

1. Coordonarea tuturor dispozitivelor: salvați/exportați operațiile offline și setările locale înainte de refresh. Nu goliți localStorage, nu ștergeți cozi și nu dezinstalați PWA pentru a forța actualizarea. Închideți taburile vechi și opriți temporar scrierile aplicației printr-o procedură de mentenanță aprobată.
2. Luați un backup nativ proaspăt și confirmați integritatea lui. Nu rulați simultan dumpul și DDL-ul de migrare; lockurile lor se pot bloca reciproc. Păstrați și o situație de control a numărătorilor, ID-urilor, relațiilor și istoricului la începutul ferestrei. Valoarea observată de 3.875 de programări este datată, nu un prag fix pentru o lansare viitoare.
3. Rulați [pachetul SELECT-only](../../supabase/inspection/production_catalog_readonly.sql) cu o conexiune verificată și `psql -X --set ON_ERROR_STOP=1`. Verificați raportul [de compatibilitate](PRODUCTION_SCHEMA_COMPATIBILITY.md), fără a executa fișierele de migrare ca „test” pe sursă.
4. Confirmați: tipurile/NOT NULL, proprietarii, exact FK-ul CASCADE așteptat, exact politica DELETE așteptată și lipsa unei politici ALL suplimentare, rolul authenticated fără bypass/privilegii moștenite de proprietar, durate valide, fără intervale active peste miezul nopții, fără orfani și fără nume de funcții/trigger deja folosite. Cele 13 suprapuneri existente nu se șterg pentru a face preflightul să treacă.
5. Operatorul verifică tranzacțiile și lockurile în așteptare. Nicio tranzacție veche sau import/cleanup nu trebuie să ruleze în fereastra DDL. Stabiliți un buget scurt de așteptare: fișierele au lock_timeout 5s; pentru sesiunea de instalare folosiți un statement_timeout revizuit, de exemplu 30s. La depășire se oprește lansarea, fără retry automat.

## 4. Ordinea exactă a migrărilor, după aprobare

**Nu folosiți `supabase db push`, globuri sau ordinea alfabetică.** Cele trei fișiere au prefix de versiune identic și nu există istoric CLI live. Aplicați explicit câte un fișier prin psql, cu ON_ERROR_STOP, folosind propriul BEGIN/COMMIT al fișierului, nu un wrapper care le combină sau ignoră erorile.

| Ordine | Fișier | Condiție pentru următorul pas |
| --- | --- | --- |
| 1 | `supabase/migrations/20261015_atomic_booking_guard.sql` | Funcțiile și triggerul există în forma aprobată; scanarea s-a încheiat fără erori. Rândurile istorice nu s-au schimbat. |
| 2 | `supabase/migrations/20261015_protect_client_history.sql` | FK-ul este validat, ON DELETE RESTRICT, celelalte acțiuni și coloane sunt aceleași. |
| 3 | `supabase/migrations/20261015_protect_appointment_history.sql` | Politica DELETE largă a dispărut, politica pentru blocaje personale există, celelalte politici sunt păstrate. |

Exemplu de comandă pentru **un** fișier, numai după configurarea și verificarea service-ului de conexiune aprobat:

```bash
PGSERVICE=solash_production_change_approved \
PGOPTIONS='-c statement_timeout=30000' \
  psql -X --set ON_ERROR_STOP=1 \
  --file=supabase/migrations/20261015_atomic_booking_guard.sql
```

Repetați separat cu fișierul 2, apoi cu fișierul 3, numai după citirea rezultatului anterior. Nu executați `schema.sql`, `rls.sql`, seeduri sau scripturi de import/cleanup pe producție. Migrarea FK poate bloca citirile și scrierile în **clients și appointments**, iar RLS poate bloca appointments; NOT VALID nu face această operație online. [Lockuri măsurate și hashuri](evidence/migration-validation-20261016.json).

După fiecare COMMIT, recitiți definițiile prin catalog, comparați numărătorile și relațiile cu situația de control, înregistrați hashul fișierului și rezultatul. Orice diferență neexplicată oprește secvența. Păstrați protecțiile deja instalate până la o decizie revizuită.

## 5. Deploymentul candidatului aprobat

1. Numai după aprobarea deploymentului: lucrați dintr-un checkout curat al SHA-ului fixat, excluzând fișiere private, exporturi și `.env.local`. Confirmați repositoryul, proiectul și echipa înainte de orice `vercel link` ori comandă de deploy.
2. Verificați valorile Production fără a le afișa în loguri: Supabase live, cheile serverului, CRON_SECRET, cheile push/ICS necesare și flagul UI dorit. Un artefact construit cu valorile Preview nu se promovează ca artefact de producție. `NEXT_PUBLIC_SOLASH_NEW_UI=false` necesită build nou.
3. După confirmarea suportului în CLI-ul folosit, un deployment Production fără mutarea domeniului poate fi pregătit astfel:

```bash
vercel --scope andreiotac-sys-projects deploy --prod --skip-domain
```

`--skip-domain` amână atribuirea domeniilor; nu transformă deploymentul într-un mediu izolat. El folosește configurația Production, deci smoke-testele nu trebuie să trimită scrieri reale fără aprobarea lor separată. Înregistrați ID-ul, URL-ul privat de lucru, SHA-ul și configurația de build. [Comanda oficială](https://vercel.com/docs/cli/deploy).
4. Faceți smoke-testele permise de mai jos, verificați logurile fără PII și comparați din nou schema/datele. Promovați numai **deploymentul Production** verificat, prin procedura Vercel aprobată, de exemplu `vercel --scope andreiotac-sys-projects promote <ID-ul-verificat>`. Aceasta este o acțiune de producție care necesită aprobare.
5. Verificați domeniul și commitul activ după promovare, nu doar succesul buildului. Reactivați operațiile în ordinea aprobată și urmăriți erorile de booking, autentificare și backup. Cronurile declarate sunt 17:30 și 17:40 UTC; confirmați separat configurația efectivă și ora locală în sezonul lansării.

## 6. Smoke-test, rezervări duble și istoricul clientelor

În clonă, înaintea lansării: două sesiuni autentificate pornesc simultan rezervări suprapuse pentru aceeași dată; exact una trebuie să reușească, cealaltă să primească 23P01 și un mesaj clar. Repetați reprogramarea, blocajul personal, intervale alăturate, anularea și reactivarea; override-ul orelor nu trebuie să ocolească un conflict. O clientă cu istoric activ ori anulat nu trebuie ștearsă (23503), DELETE direct de programare trebuie să afecteze zero rânduri pentru authenticated, iar blocajul personal trebuie să poată fi eliminat.

Pe producție, fără aprobarea scrierilor, verificați numai: login autorizat, încărcarea clientelor/programărilor și istoricului cunoscut, navigarea calendarului, manifest/iconuri, schema/triggerul/FK/RLS și loguri. Verificați istoricul pe ID-uri într-un mediu privat, fără a le publica. Nu folosiți o clientă reală pentru a testa ștergerea și nu generați mesaje WhatsApp/push de probă către cliente.

Dacă proprietarul aprobă expres probe de scriere în producție, se definește înainte clienta sintetică, intervalul neutilizat, dispozitivele și oprirea probelor la prima eroare. Se testează cursa pe acel interval și se anulează programarea reușită, păstrând auditul; nu se șterge istoricul pentru „curățenie”. Backupul manual/cron scrie și el în Storage și necesită autorizarea acestei probe. Succesul se confirmă prin descărcare și checksum, nu doar toast.

## 7. Eșec de migrare și revenire

| Eșec | Acțiune sigură |
| --- | --- |
| Lock timeout 55P03 / statement timeout 57014 | Opriți secvența. Lăsați conexiunea eșuată să închidă tranzacția, reconectați read-only și verificați starea. Reprogramați fereastra; nu măriți timeoutul în buclă. |
| Preflight / nume existent / DDL diferit | Nu folosiți DROP IF EXISTS și nu săriți verificarea. Comparați catalogul cu aprobarea și actualizați propunerea pe clonă. |
| Validarea FK eșuează / orfani | Nu ștergeți rânduri pentru a forța validarea. Păstrați backupul, identificați cauza și pregătiți reconcilierea aprobată în izolare. |
| Fișierul 2 sau 3 eșuează după un COMMIT anterior | Nu presupuneți că toate trei au fost anulate. Inventariați exact ce s-a instalat, mențineți mentenanța și decideți continuarea sau remedierea împreună cu proprietarul. |
| Aplicația dă erori după instalare | Reduceți scrierile, păstrați protecțiile și logurile, verificați taburi vechi/cozi offline/versiunea activă. Nu reintroduceți CASCADE pentru a face un buton vechi să funcționeze. |

Fiecare fișier este tranzacțional; o eroare înainte de COMMIT trebuie să lase acel fișier neaplicat. Confirmați prin catalog, fără a deduce starea dintr-un mesaj al editorului SQL. Pentru psql ON_ERROR_STOP, ieșirea conexiunii anulează tranzacția deschisă eșuată.

Pentru rollback doar de interfață, construiți același candidat cu `NEXT_PUBLIC_SOLASH_NEW_UI=false` în mediul Production și urmați aprobarea de deployment/promovare. Cache-ul și logica comună rămân. Alternativa este revenirea la deploymentul de producție anterior **verificat**, după evaluarea compatibilității lui cu schema nouă; versiunea istorică poate afișa mesaje înșelătoare la operații respinse.

Eliminarea guardului ori revenirea la CASCADE/DELETE larg nu este rollback standard. Inversările din [MIGRATION_READINESS.md](MIGRATION_READINESS.md) slăbesc protecția și cer backup proaspăt, test și aprobare separată. Recuperarea datelor se începe întotdeauna prin restaurare într-o destinație izolată și reconcilierea rândurilor create după punctul de backup. Nu încărcați snapshotul vechi peste baza live și nu resetați secvențe după ID-uri istorice fără verificare.
