# iPhone: probă practică pe aplicația publicată

**De executat de proprietar; niciun rând de mai jos nu este marcat ca trecut.** Modificările ramurii locale, inclusiv redesignul, corecția cache-ului și protecțiile SQL, nu au fost lansate prin această lucrare. Proba de aici descrie numai aplicația care este efectiv publicată la momentul testului.

## Înainte de test — 2 minute

- Notează modelul iPhone, versiunea iOS (**Settings → General → About**), data/ora și domeniul exact folosit în mod normal. Nu folosi URL de Preview sau un link ICS cu token.
- În Vercel, dacă ai acces, **solash → Deployments → deploymentul curent Production**: notează commitul și domeniul. Dacă nu poți confirma commitul, scrie „versiune live neconfirmată”; nu îl înlocui cu SHA-ul dezvoltării sau cu baseline-ul istoric.
- Folosește dispozitivul propriu, într-un loc privat. Nu trimite capturi cu nume, numere, observații ori tokenuri. Păstrează setările și operațiile locale nesincronizate; dacă există coadă/pending sau erori de sincronizare, oprește testele de reload/background/offline și raportează situația.
- Nu șterge datele Safari, nu dezinstala PWA existentă, nu ieși din cont pentru test și nu reseta parola. Nu apăsa Salvează, Șterge, Anulează programarea, Trimite WhatsApp, Trimite push, Activează notificări sau Backup manual. Unele dintre acestea scriu în producție chiar dacă nu schimbă o rezervare.

## Matrice fără modificări ale clientelor/programărilor — 10 minute

Completează fiecare rând cu **PASS / FAIL / NETESTAT**, ora și o observație. O captură se decupează/redactează înainte de distribuire.

| ID | Ce faci | Ce confirmi |
| --- | --- | --- |
| I1 | Deschide domeniul cunoscut în Safari, online. Folosește sesiunea existentă; dacă trebuie login, folosește numai contul propriu. | Pagina se încarcă; agenda și istoricul cunoscut sunt vizibile. Loginul poate scrie metadate de sesiune Auth, nu este test de cont nou. |
| I2 | Portret: derulează agenda de sus până jos și deschide secțiunile de navigare obișnuite. | Niciun buton esențial sub bara Home/notch; fără scroll orizontal accidental sau text suprapus. |
| I3 | Deschide calendarul, selectează o altă zi, treci în luna următoare și înapoi; revino la azi folosind controlul existent. | Ziua/luna și lista corespund; selecția nu mută o programare. Nu trage carduri și nu face long-press. |
| I4 | În lista clientelor, caută o clientă deja cunoscută și citește informația afișată. | Căutarea/tastatura funcționează; închiderea tastaturii nu blochează navigarea. Nu modifica nume/telefon/observații. |
| I5 | Citește o programare existentă din agendă, fără deschiderea unui flux de editare. | Ora, durata, serviciul și statusul sunt lizibile; rândurile istorice nu dispar la navigare. Aceasta nu verifică protecția la ștergere. |
| I6 | Rotește în landscape și înapoi, dacă telefonul permite. | Navigarea, calendarul și lista rămân utilizabile; după revenire nu se pierd ziua ori conținutul. |
| I7 | Dacă ai deja PWA, deschide iconul existent. Altfel în Safari: **Share → Add to Home Screen**, cu **Open as Web App** dacă apare, apoi Add. Nu înlocui/șterge iconul vechi. | Se deschide domeniul corect; apare ca aplicație, fără pagină goală. Sesiunea/localStorage pot fi separate de Safari; nu presupune copierea operațiilor nesincronizate. [Pași Apple](https://support.apple.com/en-euro/guide/iphone/iph42ab2f3a7/ios). |
| I8 | Numai fără operații pending: treci PWA în background 30–60 secunde, apoi revino. | Agenda se reafișează și interacțiunile răspund; nu confunda refreshul datelor cu o actualizare de versiune. |
| I9 | Numai fără pending: în Safari fă un reload normal, online; PWA închide/deschide normal. Dacă lista devine goală, oprește testul. | Datele revin din sursă, fără ecran blocat. Nu goli cache-ul pentru a „repara” rezultatul. Corecția locală de cache nu este confirmată live. |
| I10 | Opțional, numai fără pending: cu agenda deja deschisă, activează Airplane Mode pentru 15 secunde; citește doar ecranul curent, fără navigare/editare/reload; reactivează imediat rețeaua. | Notează mesajul offline și revenirea conexiunii. Dacă datele dispar, nu încerca salvarea lor. Nu validează pornirea la rece, coada sau reconcilierea. |

Nu este necesar un test de rezervare reală. Dacă un control deschide direct editorul, închide-l fără salvare și marchează partea de editare NETESTAT.

## Probe care rămân pentru un mediu izolat

- Creare/editare/anulare/reprogramare, blocaje personale, override de program și două dispozitive simultane: numai cu date sintetice pe o clonă separată.
- Long-press/drag, salvare offline, cold start offline și reconcilierea conflictelor: nu pe programările reale. Nu inventa operații pending pentru această probă.
- Actualizarea unei PWA la un build nou și revenirea la `NEXT_PUBLIC_SOLASH_NEW_UI=false`: necesită două builduri autorizate pe mediu izolat. Reloadul aceluiași deployment live nu dovedește actualizarea. Flagul este compilat la build; nu există un comutator live pe iPhone pentru schimbările locale.
- Notificări push, export/backup și schimbarea setărilor de program: sunt probe separate, cu efecte de scriere, excluse din această listă.

## Cum confirmi rezultatul

Trimite: „iPhone…, iOS…, domeniu…, commit live…/necunoscut; I1=…, … I10=…; probleme…”. Nu include datele clientelor. Probele izolate și de actualizare rămân explicit NETESTAT chiar dacă toate cele zece verificări de mai sus trec.
