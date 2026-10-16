# Autorizare: intervențiile minime propuse, neaplicate

16.10.2026. Nu există modificări noi de cod, RLS, roluri sau setări Auth în această etapă. Catalogul deja colectat este reutilizat; am citit suplimentar numai `GET /auth/v1/settings` cu cheia publicabilă existentă. [Dovadă](evidence/blocker-access-followup-20261016.json).

## Constatare nouă

HTTP 200: `disable_signup=false`, provider email activ, `mailer_autoconfirm=false`, anonymous sign-ins dezactivate, phone dezactivat. Înscrierea este deci activată în setările publice, iar confirmarea emailului este cerută. Nu am încercat înscrierea, trimis email sau creat utilizator; nu au fost inspectate hookurile și eventualele controale suplimentare. Confirmarea emailului dovedește controlul unei adrese, nu dreptul de administrare SoLash.

RLS verificat anterior permite acces larg pentru orice `authenticated`; rutele locale de backup/push verifică în mai multe locuri existența unui utilizator valid, fără o listă explicită de administratori. Absența unui buton Signup în frontend nu blochează apelarea API-ului Auth. Această combinație este un **blocaj de autorizare**, separat de protecțiile împotriva accidentelor. [Semantica setărilor Auth](https://supabase.com/docs/guides/auth/general-configuration).

## Propuneri în ordinea riscului

| Schimbare minimă | Limită / precondiție / verificare |
| --- | --- |
| 1. Dacă SoLash este pentru administratori invitați, dezactivarea **Allow new users to sign up**. Păstrarea providerului Email și a confirmării emailului. | Necesită aprobarea setării de producție. Proprietarul confirmă mai întâi că nu există onboarding legitim de cliente prin Auth. Nu dezactiva providerul Email: ar opri loginul existent. Nu elimină utilizatorii/sesiunile deja existente; acestea se revizuiesc separat. |
| 2. O listă explicită a UUID-urilor administratorilor autorizați, verificată în RLS și în rutele serverului care folosesc service-role. | Pentru un singur administrator, predicate RLS bazate pe `auth.uid()` și UUID aprobat sunt mai mici decât introducerea unui sistem nou de roluri. Pentru mai mulți, folosiți o listă privată controlată administrativ, proiectată separat. În rutele serverului validați tokenul cu `getUser`, apoi UUID-ul, înainte de service-role. Nu folosiți `user_metadata`, adresa afișată sau un flag din browser. |
| 3. Revocarea numai a privilegiilor SQL **TRUNCATE** și **TRIGGER** de la `anon` și `authenticated` pe cele șapte tabele publice. | API-ul aplicației nu folosește aceste privilegii. Nu revoca global ALL, SELECT/INSERT/UPDATE, accesul la secvențe ori privilegiile serviciilor. Verificați granturi directe/moștenite/PUBLIC pe clonă și comparați privilegiile efective. Nu închide singură accesul CRUD larg; nu reprezintă o vulnerabilitate TRUNCATE anonimă demonstrată prin REST. |

Toate sunt propuneri, nu migrări executabile aprobate. Modificările RLS se pregătesc într-o propunere separată de cele trei migrări deja revizuite; nu le alterăm în tăcere sau schimbăm hashurile. Pentru policies `USING(true)`/`WITH CHECK(true)`, se păstrează comenzile legitime, dar se cere UUID autorizat în ambele predicate relevante. Politica DELETE pentru blocaje personale trebuie combinată cu verificarea administratorului; aceasta nu face marcajul editabil imuabil. Conturile autorizate/service-role rămân actori privilegiați.

## Pașii proprietarului acum — numai citire

1. În proiectul Supabase corect: **Authentication → Sign In / Providers → User Signups**, citește **Allow new users to sign up**; verifică Email separat. Poziția poate varia, pagina de configurare este indicată în documentația de mai sus. Nu salva modificări în această etapă.
2. **Authentication → Users**: confirmă privat care conturi sunt autorizate și păstrează UUID-urile într-un canal/fișier privat. Nu șterge conturi, nu invita și nu revoca sesiuni doar pentru test; numărul de utilizatori din auditul anterior este datat.
3. Confirmă „aplicație doar pentru administratori / onboarding necesar” și conturile permise. După aceasta se poate construi și testa propunerea concretă pe date sintetice. Un cont neautorizat de probă se creează numai în mediul izolat.

## Condiții înainte de aprobare

În clonă: administratorul existent poate login/citi/scrie/face backup și folosi push; un al doilea utilizator autentificat neautorizat nu poate citi sau modifica cliente/programări ori invoca rutele privilegiate; anon nu obține date. Testele de ștergere/booking rămân cele existente și se reiau doar dacă RLS/granturile se schimbă. Cronul își păstrează autorizarea separată; nu se introduce dependență de o sesiune de browser.

Rollback: în caz de blocare accidentală a administratorului, oprește fluxul și corectează UUID-ul/predicatul printr-o conexiune administrativă aprobată, folosind definițiile salvate; nu reveni automat la accesul tuturor utilizatorilor. Nu redeschide înscrierea pentru a rezolva loginul unui cont existent. Dacă apar conturi suspecte, păstrează dovezile și pregătește răspuns separat aprobat; nu șterge istoricul. Service-role rămâne exclusiv pe server și exclusiv Production pentru date live; izolarea Preview este încă nedovedită.
