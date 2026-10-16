# SoLash — pașii rămași, pe scurt

**16.10.2026: NO-GO.** Nu am reluat auditul, buildurile sau testele trecute. În această continuare sunt numai citiri punctuale și documentație; aplicația și datele producției nu au fost modificate. Ramura de lucru rămâne `audit/solash-safe-improvements`, după `cb3de926f8c1829e5747bbd305bd0932159a1058`.

## Ce am putut încheia autonom

- Confirmat accesul Supabase la proiect, dar inventarul backupurilor native nu este expus de conexiune și nu există acreditări native/PAT configurate. Niciun backup nativ nu poate fi declarat existent sau restaurabil din dovezile actuale.
- Diagnosticat Vercel: utilizatorul `andreiotac-sys`, zero echipe vizibile, 403 la citirea echipei și proiectului în scope-ul `andreiotac-sys-projects`. Răspunsul nu indică SSO și nu arată dacă lipsa este membershipul sau consimțământul/grantul conectorului.
- Verificat setările publice Auth: **înscriere activată**, email activ cu confirmare, anonymous sign-ins dezactivate. Politicile largi deja observate fac necesară autorizarea explicită a administratorilor.
- Pregătit [pașii de acces](ACCESS_UNBLOCKING_STEPS.md), [lista iPhone pe aplicația live](IPHONE_LIVE_CHECKLIST.md) și [propunerea minimă de autorizare](AUTHORIZATION_MINIMAL_PROPOSAL.md). Nu am creat conturi de test în producție.

## Ce necesită acces sau confirmare de la tine

1. **Supabase → proiect → Database → Backups**: trimite planul, disponibilitatea Scheduled/PITR și data UTC/starea celui mai recent punct. Nu apăsa Restore/upgrade. Dacă nu există acces, configurează securizat conexiunea nativă existentă după [pașii exacți](ACCESS_UNBLOCKING_STEPS.md). Nu trimite parole sau tokenuri în chat.
2. **Vercel → andreiotac-sys-projects → solash**: verifică identitatea, Viewer dacă este disponibil și selecția proiectului în consimțământul conexiunii. Sunt necesare citiri Team/Projects/Deployments și env Production/non-Production; nu scrieri. Dacă nu poți acorda citirea, verifică manual matricea env fără valori. Confirmarea finală va fi citirea 200 a proiectului și metadatelor env corecte.
3. Execută [I1–I10 pe iPhone](IPHONE_LIVE_CHECKLIST.md), raportând PASS/FAIL/NETESTAT. Nu crea, muta sau anula programări pentru test. Probele live nu dovedesc redesignul sau corecțiile locale și nu înlocuiesc testele izolate de scriere/actualizare PWA.
4. În **Authentication**, confirmă dacă accesul este exclusiv administrativ și care UUID-uri sunt autorizate. Nu publica datele conturilor. Înscrierea activă necesită o decizie explicită.

## Ce necesită aprobare explicită de producție

- Dezactivarea înscrierii, schimbarea RLS/granturilor ori a autorizării rutelor, după testarea propunerii în izolare. Nimic nu a fost aplicat.
- Crearea unei clone cloud/cu costuri și restaurarea datelor reale într-o țintă izolată; apoi proba completă a backupului nativ. Restaurarea producției este o acțiune separată, nepropusă acum.
- Corecțiile de configurare Vercel dacă se găsesc valori live în Preview, cele trei migrări exacte, push/merge, deployment/promovare și orice probă de scriere în producție. Acordarea accesului de citire nu autorizează aceste acțiuni.

După acces pot continua autonom citirile de metadate, comparația de izolare și pregătirea/testarea locală a propunerii de autorizare. Nu voi declara GO înainte de dovada recuperării native, izolarea Preview, închiderea riscului de autorizare și probele mobile necesare. [Runbookul existent](PRODUCTION_DEPLOYMENT_RUNBOOK.md) rămâne neexecutat.
