"use client";

import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n";

const FEATURE_KEYS = [
  {
    icon: "01",
    huTitle: "24/7 Online Foglalás & OTP Védelem",
    enTitle: "24/7 Online Booking & OTP Protection",
    huDesc:
      "Valós idejű szabad idősávok, e-mailes egyszeri kódos hitelesítés és automatikus munkamenet-mentés Instagram/Facebook belső böngészőkben is.",
    enDesc:
      "Real-time available slots, email OTP verification, and automatic session recovery inside Instagram/Facebook in-app browsers.",
  },
  {
    icon: "02",
    huTitle: "Több Munkatárs & Párhuzamos Szálak",
    enTitle: "Multi-Staff & Parallel Capacity",
    huDesc:
      "Állítsd be, hány munkaállomás vagy szakember tud egyszerre ügyfeleket fogadni (1–50 párhuzamos szál), egyedi színkódolt naptárral.",
    enDesc:
      "Configure how many workstations or team members can serve clients simultaneously (1–50 parallel slots) with a color-coded schedule.",
  },
  {
    icon: "03",
    huTitle: "Vizuális Naptár & Kézi Gyorsfoglalás",
    enTitle: "Visual Calendar & Walk-In Entry",
    huDesc:
      "Átlátható napi/heti naptárnézet, 1 kattintásos átütemezés, ideiglenes zárvatartás és azonnali telefonos/helyszíni rögzítés OTP nélkül.",
    enDesc:
      "Clean daily/weekly calendar grid, one-click rescheduling, temporary blockouts, and instant phone/walk-in booking without OTP.",
  },
  {
    icon: "04",
    huTitle: "Kétirányú Google & Apple Naptár Szinkron",
    enTitle: "Two-Way Google & Apple Calendar Sync",
    huDesc:
      "Élő .ics naptár-előfizetés kifelé és bejövő privát események beolvasása befelé, plusz ügyfélbarát naptárfájl minden visszaigazolásban.",
    enDesc:
      "Outbound live .ics feed subscription plus inbound personal calendar blocking, with calendar attachments on every confirmation.",
  },
  {
    icon: "05",
    huTitle: "Automatikus Emlékeztető & Google Értékelés",
    enTitle: "Auto Reminders & Google Review Boost",
    huDesc:
      "24 órás automatikus emlékeztető, testreszabható online lemondási/átütemezési határidő és időpont utáni 1 kattintásos Google-értékeléskérő.",
    enDesc:
      "Automated 24-hour reminders, configurable online cancel/reschedule window, and post-visit 1-click Google review requests.",
  },
  {
    icon: "06",
    huTitle: "Mini-CRM, Feketelista & CSV Export",
    enTitle: "Mini-CRM, Blacklist & CSV Export",
    huDesc:
      "Privát szervizkönyv/vendégkarton jegyzetek, No-Show blokkoló feketelista, havi bevételi analitika és Excel-kompatibilis könyvelési export.",
    enDesc:
      "Private client service notes, automated no-show blacklist protection, monthly revenue analytics, and Excel-ready CSV export.",
  },
];

export default function Home() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm">
              IF
            </span>
            <span className="text-base font-bold tracking-tight text-white">
              {t("Időpontfoglaló SaaS", "BookingFlow SaaS")}
            </span>
          </div>
          <nav className="flex items-center gap-3 sm:gap-5">
            <a
              className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
              href="#features"
            >
              {t("Funkciók", "Features")}
            </a>
            <a
              className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:inline"
              href="#pricing"
            >
              {t("Csomagok", "Pricing")}
            </a>
            <LanguageSwitcher variant="dark" />
            <Link
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500"
              href="/dashboard/login"
            >
              {t("Szolgáltatói belépés", "Provider Login")}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
        <div className="mx-auto max-w-5xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
            {t(
              "Modern online időpontfoglaló rendszer",
              "Modern Online Appointment Scheduling",
            )}
          </p>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl">
            {t(
              "Kevesebb telefon, nulla dupla foglalás, több visszatérő ügyfél.",
              "Fewer phone calls, zero double bookings, more returning clients.",
            )}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            {t(
              "Kulcsrakész online foglalási felület és digitális naptár szervizeknek, szalonoknak, rendelőknek és tanácsadóknak – saját márkás foglalóoldallal, párhuzamos kapacitáskezeléssel és automatizált emlékeztetőkkel.",
              "Turnkey online booking page and digital calendar for workshops, salons, clinics, and consultants—with branded booking links, parallel capacity control, and automated reminders.",
            )}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link
              className="rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500"
              href="/dashboard/login"
            >
              {t("Szolgáltatói belépés", "Provider Login")}
            </Link>
            <a
              className="rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              href="#pricing"
            >
              {t("Csomagok és funkciók", "View Plans & Features")}
            </a>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="border-t border-white/10 bg-slate-900/50 px-5 py-20 sm:px-8" id="features">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">
              {t("Miért választják a szolgáltatók?", "Built for real service businesses")}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t(
                "Minden egy helyen a naptártól az ügyfélkezelésig",
                "Everything from calendar grid to Mini-CRM in one place",
              )}
            </h2>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_KEYS.map((item) => (
              <article
                className="rounded-2xl border border-white/10 bg-slate-950/70 p-6 transition hover:border-blue-500/40"
                key={item.icon}
              >
                <span className="inline-flex rounded-lg bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-300">
                  {item.icon}
                </span>
                <h3 className="mt-4 text-lg font-bold text-white">
                  {t(item.huTitle, item.enTitle)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {t(item.huDesc, item.enDesc)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing / Packages */}
      <section className="border-t border-white/10 px-5 py-20 sm:px-8" id="pricing">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-400">
              {t("Átlátható csomagok", "Clear Two-Tier SaaS Model")}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t(
                "Alap (Starter) vagy Prémium (Pro)",
                "Starter vs. Premium (Pro)",
              )}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400">
              {t(
                "Kezdj az Alap csomaggal a gyors online foglaláshoz, vagy válts Prémiumra a teljes automatizáláshoz és ügyfélvédelemhez.",
                "Start with the Starter tier for fast online booking, or upgrade to Pro for full automation and no-show protection.",
              )}
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {/* Starter Plan */}
            <article className="flex flex-col justify-between rounded-3xl border border-white/15 bg-slate-900/60 p-8">
              <div>
                <span className="inline-block rounded-full bg-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-200">
                  Alap (Starter)
                </span>
                <h3 className="mt-4 text-2xl font-bold text-white">
                  {t("Stabil online foglalási alap", "Essential Online Booking")}
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  {t(
                    "Ideális induló vállalkozásoknak és egyéni szakembereknek.",
                    "Ideal for solo providers and growing service shops.",
                  )}
                </p>
                <ul className="mt-6 space-y-3 text-sm text-slate-200">
                  <li>✓ {t("Saját márkás publikus foglalóoldal (/ceg-nev)", "Branded public booking page (/your-slug)")}</li>
                  <li>✓ {t("Önálló szolgáltatás- és árkezelés a Dashboardon", "Full service & price management on Dashboard")}</li>
                  <li>✓ {t("Kézi telefonos / helyszíni foglalás OTP nélkül", "Manual phone/walk-in booking entry without OTP")}</li>
                  <li>✓ {t("Párhuzamos kapacitás (több egyidejű munkaszál)", "Configurable parallel booking capacity")}</li>
                  <li>✓ {t("In-App Browser (IG/FB) munkamenet-védelem", "In-App Browser (IG/FB) session recovery")}</li>
                  <li>✓ {t("Vizuális naptár, munkaidő és zárvatartás", "Visual calendar, business hours & blockouts")}</li>
                </ul>
              </div>
              <Link
                className="mt-8 block rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-white/10"
                href="/dashboard/login"
              >
                {t("Belépés szolgáltatóknak", "Sign in to Dashboard")}
              </Link>
            </article>

            {/* Pro Plan */}
            <article className="flex flex-col justify-between rounded-3xl border border-blue-500/60 bg-gradient-to-b from-blue-950/60 to-slate-900/90 p-8 shadow-xl shadow-blue-950/30">
              <div>
                <span className="inline-block rounded-full bg-blue-600 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
                  Prémium (Pro)
                </span>
                <h3 className="mt-4 text-2xl font-bold text-white">
                  {t("Teljes automatizmus és növekedés", "Full Automation & Growth")}
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  {t(
                    "Minden Alap funkció, plusz professzionális megtartási és szinkron eszközök.",
                    "Everything in Starter, plus automated retention and sync tools.",
                  )}
                </p>
                <ul className="mt-6 space-y-3 text-sm text-slate-100">
                  <li>★ {t("Egyedi foglalási kérdések (pl. Rendszám, Hajhossz)", "Custom booking fields (e.g. License plate, Notes)")}</li>
                  <li>★ {t("Automatikus 24 órás emlékeztető e-mail", "Automated 24-hour email reminders")}</li>
                  <li>★ {t("Ügyféloldali online lemondás és átütemezés egyedi időkorláttal", "Self-service online cancellation & reschedule with custom cutoff")}</li>
                  <li>★ {t("Mini-CRM: Ügyféltörténet és privát belső szervizkönyv", "Mini-CRM: Client history & private internal notes")}</li>
                  <li>★ {t("No-Show jelölés és Feketelista blokkoló", "No-Show tracking & Blacklist protection")}</li>
                  <li>★ {t("Kétirányú Google/Apple naptár (.ics), Google Értékeléskérő & CSV export", "Two-way calendar sync, Google Review emails & CSV export")}</li>
                </ul>
              </div>
              <Link
                className="mt-8 block rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-blue-500"
                href="/dashboard/login"
              >
                {t("Kezdés a Prémium rendszerrel", "Open Provider Portal")}
              </Link>
            </article>
          </div>
        </div>
      </section>

      {/* Onboarding & Footer */}
      <footer className="border-t border-white/10 bg-slate-950 px-5 py-12 text-sm text-slate-400 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold text-white">
              {t("Új szolgáltató beiktatása percek alatt", "Onboard your business in minutes")}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t(
                "Minden partner saját publikus linket (pl. /ceg-nev) és védett admin felületet kap.",
                "Each provider gets a dedicated booking link (/your-company) and secure dashboard.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
            <Link className="text-slate-300 hover:text-white" href="/dashboard/login">
              {t("Szolgáltatói belépés", "Provider Login")}
            </Link>
            <Link className="text-slate-300 hover:text-white" href="/superadmin">
              {t("Platform Admin", "Platform Admin")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
