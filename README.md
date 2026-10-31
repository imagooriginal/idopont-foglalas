# Időpontfoglaló prototípus

Next.js alapú vendégfoglalás-minta motorszervizek számára, Supabase
adatbázissal és Auth-tal, valamint Resend e-mail-küldéssel.

## Helyi fejlesztés

1. Telepítsd a függőségeket:

   ```bash
   npm install
   ```

2. Másold a `.env.example` fájlt `.env.local` néven, és töltsd ki:

   - `NEXT_PUBLIC_SUPABASE_URL`: a Supabase projekt URL-je.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: a Supabase publishable/anon kulcs.
   - `SUPABASE_SERVICE_ROLE_KEY`: kizárólag szerveroldali service role kulcs;
     soha ne nevezd át `NEXT_PUBLIC_` változóra és ne tedd klienskódba.
   - `RESEND_API_KEY`: Resend API-kulcs.
   - `RESEND_FROM_EMAIL`: a Resendben hitelesített feladó, például
     `Időpontfoglaló <foglalas@pelda.hu>`.

3. Futtasd a Supabase SQL Editorban az eredeti adatbázis-sémát, majd **külön
   lekérdezésként** a
   [`supabase/migrations/20261028190000_harden_booking_security.sql`](./supabase/migrations/20261028190000_harden_booking_security.sql),
   majd a
   [`supabase/migrations/20261029110000_fixed_grid_slots.sql`](./supabase/migrations/20261029110000_fixed_grid_slots.sql)
   majd a
   [`supabase/migrations/20261029130000_multiple_booking_services.sql`](./supabase/migrations/20261029130000_multiple_booking_services.sql)
   majd a
   [`supabase/migrations/20261031190000_weekly_slot_grid.sql`](./supabase/migrations/20261031190000_weekly_slot_grid.sql)
   majd a
   [`supabase/migrations/20261031220000_saas_management_and_booking_consent.sql`](./supabase/migrations/20261031220000_saas_management_and_booking_consent.sql)
   migrációt. Ne cseréld le az eredeti SQL-t a migrációkra. Előtte készíts
   adatbázis-mentést, és oldd fel az első migráció által jelzett esetleges
   átfedő aktív foglalásokat.

4. Hozz létre egy platform-admin felhasználót a Supabase Authban, majd a SQL
   Editorban add hozzá az admin táblához:

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'admin@example.com';
   ```

   A platform-admin céget jóváhagyó RPC-je:
   `select public.set_company_status('<company-uuid>', 'active');`.
   A dashboardos szolgáltatói felhasználónak a cég `owner_id` mezőjében
   szereplő Auth-felhasználónak kell lennie.

   A védett SaaS áttekintő a `/superadmin` útvonalon érhető el, és csak a
   `platform_admins` táblában szereplő fiókkal használható. A tenant
   létrehozásakor a megadott kapcsolattartó e-mail-címére meghívó megy. A
   `free`, `starter` és `pro` értékek adminisztrátori csomagcímkék; fizetési
   szolgáltató vagy automatikus előfizetés-kezelés nincs bekötve.

5. Töltsd fel a `company_business_hours` táblát. A `weekday` értéke
   `0 = vasárnap` ... `6 = szombat`; a napi nyitvatartás időzónája a
   `companies.time_zone` mező.

6. Indítsd el az alkalmazást:

   ```bash
   npm run dev
   ```

   - Szolgáltatói belépés: `http://localhost:3000/dashboard/login`
   - Dashboard: `http://localhost:3000/dashboard`
   - Publikus foglalás: `http://localhost:3000/<ceg-slug>`

## Tesztelés

Futtasd az egyszeri tesztcsomagot:

```bash
npm test
```

A tesztek lefedettségméréssel és az LCOV-riport előállításával:

```bash
npm run test:coverage
```

A lefedettségi riport szöveges összesítése a terminálon jelenik meg, az LCOV
fájl pedig a `coverage/lcov.info` helyre kerül. A CI ezt a parancsot futtatja,
és legalább 80% utasítás-, függvény- és sorkód-lefedettséget, valamint 75%
ág-lefedettséget vár el.

## Elkészült folyamatok

- Bejelentkezett cég-tulajdonosi dashboard: közelgő visszaigazolt foglalások,
  jármű- és ügyféladatok, kézi blokkolások létrehozása és törlése.
- A blokkolás mentése és törlése a migráció jogosultság-ellenőrző
  adatbázis-függvényein keresztül történik.
- Publikus foglalás: cég szolgáltatása, dátumhoz kötött szabad időpontok,
  járműadatok, ötperces zárolás, ügyféladatok, véglegesítés.
- A kezdési időpontokat a cég `slot_interval_minutes` rácsa határozza meg
  (alapértelmezésben 30 perc); elérhetőséghez a szolgáltatás által igényelt
  teljes rácsblokknak szabadnak kell lennie.
- Egy foglalás több szolgáltatást is tartalmazhat; ezek időtartama összeadódik,
  és a szolgáltatások a foglaláshoz kapcsolva a dashboardon és az értesítőben is
  megjelennek.
- Sikeres foglaláskor e-mail megy az ügyfélnek és a cég tulajdonosának; az
  üzenet Google Naptár-linket és ICS-naptárfájlt tartalmaz.
- A foglalás előtt Supabase Auth egyszer használatos e-mail-kódot kér. A
  foglalás csak az aktív, azonos e-mail-című, megerősített Auth-munkamenetből
  véglegesíthető. Az e-mail-megerősítés és az adatkezelési tájékoztató
  elfogadása egy adatbázis-műveletben kerül a foglaláshoz. Ehhez engedélyezd
  az e-mailes OTP-t a Supabase Auth beállításaiban, és állíts be OTP-t
  tartalmazó e-mail-sablont.
- A foglalóoldal tenantonkénti főszínt és `display_order` szerinti
  szolgáltatássorrendet használ.
- A foglalás adatbázisban való véglegesítése akkor is megmarad, ha az e-mail
  konfigurációja hiányzik vagy a kézbesítés sikertelen; ilyen esetben a
  foglaló figyelmeztetést jelenít meg.

## Ismert prototípus-korlátok

- A 24 órás automatikus emlékeztető és ütemezett levélküldés még nincs
  megvalósítva.
- A szolgáltató Auth-fiókját, cégét, szolgáltatásait és heti nyitvatartását a
  jelenlegi prototípusban a platform-admin állítja be.
- A jogi PDF-eket a `public/aszf.pdf` és
  `public/adatvedelmi-tajekoztato.pdf` helyekre kell elhelyezni a publikus
  oldal élesítése előtt.
- A foglalás megerősítése és az e-mail-küldés egy kérésben történik; nagyobb
  üzembiztonsághoz adatbázis-outbox és újrapróbálható háttérfolyamat szükséges.
