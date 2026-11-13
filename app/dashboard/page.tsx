import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signOutAction } from "./actions";
import BlockoutManager from "./BlockoutManager";
import BookingActionsControl, { type StaffOption } from "./BookingActionsControl";
import BusinessHoursManager from "./BusinessHoursManager";
import ManualBookingManager from "./ManualBookingManager";
import PremiumFeaturesSection, {
  type AuditLogItem,
  type BlacklistEntryItem,
  type CustomerHistorySummary,
  type CustomerNoteItem,
  type MonthlyPremiumStats,
} from "./PremiumFeaturesSection";
import StaffManager from "./StaffManager";
import TenantServiceManager from "./TenantServiceManager";
import VisualCalendarView from "./VisualCalendarView";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

interface DashboardPageProps {
  searchParams: Promise<{ company?: string }>;
}

type DashboardIconName = "dashboard" | "calendar" | "clock" | "wrench" | "logout";

function DashboardIcon({
  name,
  className = "size-5",
}: {
  name: DashboardIconName;
  className?: string;
}) {
  const paths: Record<DashboardIconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    wrench: (
      <>
        <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 13l-3-3z" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function DashboardShell({
  email,
  children,
  canManageServices = false,
}: {
  email: string;
  children: ReactNode;
  canManageServices?: boolean;
}) {
  const navigation = [
    { href: "#overview", label: "Áttekintés", icon: "dashboard" as const },
    { href: "#bookings", label: "Foglalások", icon: "calendar" as const },
    { href: "#settings", label: "Nyitvatartás", icon: "clock" as const },
    { href: "#blockouts", label: "Zárvatartás", icon: "wrench" as const },
    ...(canManageServices
      ? [{ href: "#services", label: "Szolgáltatások", icon: "wrench" as const }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <a
          className="flex h-20 items-center gap-3 border-b border-slate-100 px-6"
          href="#overview"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-blue-700 text-white shadow-sm">
            <DashboardIcon name="wrench" />
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-950">
              Időpontfoglaló
            </span>
            <span className="block text-xs text-slate-500">Műhely admin</span>
          </span>
        </a>
        <nav aria-label="Fő navigáció" className="flex-1 space-y-1 px-3 py-6">
          {navigation.map((item, index) => (
            <a
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${
                index === 0
                  ? "bg-blue-50 text-blue-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
              href={item.href}
              key={item.href}
            >
              <DashboardIcon
                className="size-5 shrink-0"
                name={item.icon}
              />
              {item.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-800">
              {email.slice(0, 1).toUpperCase() || "U"}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800">
                Bejelentkezve
              </span>
              <span className="block truncate text-xs text-slate-500">{email}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white md:hidden">
              <DashboardIcon className="size-4" name="wrench" />
            </span>
            <p className="truncate text-sm font-semibold text-slate-800 md:hidden">
              Műhely admin
            </p>
            <p className="hidden truncate text-sm text-slate-500 md:block">
              {email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <form action={signOutAction}>
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                type="submit"
              >
                <DashboardIcon className="size-4" name="logout" />
                <span className="hidden sm:inline">Kijelentkezés</span>
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-7xl px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-10 lg:px-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="Mobil navigáció"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-slate-200 bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur md:hidden"
      >
        {navigation.map((item, index) => (
          <a
            className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${
              index === 0 ? "text-blue-700" : "text-slate-500"
            }`}
            href={item.href}
            key={item.href}
          >
            <DashboardIcon className="size-5" name={item.icon} />
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function getLocalDateKey(value: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    })
      .formatToParts(value)
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function getBookingExtraDetails(booking: {
  custom_fields: unknown;
  jarmu_marka: string | null;
  jarmu_modell: string | null;
  jarmu_rendszam: string | null;
}, fieldLabels: Map<string, string>) {
  if (
    booking.custom_fields &&
    typeof booking.custom_fields === "object" &&
    !Array.isArray(booking.custom_fields)
  ) {
    const values = Object.entries(booking.custom_fields).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
    );
    if (values.length) {
      return values.map(
        ([key, value]) => `${fieldLabels.get(key) ?? key}: ${value}`,
      );
    }
  }

  return [
    [booking.jarmu_marka, booking.jarmu_modell].filter(Boolean).join(" "),
    booking.jarmu_rendszam,
  ].filter((value): value is string => Boolean(value));
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  color,
}: {
  label: string;
  value: number;
  detail: string;
  icon: DashboardIconName;
  color: string;
}) {
  return (
    <article className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
            {value}
          </p>
        </div>
        <span
          className={`flex size-11 items-center justify-center rounded-xl ${color}`}
        >
          <DashboardIcon name={icon} />
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  await connection();

  if (!getSupabasePublicConfig()) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-12 sm:px-6">
        <section className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-white p-8 shadow-sm sm:p-10">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
            <DashboardIcon name="wrench" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-slate-950">
            Szolgáltatói dashboard
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            A dashboard használatához állítsd be a Supabase környezeti
            változókat.
          </p>
        </section>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/dashboard/login");

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select(
      "id, nev, slug, status, plan, time_zone, can_manage_services, can_edit_prices, can_manage_services_advanced, custom_booking_fields, nyitvatartas_kezdet, nyitvatartas_vege, google_review_url, calendar_feed_token, external_calendar_ics_url, external_calendar_last_synced_at, max_concurrent_bookings, cancellation_window_hours",
    )
    .eq("owner_id", userData.user.id);

  if (companiesError) throw new Error(`Cégek betöltése nem sikerült: ${companiesError.message}`);

  if (!companies?.length) {
    return (
      <DashboardShell email={userData.user.email ?? ""}>
        <section
          className="mx-auto mt-8 max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12"
          id="overview"
        >
          <span className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <DashboardIcon className="size-7" name="wrench" />
          </span>
          <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-700">
            Kezdjük az alapokkal
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Még nincs szolgáltatód
          </h1>
          <p className="mt-3 max-w-xl leading-7 text-slate-600">
            Ehhez a felhasználóhoz nem tartozik szolgáltató. A kezdeti
            prototípusban a platform-admin hozza létre vagy hagyja jóvá a céget.
          </p>
          <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-900">
            Amint a szolgáltató elkészült, itt kezelheted a foglalásokat és a
            műhely szüneteit.
          </div>
        </section>
      </DashboardShell>
    );
  }

  const { company: requestedCompanyId } = await searchParams;
  const company =
    companies.find((item) => item.id === requestedCompanyId) ?? companies[0];
  const customFieldLabels = new Map<string, string>(
    (Array.isArray(company.custom_booking_fields)
      ? company.custom_booking_fields
      : []
    )
      .filter(
        (field: unknown): field is { key: string; label: string } =>
          Boolean(field) &&
          typeof field === "object" &&
          typeof (field as { key?: unknown }).key === "string" &&
          typeof (field as { label?: unknown }).label === "string",
      )
      .map((field: { key: string; label: string }) => [field.key, field.label]),
  );
  const now = new Date().toISOString();
  const [
    bookingsResult,
    blockoutsResult,
    servicesResult,
    businessHoursResult,
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, service_id, staff_id, ugyfel_nev, ugyfel_email, ugyfel_telefon, jarmu_marka, jarmu_modell, jarmu_rendszam, custom_fields, kezdes_ideje, vege_ideje",
      )
      .eq("cég_id", company.id)
      .eq("status", "confirmed")
      .gte("kezdes_ideje", now)
      .order("kezdes_ideje", { ascending: true })
      .limit(50),
    supabase
      .from("manual_blockouts")
      .select("id, kezdes_ideje, vege_ideje, megjegyzes")
      .eq("cég_id", company.id)
      .gte("vege_ideje", now)
      .order("kezdes_ideje", { ascending: true })
      .limit(50),
    supabase
      .from("services")
      .select("id, nev, idotartam_percben, ar, display_order, leiras, is_active")
      .eq("cég_id", company.id),
    supabase
      .from("company_business_hours")
      .select("weekday, opens_at, closes_at")
      .eq("company_id", company.id)
      .order("weekday", { ascending: true }),
  ]);

  if (bookingsResult.error) {
    throw new Error(`Foglalások betöltése nem sikerült: ${bookingsResult.error.message}`);
  }
  if (blockoutsResult.error) {
    throw new Error(`Blokkolások betöltése nem sikerült: ${blockoutsResult.error.message}`);
  }
  if (servicesResult.error) {
    throw new Error(`Szolgáltatások betöltése nem sikerült: ${servicesResult.error.message}`);
  }
  if (businessHoursResult.error) {
    throw new Error(`Nyitvatartás betöltése nem sikerült: ${businessHoursResult.error.message}`);
  }
  const bookingIds = (bookingsResult.data ?? []).map((booking) => booking.id);
  const bookingServicesResult = bookingIds.length
    ? await supabase
        .from("booking_services")
        .select("booking_id, service_id, service_order")
        .eq("cég_id", company.id)
        .in("booking_id", bookingIds)
        .order("service_order", { ascending: true })
    : null;

  if (bookingServicesResult?.error) {
    throw new Error(`Foglalási szolgáltatások betöltése nem sikerült: ${bookingServicesResult.error.message}`);
  }

  const serviceNames = new Map(
    (servicesResult.data ?? []).map((service) => [service.id, service.nev]),
  );
  const serviceNamesByBooking = new Map<string, string[]>();
  for (const item of bookingServicesResult?.data ?? []) {
    const serviceName = serviceNames.get(item.service_id);
    if (!serviceName) continue;

    const names = serviceNamesByBooking.get(item.booking_id) ?? [];
    names.push(serviceName);
    serviceNamesByBooking.set(item.booking_id, names);
  }
  const timeZone = company.time_zone || "Europe/Budapest";
  const companyPlan = company.plan === "pro" ? "pro" : "starter";
  const canEditPrices = company.can_edit_prices !== false;
  const canManageServicesAdvanced =
    company.can_manage_services_advanced !== false;
  const bookings = bookingsResult.data ?? [];
  const blockouts = blockoutsResult.data ?? [];
  const today = getLocalDateKey(new Date(), timeZone);
  const lastDayOfWeek = addDays(today, 6);
  const bookingsToday = bookings.filter(
    (booking) => getLocalDateKey(new Date(booking.kezdes_ideje), timeZone) === today,
  ).length;
  const bookingsThisWeek = bookings.filter((booking) => {
    const bookingDay = getLocalDateKey(new Date(booking.kezdes_ideje), timeZone);
    return bookingDay >= today && bookingDay <= lastDayOfWeek;
  }).length;

  const servicePrices = new Map(
    (servicesResult.data ?? []).map((service) => [
      service.id,
      Number(service.ar) || 0,
    ]),
  );

  let monthlyStats: MonthlyPremiumStats = {
    confirmedCount: 0,
    expectedRevenueFt: 0,
    cancelledOrNoShowCount: 0,
    topServiceName: null,
  };
  let notesList: CustomerNoteItem[] = [];
  let blacklistEntries: BlacklistEntryItem[] = [];
  let customerHistory: CustomerHistorySummary[] = [];
  let staffMembers: StaffOption[] = [];
  let auditLogs: AuditLogItem[] = [];

  try {
    const staffRes = await supabase
      .from("company_staff")
      .select("id, name, role_title, email, color, is_active")
      .eq("company_id", company.id)
      .order("created_at", { ascending: true });
    if (Array.isArray(staffRes?.data)) {
      staffMembers = staffRes.data as StaffOption[];
    }
  } catch {
    staffMembers = [];
  }

  try {
    const auditRes = await supabase
      .from("audit_logs")
      .select("id, action, entity_type, created_at, details")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (Array.isArray(auditRes?.data)) {
      auditLogs = auditRes.data as AuditLogItem[];
    }
  } catch {
    auditLogs = [];
  }

  if (companyPlan === "pro") {
    const monthStartIso = `${today.slice(0, 7)}-01T00:00:00.000Z`;
    const [monthlyBookingsRes, notesRes, blacklistRes] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, service_id, status, ugyfel_nev, ugyfel_email, ugyfel_telefon, kezdes_ideje",
        )
        .eq("cég_id", company.id)
        .gte("kezdes_ideje", monthStartIso)
        .in("status", ["confirmed", "cancelled", "no_show"])
        .order("kezdes_ideje", { ascending: false })
        .limit(300),
      supabase
        .from("customer_notes")
        .select(
          "id, customer_key, customer_name, customer_email, customer_phone, private_note, updated_at",
        )
        .eq("company_id", company.id)
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("company_blacklist")
        .select("id, email, phone, reason, created_at")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const monthlyBookings = monthlyBookingsRes.data ?? [];
    notesList = (notesRes.data ?? []) as CustomerNoteItem[];
    blacklistEntries = (blacklistRes.data ?? []) as BlacklistEntryItem[];

    const serviceCountMap = new Map<string, number>();
    let confirmedCount = 0;
    let expectedRevenueFt = 0;
    let cancelledOrNoShowCount = 0;

    for (const mb of monthlyBookings) {
      if (mb.status === "confirmed") {
        confirmedCount += 1;
        expectedRevenueFt += servicePrices.get(mb.service_id) ?? 0;
        const sName = serviceNames.get(mb.service_id);
        if (sName) {
          serviceCountMap.set(sName, (serviceCountMap.get(sName) ?? 0) + 1);
        }
      } else if (mb.status === "cancelled" || mb.status === "no_show") {
        cancelledOrNoShowCount += 1;
      }
    }

    let topServiceName: string | null = null;
    let topServiceCount = 0;
    for (const [sName, count] of serviceCountMap.entries()) {
      if (count > topServiceCount) {
        topServiceCount = count;
        topServiceName = sName;
      }
    }

    monthlyStats = {
      confirmedCount,
      expectedRevenueFt,
      cancelledOrNoShowCount,
      topServiceName,
    };

    const noteByKey = new Map(
      notesList.map((note) => [note.customer_key, note.private_note]),
    );
    const historyMap = new Map<string, CustomerHistorySummary>();
    for (const mb of monthlyBookings) {
      const emailKey = (mb.ugyfel_email ?? "").trim().toLowerCase();
      const phoneKey = (mb.ugyfel_telefon ?? "").replace(/[^0-9+]/g, "");
      const customerKey = emailKey || phoneKey;
      if (!customerKey) continue;

      const existing = historyMap.get(customerKey);
      if (existing) {
        existing.bookingsCount += 1;
      } else {
        historyMap.set(customerKey, {
          customerKey,
          customerName: mb.ugyfel_nev ?? "Ügyfél",
          customerEmail: mb.ugyfel_email ?? "",
          customerPhone: mb.ugyfel_telefon ?? "",
          bookingsCount: 1,
          lastBookingAt: mb.kezdes_ideje,
          privateNote: noteByKey.get(customerKey) ?? "",
        });
      }
    }
    customerHistory = Array.from(historyMap.values());
  }

  const companyStatusLabel =
    company.status === "active"
      ? "Aktív szolgáltató"
      : company.status === "pending"
        ? "Jóváhagyásra vár"
        : "Felfüggesztve";
  const companyStatusColor =
    company.status === "active"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : company.status === "pending"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-rose-50 text-rose-700 ring-rose-200";
  const companyStatusDotColor =
    company.status === "active"
      ? "bg-emerald-500"
      : company.status === "pending"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <DashboardShell
      canManageServices={canEditPrices || canManageServicesAdvanced}
      email={userData.user.email ?? ""}
    >
      <div className="space-y-8">
        <section
          className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"
          id="overview"
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-700">
              Szolgáltatói dashboard
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                {company.nev}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${companyStatusColor}`}
              >
                <span className={`size-1.5 rounded-full ${companyStatusDotColor}`} />
                {companyStatusLabel}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${
                  companyPlan === "pro"
                    ? "bg-violet-50 text-violet-800 ring-violet-200"
                    : "bg-slate-100 text-slate-700 ring-slate-200"
                }`}
              >
                {companyPlan === "pro"
                  ? "Prémium (Pro) csomag"
                  : "Alap (Starter) csomag"}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Nyilvános foglalási oldal:{" "}
              <a
                className="font-medium text-blue-700 hover:underline"
                href={`/${company.slug}`}
              >
                /{company.slug}
              </a>
            </p>
          </div>
        </section>

        <section aria-label="Foglalási összesítő" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            color="bg-blue-50 text-blue-700"
            detail="Visszaigazolt időpontok"
            icon="calendar"
            label="Mai foglalások"
            value={bookingsToday}
          />
          <MetricCard
            color="bg-violet-50 text-violet-700"
            detail="A következő hét napjára"
            icon="clock"
            label="Közelgő ezen a héten"
            value={bookingsThisWeek}
          />
          <MetricCard
            color="bg-amber-50 text-amber-700"
            detail="Közelgő, rögzített szünet"
            icon="wrench"
            label="Blokkolt időszakok"
            value={blockouts.length}
          />
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.85fr)]">
          <section
            className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"
            id="bookings"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-5 sm:px-6">
              <div>
                <h2 className="text-lg font-bold text-slate-950">
                  Közelgő foglalások
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  A következő 50 visszaigazolt időpont
                </p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                {bookings.length} időpont
              </span>
            </div>

            {!bookings.length ? (
              <div className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <DashboardIcon className="size-7" name="calendar" />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">
                  Még nincs közelgő foglalás
                </h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                  Amint egy ügyfél időpontot foglal, a részletek itt jelennek meg.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-6 py-3.5 font-semibold">Időpont</th>
                        <th className="px-6 py-3.5 font-semibold">Ügyfél</th>
                        <th className="px-6 py-3.5 font-semibold">Szolgáltatás</th>
                        <th className="px-6 py-3.5 font-semibold">Foglalási adatok</th>
                        <th className="px-6 py-3.5 font-semibold">Állapot</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bookings.map((booking) => (
                        <tr className="transition-colors hover:bg-slate-50/70" key={booking.id}>
                          <td className="whitespace-nowrap px-6 py-4 font-medium text-slate-800">
                            {formatDate(booking.kezdes_ideje, timeZone)}
                            <span className="mt-1 block text-xs font-normal text-slate-500">
                              –{" "}
                              {new Intl.DateTimeFormat("hu-HU", {
                                timeStyle: "short",
                                timeZone,
                              }).format(new Date(booking.vege_ideje))}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="block font-semibold text-slate-900">
                              {booking.ugyfel_nev || "Ügyfél"}
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">
                              {booking.ugyfel_email}
                            </span>
                            {booking.ugyfel_telefon && (
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {booking.ugyfel_telefon}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-slate-700">
                            {serviceNamesByBooking.get(booking.id)?.join(" + ") ||
                              serviceNames.get(booking.service_id) ||
                              "Szolgáltatás"}
                          </td>
                          <td className="px-6 py-4 text-slate-700">
                            {getBookingExtraDetails(booking, customFieldLabels).length
                              ? getBookingExtraDetails(booking, customFieldLabels).map((value) => (
                                  <span className="block" key={value}>{value}</span>
                                ))
                              : "—"}
                          </td>
                          <td className="px-6 py-4">
                            <BookingStatusBadge />
                            <BookingActionsControl
                              bookingId={booking.id}
                              companyId={company.id}
                              currentStaffId={(booking as { staff_id?: string | null }).staff_id ?? null}
                              staffOptions={staffMembers}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="space-y-3 p-4 md:hidden">
                  {bookings.map((booking) => (
                    <li
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                      key={booking.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-950">
                            {booking.ugyfel_nev || "Ügyfél"}
                          </p>
                          <p className="mt-1 text-sm font-medium text-blue-800">
                            {formatDate(booking.kezdes_ideje, timeZone)}
                          </p>
                        </div>
                        <BookingStatusBadge />
                      </div>
                      <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm">
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Szolgáltatás
                          </dt>
                          <dd className="mt-1 text-slate-700">
                            {serviceNamesByBooking.get(booking.id)?.join(" + ") ||
                              serviceNames.get(booking.service_id) ||
                              "Szolgáltatás"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Foglalási adatok
                          </dt>
                          <dd className="mt-1 text-slate-700">
                            {getBookingExtraDetails(booking, customFieldLabels).join(" · ") || "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Kapcsolat
                          </dt>
                          <dd className="mt-1 break-all text-slate-600">
                            {booking.ugyfel_email}
                          </dd>
                          {booking.ugyfel_telefon && (
                            <dd className="mt-0.5 text-slate-600">
                              {booking.ugyfel_telefon}
                            </dd>
                          )}
                        </div>
                      </dl>
                      <BookingActionsControl
                        bookingId={booking.id}
                        companyId={company.id}
                        currentStaffId={(booking as { staff_id?: string | null }).staff_id ?? null}
                        staffOptions={staffMembers}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <BlockoutManager
            blockouts={blockouts}
            companyId={company.id}
            timeZone={timeZone}
          />
        </div>
        <VisualCalendarView
          blockouts={blockouts.map((bl) => ({
            id: bl.id,
            startsAt: bl.kezdes_ideje,
            endsAt: bl.vege_ideje,
            note: bl.megjegyzes,
          }))}
          bookings={bookings.map((b) => ({
            id: b.id,
            customerName: b.ugyfel_nev || "Ügyfél",
            serviceName:
              serviceNamesByBooking.get(b.id)?.join(" + ") ||
              serviceNames.get(b.service_id) ||
              "Szolgáltatás",
            staffId: (b as { staff_id?: string | null }).staff_id ?? null,
            startsAt: b.kezdes_ideje,
            endsAt: b.vege_ideje,
          }))}
          staff={staffMembers}
          timeZone={timeZone}
          todayDate={today}
        />
        <ManualBookingManager
          companyId={company.id}
          services={servicesResult.data ?? []}
          timeZone={timeZone}
        />
        <StaffManager companyId={company.id} staff={staffMembers} />
        <BusinessHoursManager
          companyId={company.id}
          hours={businessHoursResult.data ?? []}
          key={company.id}
        />
        {(canEditPrices || canManageServicesAdvanced) && (
          <TenantServiceManager
            companyId={company.id}
            canEditPrices={canEditPrices}
            canManageServicesAdvanced={canManageServicesAdvanced}
            services={servicesResult.data ?? []}
            key={`${company.id}:${servicesResult.data?.map((service) => `${service.id}-${service.nev}-${service.idotartam_percben}-${service.ar}-${service.leiras}-${service.is_active}`).join(",")}`}
          />
        )}
        <PremiumFeaturesSection
          auditLogs={auditLogs}
          blacklist={blacklistEntries}
          calendarFeedToken={(company as { calendar_feed_token?: string | null }).calendar_feed_token ?? null}
          cancellationWindowHours={(company as { cancellation_window_hours?: number | null }).cancellation_window_hours ?? 24}
          companyId={company.id}
          customFieldsCount={customFieldLabels.size}
          customerHistory={customerHistory}
          externalCalendarIcsUrl={(company as { external_calendar_ics_url?: string | null }).external_calendar_ics_url ?? null}
          externalCalendarLastSyncedAt={(company as { external_calendar_last_synced_at?: string | null }).external_calendar_last_synced_at ?? null}
          googleReviewUrl={(company as { google_review_url?: string | null }).google_review_url ?? null}
          maxConcurrentBookings={(company as { max_concurrent_bookings?: number | null }).max_concurrent_bookings ?? 1}
          notes={notesList}
          plan={companyPlan}
          recentBookings={bookings.map((b) => ({
            id: b.id,
            ugyfel_nev: b.ugyfel_nev,
            ugyfel_email: b.ugyfel_email,
            ugyfel_telefon: b.ugyfel_telefon,
            kezdes_ideje: b.kezdes_ideje,
            status: "confirmed",
          }))}
          stats={monthlyStats}
        />
      </div>
    </DashboardShell>
  );
}

function BookingStatusBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Visszaigazolva
    </span>
  );
}
