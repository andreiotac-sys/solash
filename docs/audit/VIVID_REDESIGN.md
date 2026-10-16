# SoLash — redesign luminos pentru întregul studio

Noua direcție înlocuiește tema întunecată a interfeței noi cu roz zmeură, violet, alb-crem și mentă. Interfața originală negru-auriu rămâne disponibilă prin `NEXT_PUBLIC_SOLASH_NEW_UI=false`, la build. Nicio schemă, politică RLS, rută API sau regulă de programare nu a fost schimbată în acest redesign.

## Ce s-a schimbat

- Identitate vizuală nouă în aplicație: wordmark SoLash cu simbol floral vectorial; logo-ul vechi și iconurile PWA existente sunt păstrate pentru recuperare/recunoaștere.
- Pagina principală: antet pastel, dată și acțiuni clare, indicatori în patru culori, carduri pentru programări, disponibilitate și reminders. Pe desktop, indicatorii stau lângă controale, iar navigarea devine laterală.
- Calendar: suprafețe luminoase, zi selectată zmeură, zi curentă și sărbători distincte, cronologie albă și carduri colorate pe servicii. Duratele și interacțiunile de rezervare rămân cele existente.
- Formulare de programare/clientă, lista clientelor, rapoarte și setări: aceleași suprafețe, borduri, butoane și stări coerente. Mesajele de eroare/anulare și intervalele libere au culori distincte, cu text mai contrastant.
- Login și ecran de încărcare: aceeași temă; culorile manifestului/viewportului și stilul barei iOS sunt adaptate variantei alese. Nu s-au schimbat metodele de autentificare.
- Navigarea principală afișează etichete complete și `aria-current`; în interfața nouă, schimbarea secțiunii revine la începutul paginii. Formularele păstrează 16 px pentru evitarea zoomului automat pe iPhone. Controalele obișnuite au minimum 44 px; acțiunile dense din cardurile cronologiei păstrează 28 px.

Stilurile sunt în `src/app/redesign.css`, încărcat după stylesheetul global și limitat la `.solash-v2`. Adaptoarele de culoare pentru utilitarele întunecate existente evită schimbarea logicii și a stilurilor frontendului original. Nu au fost adăugate dependențe sau fonturi externe. Preferința pentru mișcare redusă și spațiul safe-area sunt respectate.

## Verificări efectuate

| Probă | Dovadă și limită |
| --- | --- |
| Lint | PASS după schimbările TSX/CSS. |
| Build optimizat | Webpack și TypeScript PASS, cu Supabase dezactivat. |
| Browser responsive | Toate cele șase secțiuni inspectate la 375 px și 1280 px; home verificat și la 390/430 px, setări la 320 px. Lățimea documentului egală cu viewportul. [Măsurători](evidence/vivid-redesign/validation.json). |
| Flux local | Clientă sintetică și programare create în demo local, afișate în agendă/formular; persistă după reload și schimbarea false→true. Nicio scriere în proiectul Supabase de producție. |
| Login | Randare verificată la 375 px cu adresă loopback fictivă și cheie de test, fără introducerea acreditărilor ori apelarea loginului. Nu este un test de autentificare. |
| Culori | Contrast calculat: text secundar pe panel 4,83:1, alb pe capătul roz al butonului 5,22:1, accent pe fundal 5,57:1; culorile mai slabe ale placeholderelor/zilelor din altă lună au fost ajustate. Nu reprezintă un audit complet WCAG. |
| Safari macOS | Home și calendar din buildul optimizat au fost afișate și navigarea verificată în Safari real pe Mac. iPhone fizic, PWA instalată, tastatură și interacțiuni tactile rămân de verificat pe dispozitiv. |
| Console | Zero erori în browserul Preview local pentru interfața nouă. Varianta veche păstrează un avertisment Next Image preexistent privind dimensiunile logo-ului. |
| Revenire originală | `false` a afișat logo-ul original și fundalul `rgb(9,8,6)`, fără `.solash-v2`; programarea sintetică a rămas disponibilă. |

Nu au fost repetate restaurarea backupului sau testele migrărilor: schimbările sunt de prezentare. Rezultatul vizual nu închide blocajele de producție documentate anterior.

## Capturi din date locale sintetice

- [Home mobil](evidence/vivid-redesign/home-390.jpg)
- [Calendar mobil](evidence/vivid-redesign/calendar-390.jpg)
- [Formular](evidence/vivid-redesign/booking-390.jpg)
- [Autentificare](evidence/vivid-redesign/login-375.jpg)
- [Desktop](evidence/vivid-redesign/desktop-1280.jpg)

Publicarea este numai pe ramura `audit/solash-safe-improvements`; integrarea Git→Vercel reactivată de proprietar poate produce un Preview. Nu s-a făcut merge în `main`, nu s-au aplicat migrări și nu se afirmă că domeniul Production afișează acest redesign. Pentru revenire UI se reconstruiește candidatul cu `NEXT_PUBLIC_SOLASH_NEW_UI=false`.
