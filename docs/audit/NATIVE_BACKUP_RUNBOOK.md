# Backup nativ: stare verificată și procedură rămasă

16.10.2026. Nu s-a creat un backup nativ, nu s-a restaurat producția și nu s-a schimbat planul Supabase.

## Stare și limite

Metadatele organizației confirmă planul **Free**. Inventarul backupurilor administrate nu este expus de integrarea conectată; nu există local PAT Supabase sau acreditări PostgreSQL de conexiune. Prin urmare **existența, data și restaurabilitatea unui backup nativ complet nu sunt confirmate**. Această concluzie nu afirmă că Supabase nu are copii fizice interne.

Bucketul privat al aplicației are 130 XLSX și un `json.gz`. Acestea sunt exporturi ale aplicației, nu inventarul backupurilor administrate. Snapshotul verificat anterior acoperă șapte tabele și 3.870 de programări; citirea actuală arată 3.875. Păstrați snapshotul și hashul său ca punct suplimentar de recuperare, fără a-l încărca peste producție. [Dovezi](evidence/platform-access-20261016.json).

Supabase documentează backupuri zilnice accesibile pe planurile plătite și recomandă exporturi CLI externe pentru Free. Backupurile bazei păstrează metadatele Storage, dar nu fișierele stocate prin API. [Documentația backupurilor](https://supabase.com/docs/guides/platform/backups).

## A. Verificarea unui punct administrat existent

1. În proiectul `vholwdtqcrkohydydmnb`, deschideți **Database → Backups → Scheduled**, apoi secțiunea PITR. Notați planul, tipul backupului, starea, data UTC, primul/ultimul punct recuperabil și opțiunea disponibilă de restaurare într-un proiect separat. Nu apăsați Restore pe proiectul sursă.
2. Alternativ, cu un PAT propriu furnizat în siguranță unui client autorizat, citiți numai `GET https://api.supabase.com/v1/projects/vholwdtqcrkohydydmnb/database/backups`. Nu folosiți cheia `service_role` ca PAT. Păstrați doar metadatele backupului în raport. 401/403 înseamnă inventar inaccesibil; o listă goală nu este un backup.
3. Dacă există un punct fizic utilizabil, pregătiți restaurarea **în alt proiect** după aprobarea costului și a procesării datelor reale. Funcția de restaurare într-un proiect nou are condiții de plan și copiază cheia de criptare în acest flux. Verificați separat setările și serviciile care nu se copiază. [Fluxul oficial](https://supabase.com/docs/guides/platform/clone-project).

## B. Crearea unui backup PostgreSQL logic nativ

Necesită o conexiune existentă de citire completă la baza sursă, nu doar REST/MCP. Proprietarul o configurează local; nu este necesar să posteze parola în chat și nu trebuie resetată parola producției pentru acest audit. Folosiți TLS verificat și un fișier libpq service/password cu acces 0600. Numele de service de mai jos sunt exemple care trebuie configurate și verificate explicit.

Cu utilitarele PostgreSQL 17 și o destinație privată, în afara repositoryului:

Formatul custom și compresia nu criptează dumpul. Păstrați exporturile și fișierele de roluri pe un volum criptat, cu acces restrâns; orice transfer necesită criptare și o politică de retenție aprobată.

```bash
umask 077
PGOPTIONS='-c default_transaction_read_only=on' \
  pg_dump --dbname='service=solash_source_backup' --format=custom \
  --lock-wait-timeout=5s --file=database.dump
PGOPTIONS='-c default_transaction_read_only=on' \
  pg_dumpall --dbname='service=solash_source_backup' \
  --roles-only --no-role-passwords --file=roles.sql
pg_restore --list database.dump > archive-toc.txt
shasum -a 256 database.dump roles.sql > SHA256SUMS
```

`pg_dump` fără filtre de schemă/tabel produce o copie logică tranzacțional consistentă a bazei, cu DDL, date și secvențe; rolurile sunt globale și se exportă separat. Verificați TOC pentru `public`, `auth`, `storage`, celelalte scheme folosite, funcții, politici și ACL. Orice eroare de permisiune sau obiect omis împiedică declararea backupului complet. [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_dumpall](https://www.postgresql.org/docs/17/app-pg-dumpall.html).

Supabase oferă și ruta CLI `db dump` pentru roluri, schemă și date. Respectați excluderile sale pentru obiectele administrate și exportați separat customizările Auth/Storage; trei fișiere implicite nu dovedesc singure că toate customizările sunt incluse. Exporturile în comenzi separate trebuie făcute într-o fereastră fără modificări relevante sau validate față de un punct comun. [Procedura CLI oficială](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [referința comenzii](https://supabase.com/docs/reference/cli/supabase-db-dump).

## C. Restaurarea și acceptarea

1. Pregătiți o destinație Supabase/PostgreSQL 17 compatibilă, complet distinctă de sursă. Pentru date reale, blocați accesul public și ieșirile către push, webhookuri și schedulere. Nu conectați buildul de test la producție. Înregistrarea exactă a destinației și aprobarea costurilor preced crearea unui proiect cloud.
2. Inventariați extensiile: live sunt `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1`. Un PostgreSQL vanilla nu reproduce toate componentele Supabase. Păstrați separat setările Auth, furnizorii, URL-urile, politicile/configurația proiectului și materialul de criptare necesar dacă Vault este folosit. Existența extensiei Vault nu demonstrează utilizarea secretelor sale; nu am citit acele secrete.
3. Verificați hashurile; inspectați rolurile și DDL-ul înainte de restaurare. Pentru o bază **nouă, goală și izolată**, pregătiți rolurile fără coliziuni cu rolurile preinstalate, apoi folosiți `pg_restore --exit-on-error --single-transaction --dbname='service=solash_restore_isolated' database.dump`. Nu adăugați automat `--clean`, `--no-owner` sau `--no-acl` pentru a ascunde erori: ele pot schimba semantica de acces. La o țintă Supabase deja inițializată urmați fluxul oficial pentru obiectele administrate, nu o suprascriere oarbă. [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
4. Copiați separat obiectele Storage printr-un mecanism suportat și autorizat; comparați dimensiuni/hashuri și păstrați bucketul privat. Nu presupuneți că cele 131 de obiecte vin odată cu dumpul bazei.
5. Comparați schema, FK, RLS, granturi, trigger-e, secvențe și toate tabelele relevante. Comparați rânduri/ID-uri/relații și istoricul la punctul backupului; verificați loginul unui utilizator de test, Storage privat și fluxurile aplicației. Măsurați timpul de restaurare și pierderea maximă acceptată de date. Abia această probă închide blocajul de backup.

Nici dumpul nativ, nici un export de aplicație nu reprezintă singur o copie a întregii configurații Supabase și a dispozitivelor. Setările browserului și operațiile offline se păstrează separat. O restaurare în producție ori reconcilierea datelor create după backup necesită aprobare distinctă și un plan pentru ID-uri; nu este rollback automat.
