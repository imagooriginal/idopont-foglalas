"use client";

import {
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type Locale = "hu" | "en";

const STORAGE_KEY = "app_locale";

let currentLocale: Locale = "hu";
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(nextLocale: Locale) {
  if (currentLocale === nextLocale) return;
  currentLocale = nextLocale;

  if (typeof document !== "undefined") {
    document.documentElement.lang = nextLocale;
    try {
      document.cookie = `${STORAGE_KEY}=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore cookie errors in restricted environments
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {
      // Ignore localStorage errors
    }
  }

  emitChange();
}

export function toggleLocale() {
  setLocale(currentLocale === "hu" ? "en" : "hu");
}

export function resetLocaleForTests() {
  currentLocale = "hu";
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  emitChange();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLanguage() {
  const locale = useSyncExternalStore(
    subscribe,
    () => currentLocale,
    () => "hu" as Locale,
  );

  return {
    locale,
    isEnglish: locale === "en",
    setLocale,
    toggleLocale,
    t: (hu: string, en?: string) => {
      if (locale !== "en") return hu;
      if (en && en !== hu) return en;
      return translateDynamicText(hu, "en");
    },
  };
}

const HU_TO_EN_EXACT: Array<[string, string]> = [
  ["Időpontfoglaló", "Appointment Booking"],
  ["Online időpontfoglalás", "Online Appointment Booking"],
  ["Szervizidőpont, egyszerűen.", "Service appointments, made simple."],
  [
    "Foglalási felület motorszervizeknek és ügyfeleiknek. A szolgáltató publikus oldala a saját cégslugján érhető el.",
    "Booking platform for workshops and their customers. Each provider's public page is available at their own slug.",
  ],
  ["Szolgáltatói belépés", "Provider Login"],
  ["Jelentkezz be a foglalások kezeléséhez.", "Sign in to manage bookings."],
  ["ÁSZF", "Terms of Service"],
  ["Adatvédelmi tájékoztató", "Privacy Policy"],
  ["Műhely admin", "Workshop Admin"],
  ["Áttekintés", "Overview"],
  ["Foglalások", "Bookings"],
  ["Nyitvatartás", "Business Hours"],
  ["Zárvatartás", "Time-off"],
  ["Szolgáltatások", "Services"],
  ["Bejelentkezve", "Signed in"],
  ["Kijelentkezés", "Sign out"],
  ["Szolgáltatói dashboard", "Provider Dashboard"],
  ["Aktív szolgáltató", "Active Provider"],
  ["Jóváhagyásra vár", "Pending Approval"],
  ["Felfüggesztve", "Suspended"],
  ["Nyilvános foglalási oldal:", "Public booking page:"],
  ["Megnyitás", "Open"],
  ["Mai foglalások", "Bookings Today"],
  ["Visszaigazolt időpontok", "Confirmed appointments"],
  ["Közelgő ezen a héten", "Upcoming This Week"],
  ["A következő hét napjára", "For the next 7 days"],
  ["Blokkolt időszakok", "Blocked Periods"],
  ["Közelgő, rögzített szünet", "Upcoming scheduled breaks"],
  ["Közelgő foglalások", "Upcoming Bookings"],
  ["A következő 50 visszaigazolt időpont", "Next 50 confirmed appointments"],
  ["Még nincs közelgő foglalás", "No upcoming bookings yet"],
  [
    "Amint egy ügyfél időpontot foglal, a részletek itt jelennek meg.",
    "As soon as a customer books an appointment, the details will appear here.",
  ],
  ["Időpont", "Time"],
  ["Ügyfél", "Customer"],
  ["Szolgáltatás", "Service"],
  ["Foglalási adatok", "Booking Details"],
  ["Állapot", "Status"],
  ["Kapcsolat", "Contact"],
  ["Visszaigazolva", "Confirmed"],
  ["Még nincs szolgáltatód", "No provider linked yet"],
  ["Kezdjük az alapokkal", "Getting Started"],
  ["Beállítások", "Settings"],
  ["Heti nyitvatartás", "Weekly Business Hours"],
  [
    "Naponta külön állíthatod a foglalható időszakot. A kikapcsolt napokon nem jelennek meg időpontok.",
    "Configure bookable hours for each day. Closed days will not offer any slots.",
  ],
  ["Vasárnap", "Sunday"],
  ["Hétfő", "Monday"],
  ["Kedd", "Tuesday"],
  ["Szerda", "Wednesday"],
  ["Csütörtök", "Thursday"],
  ["Péntek", "Friday"],
  ["Szombat", "Saturday"],
  ["Nyitás", "Opens"],
  ["Zárás", "Closes"],
  ["Nyitvatartás mentése", "Save Business Hours"],
  ["Szolgáltatások kezelése", "Manage Services"],
  ["Szolgáltatás neve", "Service Name"],
  ["Időtartam (perc)", "Duration (min)"],
  ["Ár (Ft)", "Price (HUF)"],
  ["Leírás", "Description"],
  ["Hozzáadás", "Add Service"],
  ["Módosítás", "Update"],
  ["Szolgáltatás elrejtése", "Hide Service"],
  ["Újraaktiválás", "Reactivate"],
  ["Aktív", "Active"],
  ["Rejtett", "Hidden"],
  ["Még nincs szolgáltatás.", "No services yet."],
  ["Free csomag", "Free Plan"],
  ["Alap (Starter) csomag", "Starter Plan"],
  ["Prémium (Pro) csomag", "Premium (Pro) Plan"],
  ["Alap (Starter)", "Starter"],
  ["Prémium (Pro)", "Premium (Pro)"],
  ["Alapszintű előfizetők", "Starter subscribers"],
  ["Minden prémium funkció aktív", "All premium features active"],
  ["Prémium (Pro) funkció", "Premium (Pro) feature"],
  [
    "Prémium (Pro) funkció – Kérd az adminisztrátortól a csomagváltást",
    "Premium (Pro) feature – Ask the administrator to upgrade your plan",
  ],
  ["Csomagdíj-hozzárendelés nélkül", "Without paid subscription"],
  ["Fizetős csomagcímke", "Paid Plans"],
  ["Új tenant", "New Tenant"],
  ["Szolgáltató hozzáadása", "Add Provider"],
  [
    "A kapcsolattartó e-mail-címére belépési meghívót küldünk.",
    "An invitation email will be sent to the contact address.",
  ],
  ["Cég neve", "Company Name"],
  ["Foglalóoldal címe", "Booking Page Slug"],
  ["Kapcsolattartó e-mail-címe", "Contact Email Address"],
  ["Fő szín", "Primary Color"],
  ["Foglalóoldal arculati színe", "Brand color of the booking page"],
  ["Csomag", "Plan"],
  ["Időzóna", "Time Zone"],
  ["Időpont-rács (perc)", "Slot Interval (min)"],
  [
    "Ár és leírás módosításának engedélyezése",
    "Allow editing prices and descriptions",
  ],
  [
    "Haladó szolgáltatáskezelés engedélyezése",
    "Allow advanced service management",
  ],
  ["Extra foglalási kérdések", "Custom Booking Questions"],
  ["Szolgáltató létrehozása", "Create Provider"],
  ["Tenant kontextus", "Tenant Context"],
  ["Kiválasztott szolgáltató", "Selected Provider"],
  ["Válassz szolgáltatót...", "Select a provider..."],
  ["Tenant szolgáltatásai", "Tenant Services"],
  ["Szolgáltatáslista és sorrend", "Service List & Order"],
  [
    "Húzd a fogantyút a sorrend módosításához; a változás automatikusan mentődik.",
    "Drag the handle to reorder services; changes are saved automatically.",
  ],
  ["Szolgáltató beállításai", "Provider Settings"],
  ["Szolgáltató adatainak mentése", "Save Provider Settings"],
  ["Szolgáltatók és előfizetők", "Providers & Subscribers"],
  [
    "A regisztráció kezdete és a manuálisan kezelt csomag.",
    "Registration start date and manually managed plan.",
  ],
  ["Státusz mentése", "Save Status"],
  ["Mentés", "Save"],
  // Auth, Permissions & Superadmin Errors
  [
    "Adj meg érvényes e-mail-címet és legalább 8 karakteres jelszót.",
    "Please enter a valid email address and a password of at least 8 characters.",
  ],
  [
    "Túl sok bejelentkezési próbálkozás. Kérlek, próbáld újra néhány perc múlva.",
    "Too many login attempts. Please try again in a few minutes.",
  ],
  [
    "A bejelentkezés nem sikerült. Ellenőrizd az adatokat.",
    "Sign-in failed. Please check your credentials.",
  ],
  [
    "A művelethez jelentkezz be újra.",
    "Please sign in again to perform this action.",
  ],
  [
    "Nincs jogosultságod a kiválasztott szolgáltató módosításához.",
    "You do not have permission to modify the selected provider.",
  ],
  [
    "Ez a funkció kizárólag a Prémium (Pro) csomagban érhető el. Kérd az adminisztrátortól a csomagváltást.",
    "This feature is only available on the Premium (Pro) plan. Ask the administrator to upgrade your plan.",
  ],
  [
    "Nincs jogosultságod a szolgáltatások bővített kezeléséhez.",
    "You do not have permission for advanced service management.",
  ],
  [
    "Nincs jogosultságod az árak és leírások módosításához.",
    "You do not have permission to edit prices and descriptions.",
  ],
  [
    "A művelethez platform-admin jogosultság szükséges.",
    "Platform admin privileges are required for this action.",
  ],
  [
    "Ellenőrizd a cég nevét, slugját, kapcsolattartó e-mail-címét és a kiválasztott csomagot.",
    "Please check the company name, slug, contact email address, and selected plan.",
  ],
  [
    "Ez a foglalóoldal-cím már használatban van.",
    "This booking page slug is already in use.",
  ],
  [
    "Ellenőrizd a szolgáltató adatait és a nyitvatartást.",
    "Please check the provider details and opening hours.",
  ],
  [
    "A szolgáltató vagy csomag érvénytelen.",
    "The provider or subscription plan is invalid.",
  ],
  [
    "A szolgáltató vagy státusz érvénytelen.",
    "The provider or status value is invalid.",
  ],
  [
    "A szolgáltató adatai frissültek.",
    "Provider details have been updated.",
  ],
  ["A csomag frissült.", "The subscription plan has been updated."],
  ["A szolgáltató státusza frissült.", "Provider status has been updated."],
  // Service & Business Hours Errors / Success
  [
    "Adj meg érvényes szolgáltatásnevet, időtartamot és árat.",
    "Please enter a valid service name, duration, and price.",
  ],
  [
    "Ellenőrizd a szolgáltatás nevét, időtartamát, árát és leírását.",
    "Please check the service name, duration, price, and description.",
  ],
  ["A szolgáltatás nem található.", "The service could not be found."],
  [
    "A szolgáltatás vagy szolgáltató azonosítója érvénytelen.",
    "Invalid provider or service identifier.",
  ],
  [
    "A szolgáltatások sorrendje érvénytelen.",
    "The service ordering is invalid.",
  ],
  ["A szolgáltatás létrejött.", "The service has been created."],
  ["A szolgáltatás frissült.", "The service has been updated."],
  ["A szolgáltatás adatai frissültek.", "Service details have been updated."],
  ["A szolgáltatás elrejtve.", "The service has been hidden."],
  ["A szolgáltatás újra aktív.", "The service is active again."],
  ["A szolgáltatás ismét foglalható.", "The service is bookable again."],
  [
    "A szolgáltatások új sorrendje elmentve.",
    "The new service order has been saved.",
  ],
  [
    "Adj meg érvényes szolgáltatásnevet és időtartamot.",
    "Please enter a valid service name and duration.",
  ],
  ["Adj meg érvényes árat.", "Please enter a valid price."],
  [
    "A leírás legfeljebb 1000 karakter lehet.",
    "The description can be at most 1000 characters.",
  ],
  ["Nincs mentendő módosítás.", "There are no changes to save."],
  [
    "A nyitvatartás formátuma érvénytelen.",
    "The business hours format is invalid.",
  ],
  [
    "Ellenőrizd a heti nyitvatartást.",
    "Please check the weekly business hours.",
  ],
  [
    "A heti nyitvatartás elmentve.",
    "Weekly business hours have been saved.",
  ],
  // Blockout, Manual Booking & Policy Errors / Success
  [
    "Adj meg érvényes jövőbeli kezdő és végidőpontot, valamint legfeljebb 200 karakteres megjegyzést.",
    "Please enter a valid future start and end time, and a note up to 200 characters.",
  ],
  ["A blokkolást elmentettük.", "Time-off has been saved."],
  ["Érvénytelen zárvatartás.", "Invalid time-off entry."],
  ["A zárvatartást töröltük.", "The time-off has been deleted."],
  [
    "Adj meg érvényes ügyfélnevet, szolgáltatást, időpontot és elérhetőséget.",
    "Please enter a valid customer name, service, time, and contact details.",
  ],
  [
    "A kézi foglalást sikeresen rögzítettük.",
    "The manual booking has been recorded successfully.",
  ],
  [
    "Ellenőrizd a párhuzamos kapacitást (1–50) és a lemondási határidőt (0–168 óra).",
    "Please check the concurrent capacity (1–50) and cancellation window (0–168 hours).",
  ],
  [
    "A párhuzamos kapacitást és az online lemondási határidőt elmentettük.",
    "Concurrent capacity and online cancellation cutoff have been saved.",
  ],
  // CRM, Blacklist, Reschedule, Staff, GCal & Reset Errors / Success
  [
    "Adj meg érvényes ügyfél e-mail-címet és legfeljebb 2000 karakteres belső megjegyzést.",
    "Please enter a valid customer email address and a private note up to 2000 characters.",
  ],
  [
    "A privát ügyféljegyzet elmentve.",
    "Private customer note has been saved.",
  ],
  [
    "Érvénytelen foglalás- vagy szolgáltató-azonosító.",
    "Invalid booking or provider identifier.",
  ],
  [
    "A foglalást No-Show-ként jelöltük, és az ügyfél felkerült a feketelistára.",
    "Booking marked as No-Show and the customer was added to the blacklist.",
  ],
  [
    "A foglalást 'Nem jelent meg' (No-Show) státuszra állítottuk.",
    "Booking status has been set to 'No-Show'.",
  ],
  [
    "Adj meg legalább egy e-mail-címet vagy telefonszámot a feketelistára helyezéshez.",
    "Please provide at least an email address or phone number to blacklist.",
  ],
  [
    "Az ügyfél sikeresen felkerült a feketelistára.",
    "The customer has been added to the blacklist.",
  ],
  [
    "Érvénytelen feketelista-azonosító.",
    "Invalid blacklist entry identifier.",
  ],
  [
    "A feketelistás tiltást feloldottuk.",
    "The blacklist block has been removed.",
  ],
  [
    "Adj meg érvényes foglalást és új kezdési időpontot.",
    "Please enter a valid booking and new start time.",
  ],
  [
    "A foglalást sikeresen átütemeztük.",
    "The booking has been rescheduled successfully.",
  ],
  ["Érvénytelen foglalás-azonosító.", "Invalid booking identifier."],
  [
    "A foglalást lemondtuk, az idősáv felszabadult.",
    "The booking has been cancelled and the time slot is now free.",
  ],
  [
    "Adj meg érvényes munkatárs- vagy állásnevet (1–100 karakter).",
    "Please enter a valid staff member or workstation name (1–100 characters).",
  ],
  [
    "Az új munkatársat / állást hozzáadtuk.",
    "The new staff member / workstation has been added.",
  ],
  ["Érvénytelen munkatárs-azonosító.", "Invalid staff member identifier."],
  ["A munkatárs státusza frissült.", "Staff member status has been updated."],
  ["A munkatársat töröltük.", "The staff member has been deleted."],
  [
    "A Google értékelési linknek biztonságos nyilvános https:// URL-nek kell lennie.",
    "The Google review link must be a valid public https:// URL.",
  ],
  [
    "Az iCal naptár-URL-nek biztonságos nyilvános https:// vagy webcal:// URL-nek kell lennie.",
    "The iCal calendar URL must be a valid public https:// or webcal:// URL.",
  ],
  [
    "Ellenőrizd a megadott Google értékelési és naptár URL-eket.",
    "Please check the provided Google review and calendar URLs.",
  ],
  [
    "A Google Calendar szinkron és az értékeléskérő e-mail beállításait elmentettük.",
    "Google Calendar sync and review email settings have been saved.",
  ],
  [
    "Érvénytelen szolgáltató-azonosító.",
    "Invalid provider identifier.",
  ],
  [
    "Túl sok szinkronizálási kérés rövid időn belül. Kérlek, várj néhány percet.",
    "Too many sync requests in a short period. Please wait a few minutes.",
  ],
  [
    "Először állíts be és ments el egy külső Google Calendar iCal (.ics) URL-t!",
    "Please configure and save an external Google Calendar iCal (.ics) URL first!",
  ],
  [
    "A beállított naptár-URL nem biztonságos nyilvános HTTPS cím. Kérlek, ellenőrizd az iCal URL-t.",
    "The configured calendar URL is not a safe public HTTPS URL. Please check the iCal URL.",
  ],
  [
    "A külső naptár fájl mérete meghaladja a megengedett 1 MB-ot.",
    "The external calendar file exceeds the maximum allowed size of 1 MB.",
  ],
  [
    "A külső Google Calendar elérése sikertelen volt.",
    "Failed to reach the external Google Calendar.",
  ],
  ["Adj meg egy érvényes e-mail-címet.", "Please enter a valid email address."],
  [
    "Túl sok jelszó-visszaállítási kérés. Kérlek, próbáld újra néhány perc múlva.",
    "Too many password reset requests. Please try again in a few minutes.",
  ],
  [
    "Ha a megadott e-mail-cím szerepel a rendszerben, elküldtük a jelszó-visszaállító linket.",
    "If the provided email exists in our system, we have sent a password reset link.",
  ],
  [
    "Az új jelszónak legalább 8 karakter hosszúnak kell lennie.",
    "The new password must be at least 8 characters long.",
  ],
  ["A két jelszó nem egyezik meg.", "The two passwords do not match."],
  [
    "A jelszó módosítása jelenleg nem elérhető.",
    "Password updates are currently unavailable.",
  ],
  [
    "Az új jelszó mentése nem sikerült. Kérj új visszaállító linket.",
    "Failed to save the new password. Please request a new reset link.",
  ],
  [
    "A jelszavad sikeresen frissült. Most már beléphetsz a Dashboardra.",
    "Your password has been updated. You can now sign in to the Dashboard.",
  ],
  // Customer Booking Widget & Cancel/Reschedule API Errors
  [
    "A kérés törzse nem érvényes JSON.",
    "The request body is not valid JSON.",
  ],
  ["Hiányos vagy hibás foglalási adatok.", "Incomplete or invalid booking data."],
  [
    "Túl sok próbálkozás. Kérlek, várj néhány percet.",
    "Too many attempts. Please wait a few minutes.",
  ],
  [
    "Az időpontok betöltése nem sikerült.",
    "Failed to load available time slots.",
  ],
  [
    "Az időpont zárolása nem sikerült.",
    "Failed to lock the selected time slot.",
  ],
  ["A zárolás létrehozása nem sikerült.", "Failed to create booking lock."],
  [
    "Az időzárolás lejárt. Kérlek, válassz új időpontot.",
    "Your time lock has expired. Please select a new time slot.",
  ],
  [
    "A foglalás előtt erősítsd meg a megadott e-mail-címet.",
    "Please verify your email address before confirming the booking.",
  ],
  [
    "A kód érvénytelen vagy lejárt. Ellenőrizd, majd próbáld újra.",
    "The verification code is invalid or expired. Please check it and try again.",
  ],
  [
    "Az e-mail-megerősítő kód küldése nem sikerült. Próbáld újra később.",
    "Failed to send verification code. Please try again later.",
  ],
  [
    "A foglalás véglegesítése nem sikerült.",
    "Failed to finalize the booking.",
  ],
  [
    "Online foglalás nem elérhető, kérjük, vegye fel a kapcsolatot telefonon a szolgáltatóval.",
    "Online booking is unavailable. Please contact the provider by phone.",
  ],
  [
    "A kiválasztott időpont időközben betelt vagy zárolásra került. Kérjük, válassz másik időpontot!",
    "The selected time slot has just been booked or locked. Please choose another time!",
  ],
  [
    "A megadott egyedi adatok érvénytelenek.",
    "The supplied custom booking details are invalid.",
  ],
  [
    "Adj meg érvényes nevet és e-mail-címet.",
    "Please enter a valid name and email address.",
  ],
  [
    "Adj meg érvényes e-mail-címet és aktív időpont-zárolást.",
    "Please provide a valid email address and an active booking lock.",
  ],
  [
    "Az időpont lemondása nem sikerült.",
    "Failed to cancel the appointment.",
  ],
  [
    "Az időpont átütemezése nem sikerült.",
    "Failed to reschedule the appointment.",
  ],
  ["Érvénytelen lemondási azonosító.", "Invalid cancellation token."],
  [
    "A foglalás nem található vagy már korábban le lett mondva.",
    "Booking not found or already cancelled.",
  ],
  [
    "A foglalás nem található vagy már le lett mondva.",
    "Booking not found or already cancelled.",
  ],
  [
    "A kiválasztott új időpont sajnos már foglalt. Kérjük, válassz másik időpontot!",
    "Unfortunately, the selected new time slot is already booked. Please choose another time!",
  ],
  [
    "Az új időpontnak a jövőben kell lennie (legalább 1 órával később).",
    "The new appointment time must be in the future (at least 1 hour from now).",
  ],
  [
    "A kiválasztott időpont nyitvatartási időn kívül esik, vagy nem érvényes idősáv.",
    "The selected time is outside business hours or not a valid time slot.",
  ],
  [
    "Adj meg érvényes azonosítót és új kezdési időpontot.",
    "Please provide a valid identifier and new start time.",
  ],
  ["A szolgáltató nem található.", "Provider not found."],
  [
    "A kiválasztott szolgáltató vagy szolgáltatás nem érhető el.",
    "The selected provider or service is unavailable.",
  ],
  [
    "Az elérhetőségek nem tölthetők be.",
    "Could not load availability.",
  ],
  [
    "Érvénytelen szolgáltatás vagy dátum.",
    "Invalid service or date.",
  ],
  ["A hét kezdőnapja érvénytelen.", "The requested week start date is invalid."],
  [
    "A foglalás zárolása lejárt vagy érvénytelen. Kérlek, válassz új időpontot!",
    "Your booking lock has expired or is invalid. Please select a new time slot!",
  ],
];

const HU_TO_EN_MAP = new Map(HU_TO_EN_EXACT);
const EN_TO_HU_MAP = new Map<string, string>();
for (const [hu, en] of HU_TO_EN_EXACT) {
  if (!EN_TO_HU_MAP.has(en)) {
    EN_TO_HU_MAP.set(en, hu);
  }
}

const REASON_HU_TO_EN: Array<[string, string]> = [
  [
    "A kiválasztott idősáv blokkolva van (zárvatartás / szabadság van érvényben).",
    "The selected time slot is blocked (time-off / closure in effect).",
  ],
  [
    "A kiválasztott idősáv blokkolva van (zárvatartás / szabadság).",
    "The selected time slot is blocked (time-off / closure).",
  ],
  [
    "A kiválasztott időpont már foglalt (minden párhuzamos szál betelt).",
    "The selected time slot is already booked (all concurrent threads are occupied).",
  ],
  [
    "A kiválasztott idősávban nincs szabad kapacitás (a szabadságon lévő szálak mellett a maradék helyek már foglaltak).",
    "No free capacity in this time slot (remaining threads alongside staff leave are already booked).",
  ],
  [
    "A kiválasztott idősávban nincs szabad kapacitás (a meglévő foglalások és a szabadságon lévő szálak miatt minden hely betelt).",
    "No free capacity in this time slot (all threads are occupied by bookings and staff leave).",
  ],
  [
    "A kiválasztott munkatársnak ebben az idősávban már van másik foglalása.",
    "The selected staff member already has another booking in this time slot.",
  ],
  [
    "A kiválasztott idősáv blokkolva van (zárvatartás / szabadság), vagy az időpont már foglalt.",
    "The selected time slot is blocked or already booked.",
  ],
  [
    "Az időszak ütközik egy aktív foglalással (nem maradna elég szabad szál a meglévő foglalásokhoz).",
    "The time range conflicts with an active booking (not enough free threads would remain).",
  ],
  [
    "A kiválasztott szolgáltatás inaktív vagy nem található.",
    "The selected service is inactive or not found.",
  ],
  [
    "Csak érvényes, jövőbeli időszak adható meg.",
    "Only a valid future time range can be entered.",
  ],
  [
    "Legalább egy nyitvatartási nap megadása kötelező.",
    "At least one valid opening day is required.",
  ],
  [
    "Az időszak ütközik egy aktív foglalással.",
    "The period conflicts with an active booking.",
  ],
];

const REASON_EN_MAP = new Map(REASON_HU_TO_EN);
const REASON_HU_MAP = new Map(REASON_HU_TO_EN.map(([hu, en]) => [en, hu]));

const DB_PREFIX_HU_TO_EN: Array<[string, string]> = [
  ["A kézi foglalás mentése nem sikerült", "Failed to save manual booking"],
  ["A blokkolás mentése nem sikerült", "Failed to save time-off"],
  ["A foglalás átütemezése nem sikerült", "Failed to reschedule booking"],
  ["A foglalás lemondása nem sikerült", "Failed to cancel booking"],
  ["A heti nyitvatartás mentése nem sikerült", "Failed to save business hours"],
  ["A szolgáltatás létrehozása nem sikerült", "Failed to create service"],
  ["A szolgáltatás mentése nem sikerült", "Failed to save service"],
  ["A szolgáltatás elrejtése nem sikerült", "Failed to hide service"],
  ["A szolgáltatás aktiválása nem sikerült", "Failed to activate service"],
  ["A munkatárs hozzáadása nem sikerült", "Failed to add staff member"],
  ["A munkatárs frissítése nem sikerült", "Failed to update staff member"],
  ["A munkatárs törlése nem sikerült", "Failed to delete staff member"],
  ["Az ügyféljegyzet mentése nem sikerült", "Failed to save customer note"],
  ["A foglalás No-Show megjelölése nem sikerült", "Failed to mark booking as No-Show"],
  ["A feketelistára helyezés nem sikerült", "Failed to add customer to blacklist"],
  ["A feketelistás bejegyzés mentése nem sikerült", "Failed to save blacklist entry"],
  ["A feketelistás tiltás törlése nem sikerült", "Failed to remove blacklist block"],
  ["A kapacitás és lemondási szabályzat mentése nem sikerült", "Failed to save capacity & cancellation policy"],
  ["Az integrációs beállítások mentése nem sikerült", "Failed to save integration settings"],
];

const DB_PREFIX_EN_MAP = new Map(DB_PREFIX_HU_TO_EN);
const DB_PREFIX_HU_MAP = new Map(DB_PREFIX_HU_TO_EN.map(([hu, en]) => [en, hu]));

const HU_TO_EN_PATTERNS: Array<[RegExp, (...args: string[]) => string]> = [
  [
    /^A művelethez platform-admin jogosultság szükséges \(jelenleg a\(z\) (.+?) fiók van bejelentkezve ebben a böngészőben – jelentkezz ki, vagy a teszt-szolgáltatót inkognitó ablakban nyisd meg!\)\.$/,
    (_m, email) =>
      `Platform admin privileges are required (currently signed in as ${email} in this browser — sign out or open test providers in an incognito window!).`,
  ],
  [
    /^A\(z\) (.+?) szolgáltató létrejött\.$/,
    (_m, name) => `Provider ${name} has been created.`,
  ],
  [
    /^A kapcsolattartó meghívása nem sikerült: (.+)$/,
    (_m, reason) => `Failed to invite contact user: ${reason}`,
  ],
  [
    /^(\d+) órán belüli időpont online már nem mondható le\. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!$/,
    (_m, hours) =>
      `Appointments within ${hours} hours can no longer be cancelled online. Please contact the provider directly by phone!`,
  ],
  [
    /^(\d+) órán belüli időpont online már nem ütemezhető át\. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!$/,
    (_m, hours) =>
      `Appointments within ${hours} hours can no longer be rescheduled online. Please contact the provider directly by phone!`,
  ],
  [
    /^Google Naptár szinkron kész: (\d+) külső esemény blokkolva\.$/,
    (_m, count) =>
      `Google Calendar sync complete: ${count} external events blocked.`,
  ],
  [
    /^A külső naptár letöltése nem sikerült \(HTTP (\d+)\)\.$/,
    (_m, status) => `Failed to download external calendar (HTTP ${status}).`,
  ],
  [
    /^Az e-mail-megerősítő kód küldése nem sikerült: (.+)$/,
    (_m, reason) => `Failed to send email verification code: ${reason}`,
  ],
  [
    /^A sorrend mentése nem sikerült: (.+)$/,
    (_m, reason) => `Failed to save service order: ${reason}`,
  ],
];

const EN_TO_HU_PATTERNS: Array<[RegExp, (...args: string[]) => string]> = [
  [
    /^Platform admin privileges are required \(currently signed in as (.+?) in this browser — sign out or open test providers in an incognito window!\)\.$/,
    (_m, email) =>
      `A művelethez platform-admin jogosultság szükséges (jelenleg a(z) ${email} fiók van bejelentkezve ebben a böngészőben – jelentkezz ki, vagy a teszt-szolgáltatót inkognitó ablakban nyisd meg!).`,
  ],
  [
    /^Provider (.+?) has been created\.$/,
    (_m, name) => `A(z) ${name} szolgáltató létrejött.`,
  ],
  [
    /^Failed to invite contact user: (.+)$/,
    (_m, reason) => `A kapcsolattartó meghívása nem sikerült: ${reason}`,
  ],
  [
    /^Appointments within (\d+) hours can no longer be cancelled online\. Please contact the provider directly by phone!$/,
    (_m, hours) =>
      `${hours} órán belüli időpont online már nem mondható le. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!`,
  ],
  [
    /^Appointments within (\d+) hours can no longer be rescheduled online\. Please contact the provider directly by phone!$/,
    (_m, hours) =>
      `${hours} órán belüli időpont online már nem ütemezhető át. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!`,
  ],
  [
    /^Google Calendar sync complete: (\d+) external events blocked\.$/,
    (_m, count) =>
      `Google Naptár szinkron kész: ${count} külső esemény blokkolva.`,
  ],
  [
    /^Failed to download external calendar \(HTTP (\d+)\)\.$/,
    (_m, status) => `A külső naptár letöltése nem sikerült (HTTP ${status}).`,
  ],
  [
    /^Failed to send email verification code: (.+)$/,
    (_m, reason) => `Az e-mail-megerősítő kód küldése nem sikerült: ${reason}`,
  ],
  [
    /^Failed to save service order: (.+)$/,
    (_m, reason) => `A sorrend mentése nem sikerült: ${reason}`,
  ],
];

/**
 * Translates static and dynamic application messages (including Server Action
 * and API errors) between Hungarian and English.
 */
export function translateDynamicText(text: string, targetLocale: Locale): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const exactMap = targetLocale === "en" ? HU_TO_EN_MAP : EN_TO_HU_MAP;
  const exactHit = exactMap.get(trimmed);
  if (exactHit) return exactHit;

  if (targetLocale === "en") {
    for (const [huPrefix, enPrefix] of DB_PREFIX_HU_TO_EN) {
      if (trimmed === `${huPrefix}. Kérlek, próbáld újra.`) {
        return `${enPrefix}. Please try again.`;
      }
      if (trimmed.startsWith(`${huPrefix}: `)) {
        const rest = trimmed.slice(huPrefix.length + 2);
        const enRest = REASON_EN_MAP.get(rest) ?? rest;
        return `${enPrefix}: ${enRest}`;
      }
    }
    for (const [pattern, formatter] of HU_TO_EN_PATTERNS) {
      const match = pattern.exec(trimmed);
      if (match) {
        return formatter(...match);
      }
    }
  } else {
    for (const [enPrefix, huPrefix] of DB_PREFIX_HU_MAP) {
      if (trimmed === `${enPrefix}. Please try again.`) {
        return `${huPrefix}. Kérlek, próbáld újra.`;
      }
      if (trimmed.startsWith(`${enPrefix}: `)) {
        const rest = trimmed.slice(enPrefix.length + 2);
        const huRest = REASON_HU_MAP.get(rest) ?? rest;
        return `${huPrefix}: ${huRest}`;
      }
    }
    for (const [pattern, formatter] of EN_TO_HU_PATTERNS) {
      const match = pattern.exec(trimmed);
      if (match) {
        return formatter(...match);
      }
    }
  }

  return text;
}

function translateDomTree(root: Node, targetLocale: Locale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue ?? "";
    const trimmed = raw.trim();
    if (trimmed) {
      const replacement = translateDynamicText(trimmed, targetLocale);
      if (replacement !== trimmed) {
        node.nodeValue = raw.replace(trimmed, replacement);
      }
    }
    node = walker.nextNode();
  }
}

let hasTranslatedDomOnce = false;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { locale } = useLanguage();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "hu") {
        setLocale(saved);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    // Skip DOM text mutation on initial Hungarian SSR hydration to avoid mismatched React text nodes.
    if (locale === "hu" && !hasTranslatedDomOnce) {
      return;
    }

    let isTranslating = false;
    const runTranslation = () => {
      if (isTranslating || !document.body) return;
      isTranslating = true;
      try {
        hasTranslatedDomOnce = true;
        translateDomTree(document.body, locale);
      } finally {
        isTranslating = false;
      }
    };

    const rafId = window.requestAnimationFrame(runTranslation);

    if (locale !== "en" || typeof MutationObserver === "undefined" || !document.body) {
      return () => window.cancelAnimationFrame(rafId);
    }

    const observer = new MutationObserver(() => {
      if (isTranslating) return;
      observer.disconnect();
      try {
        runTranslation();
      } finally {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [locale]);

  return <>{children}</>;
}
