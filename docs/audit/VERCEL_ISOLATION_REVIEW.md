# Vercel: izolarea Production / Preview

16.10.2026 — **izolare neconfirmată; NO-GO pentru push/deployment** până la verificare. Nu s-au modificat variabile, proiecte, deploymenturi sau aliasuri.

Integrarea conectată a identificat proiectul `solash`, ID `prj_GZ5wCC5zUCTvpYMKK3EnZGEx9s1m`, echipa `team_ks9AvByOp9QSxzsQVDuQHdtz`, scope `andreiotac-sys-projects`. Citirea setărilor proiectului și a metadatelor variabilelor cu `decrypt=false` a eșuat cu **403 forbidden, lipsă acces la acest scope**. Nu au fost cerute valori decriptate. Nu există Vercel CLI sau acreditări CLI locale disponibile pentru fallback. [Dovadă](evidence/platform-access-20261016.json).

Din repository este confirmat numai `vercel.json`: cron reminder la `17:30 UTC`, cron backup la `17:40 UTC`. Nu există `.vercel/project.json`. Aceste fișiere nu dovedesc ramura de producție, scopurile variabilelor sau configurația deploymentului activ. SHA-ul GitHub `main` verificat anterior nu substituie citirea setărilor Vercel.

## Ce trebuie inspectat, fără publicarea secretelor

| Setare | Cerință de acceptare |
| --- | --- |
| Proiect / Git / Production Branch | ID-urile de mai sus, repositoryul SoLash și ramura efectivă de producție confirmate. |
| Production | URL/key Supabase corespund proiectului live; secretele serverului sunt exclusiv în scope Production. |
| Preview, inclusiv override pe ramură | URL/key și service-role aparțin unui proiect Supabase separat, cu utilizatori și date sintetice. Nicio referință la proiectul live. |
| Variabile partajate de echipă / integrări / medii custom | Nu reintroduc valorile de producție în Preview; verificați prioritatea override-urilor și mediile moștenite. |
| Cron, push, ICS și tokenuri | Preview nu folosește CRON_SECRET, cheile VAPID private, tokenul ICS ori subscripțiile dispozitivelor reale. |
| Build și runtime | Mediul compilat în browser și mediul funcțiilor corespund aceleiași destinații izolate. `NEXT_PUBLIC_*` este fixat la build. |
| Deploymenturi Preview existente | Se verifică și artefactele deja construite; modificarea variabilelor influențează deploymenturi viitoare, nu repară retroactiv artefactele vechi. |

Aceste verificări urmează [scopurile variabilelor Vercel](https://vercel.com/docs/environment-variables). Orice modificare necesară va fi revizuită și aprobată separat; în această etapă nu a fost aplicată.

## Configurația necesară dacă există valori comune

1. Opriți lansările de Preview până la delimitarea mediilor. Nu faceți un push de probă: poate declanșa automat un deployment.
2. Păstrați valorile producției în Production; configurați în Preview numai proiectul separat și secrete independente. Eliminați după aprobare asocierea valorilor live cu scope-ul Preview, inclusiv la nivel de echipă și override de ramură.
3. Creați artefacte Preview noi numai după aprobarea deploymentului. Confirmați proiectul din bundle printr-o comparație locală a hostului, fără afișarea cheilor; testați cu un cont sintetic. Nu introduceți acreditările adminului de producție în Preview.
4. Înainte/după un CRUD pe clienta sintetică în Preview, comparați numai agregate sau auditul sursei live. Preview trebuie să scrie exclusiv în destinația sa. Nu încercați o scriere de test în producție ca probă negativă.

Aplicația folosește Supabase direct din browser, iar RLS live autorizează rolul `authenticated` indiferent de originea paginii. Protejarea URL-ului Preview prin Vercel Authentication nu izolează baza de date; separarea proiectelor, a emitenților tokenurilor și a cheilor este necesară. [Deployment Protection](https://vercel.com/docs/deployment-protection) controlează accesul la pagină, nu granturile PostgreSQL.

Nu se poate declara „Preview nu poate modifica producția” pe baza configurației locale ori a planului Vercel. Proprietarul trebuie să acorde acces de citire la scope-ul de mai sus sau să verifice manual matricea și să furnizeze dovezi redactate, fără valori secrete.
