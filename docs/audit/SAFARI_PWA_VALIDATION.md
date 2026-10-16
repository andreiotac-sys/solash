# Safari / PWA — verificări suplimentare

16.10.2026. Safari real pe macOS, versiunea din meniul Develop **27.0**, a devenit accesibil. Testele au folosit exclusiv `http://127.0.0.1:3133`, cu URL/key/service-role Supabase explicit goale. Nicio rezervare de test nu a fost trimisă la producție.

| Verificare nouă | Rezultat și limită |
| --- | --- |
| Safari Responsive Design Mode | 375×667 și 430×667, pixel ratio 2×. Agenda, formularul și navigarea au fost inspectate; acest mod nu este un iPhone fizic și nu reproduce tastatura ori safe-area hardware. |
| Flux de rezervare | Clientă sintetică creată; rezervare 16:00–16:30 creată; editare din calendar, mutare la 15:00–15:30 și confirmare în agendă. Flux demo, nu o repetare a testului autentificat Supabase din etapa anterioară. |
| Calendar | Trecere octombrie → noiembrie → octombrie și deschidere editor din card. Long-press/drag cu degetul rămâne netestat. |
| Anulare | Statusul a devenit `Anulata`, intervalul s-a eliberat și rândul a rămas în listă. |
| Cache local la reload | S-a observat suprascrierea cache-ului de starea inițială goală înainte de încărcare. Persistența este acum condiționată de terminarea încărcării/autentificării. O nouă clientă și rezervare sintetice au rămas după reload complet. |
| Revenire frontend | Pe același origin Safari, restartul local cu `NEXT_PUBLIC_SOLASH_NEW_UI=false` a afișat interfața anterioară și a păstrat clienta plus programarea anulată. |
| Actualizare după revenire | Build nou cu flag=true, rulat prin `next start` pe același origin: Safari a încărcat din nou redesignul după reload și a păstrat istoricul anulat. Nu a rămas blocat pe bundle-ul vechi. |
| Manifest și iconuri | HTTP 200, standalone, start `/`, limbă ro; PNG-urile au efectiv 192×192, 512×512 și Apple 180×180. |
| Service worker | Apare pentru localhost în meniul Develop → Service Workers. `/sw.js` răspunde 200, `Cache-Control: public, max-age=0`; sursa folosește skipWaiting/clients.claim. Nu are handler fetch și nu folosește Cache Storage. |

Service workerul existent gestionează push/click, fără cache offline al aplicației. Persistența datelor în localStorage nu garantează că o pornire completă fără rețea poate încărca aplicația. Verificarea reîncărcării și comutării bundle-ului nu dovedește actualizarea unei PWA instalate pe iOS. [Captură Safari cu date locale](evidence/safari-responsive-430.png).

## Teste manuale încă necesare

Pe un iPhone fizic, cu un **mediu izolat autentificat**, instalați PWA prin Add to Home Screen și verificați: tastatură/date/time pickers, safe areas, scroll și nav fixă, rezervare/editare/anulare, schimbarea zilei și lunii, long-press/drag, închidere și redeschidere, revenire din background, actualizarea unui build și revenirea la flag=false. Repetați cu date nesincronizate înainte de reconectare, fără a goli storage-ul.

Verificați separat cache-ul autentificat la pornire offline și sincronizarea după reconectare, conflictele dintre două dispozitive și permisiunea/livrarea push cu chei și subscripții de test. Nu a fost disponibil un iPhone fizic și nu a fost instalată o PWA în acest test; aceste puncte rămân deschise. Nu este nevoie de ștergerea cache-ului sau a datelor producției pentru testare.
