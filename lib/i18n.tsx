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
    t: (hu: string, en: string) => (locale === "en" ? en : hu),
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
  [
    "Jelentkezz be a foglalások és a műhely szüneteinek kezeléséhez.",
    "Sign in to manage bookings and workshop time-offs.",
  ],
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
  ["Platform admin", "Platform Admin"],
  ["SaaS áttekintő", "SaaS Overview"],
  [
    "Tenantok, felhasználók és szolgáltatáscsomagok kezelése.",
    "Manage tenants, users, and subscription plans.",
  ],
  ["Regisztrált előfizetők", "Registered Subscribers"],
  ["Aktív és jóváhagyásra váró tenantok", "Active and pending tenants"],
  ["Regisztrált felhasználók", "Registered Users"],
  ["Supabase Auth-fiókok", "Supabase Auth accounts"],
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
];

const HU_TO_EN_MAP = new Map(HU_TO_EN_EXACT);
const EN_TO_HU_MAP = new Map(
  HU_TO_EN_EXACT.map(([hu, en]): [string, string] => [en, hu]),
);

function translateDomTree(root: Node, targetLocale: Locale) {
  const dictionary = targetLocale === "en" ? HU_TO_EN_MAP : EN_TO_HU_MAP;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue ?? "";
    const trimmed = raw.trim();
    if (trimmed) {
      const replacement = dictionary.get(trimmed);
      if (replacement) {
        node.nodeValue = raw.replace(trimmed, replacement);
      }
    }
    node = walker.nextNode();
  }
}

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
    translateDomTree(document.body, locale);
  }, [locale]);

  return <>{children}</>;
}
