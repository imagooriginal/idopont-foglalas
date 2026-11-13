"use client";

import { useActionState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  addBlacklistEntryAction,
  markBookingNoShowAction,
  removeBlacklistEntryAction,
  saveCustomerNoteAction,
  saveIntegrationsSettingsAction,
  saveProviderPolicyAction,
  syncExternalGoogleCalendarAction,
  type ActionState,
  type CompanyPlan,
} from "./actions";

export interface AuditLogItem {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
  details?: unknown;
}

export interface MonthlyPremiumStats {
  confirmedCount: number;
  expectedRevenueFt: number;
  cancelledOrNoShowCount: number;
  topServiceName: string | null;
}

export interface CustomerNoteItem {
  id: string;
  customer_key: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  private_note: string;
  updated_at: string;
}

export interface BlacklistEntryItem {
  id: string;
  email: string;
  phone: string;
  reason: string;
  created_at: string;
}

export interface CustomerHistorySummary {
  customerKey: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  bookingsCount: number;
  lastBookingAt: string;
  privateNote: string;
}

export interface RecentBookingForNoShow {
  id: string;
  ugyfel_nev: string | null;
  ugyfel_email: string | null;
  ugyfel_telefon: string | null;
  kezdes_ideje: string;
  status: string;
}

const initialState: ActionState = {};

function UpsellLockBanner() {
  const { t } = useLanguage();
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3.5 text-sm text-amber-950 shadow-xs">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-200/80 text-amber-900 font-bold">
          ★
        </span>
        <span className="font-semibold">
          {t(
            "Prémium (Pro) funkció – Kérd az adminisztrátortól a csomagváltást",
            "Premium (Pro) feature – Ask the administrator to upgrade your plan",
          )}
        </span>
      </div>
      <span className="rounded-full bg-amber-200/80 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-950">
        {t("Zárolva Alap csomagban", "Locked in Starter Plan")}
      </span>
    </div>
  );
}

const fallbackAction = async (): Promise<ActionState> => ({});

export default function PremiumFeaturesSection({
  companyId,
  plan,
  stats,
  customerHistory,
  notes,
  blacklist,
  recentBookings,
  customFieldsCount,
  calendarFeedToken,
  googleReviewUrl,
  externalCalendarIcsUrl,
  externalCalendarLastSyncedAt,
  cancellationWindowHours = 24,
  maxConcurrentBookings = 1,
  auditLogs = [],
}: {
  companyId: string;
  plan: CompanyPlan;
  stats: MonthlyPremiumStats;
  customerHistory: CustomerHistorySummary[];
  notes: CustomerNoteItem[];
  blacklist: BlacklistEntryItem[];
  recentBookings: RecentBookingForNoShow[];
  customFieldsCount: number;
  calendarFeedToken?: string | null;
  googleReviewUrl?: string | null;
  externalCalendarIcsUrl?: string | null;
  externalCalendarLastSyncedAt?: string | null;
  cancellationWindowHours?: number;
  maxConcurrentBookings?: number;
  auditLogs?: AuditLogItem[];
}) {
  const { t } = useLanguage();
  const isPro = plan === "pro";

  const [noteState, noteAction, notePending] = useActionState(
    saveCustomerNoteAction ?? fallbackAction,
    initialState,
  );
  const [blacklistState, blacklistAction, blacklistPending] = useActionState(
    addBlacklistEntryAction ?? fallbackAction,
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeBlacklistEntryAction ?? fallbackAction,
    initialState,
  );
  const [noShowState, noShowAction, noShowPending] = useActionState(
    markBookingNoShowAction ?? fallbackAction,
    initialState,
  );
  const [integrationsState, integrationsAction, integrationsPending] = useActionState(
    saveIntegrationsSettingsAction ?? fallbackAction,
    initialState,
  );
  const [syncState, syncAction, syncPending] = useActionState(
    syncExternalGoogleCalendarAction ?? fallbackAction,
    initialState,
  );
  const [policyState, policyAction, policyPending] = useActionState(
    saveProviderPolicyAction ?? fallbackAction,
    initialState,
  );

  return (
    <section className="space-y-6" id="premium-features">
      <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 border-b border-slate-100 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t("Foglalási szabályzat", "Booking Policy")}
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            {t(
              "Kapacitás és online lemondási határidő testreszabása",
              "Parallel Capacity & Online Cancellation Cutoff",
            )}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {t(
              "Állítsd be, hány párhuzamos időpont fogadható egy időben (hány munkatárs / munkaállomás dolgozik egyszerre), és hány órával az időpont előttig lehetséges az online lemondás/átütemezés.",
              "Configure how many concurrent bookings can overlap simultaneously and how many hours before the appointment online cancellation/rescheduling stays allowed.",
            )}
          </p>
        </div>

        <form action={policyAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
          <input name="companyId" type="hidden" value={companyId} />
          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            {t(
              "Lemondási / átütemezési határidő (óra, 0–168)",
              "Cancellation / reschedule cutoff (hours, 0–168)",
            )}
            <input
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal"
              defaultValue={cancellationWindowHours}
              max={168}
              min={0}
              name="cancellationWindowHours"
              required
              type="number"
            />
          </label>
          <label className="block space-y-1 text-xs font-semibold text-slate-700">
            {t(
              "Párhuzamosan futó szálak / munkatársak száma (1–50)",
              "Concurrent capacity / parallel workers (1–50)",
            )}
            <input
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal"
              defaultValue={maxConcurrentBookings}
              max={50}
              min={1}
              name="maxConcurrentBookings"
              required
              type="number"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <button
              className="h-10 rounded-xl bg-blue-700 px-4 text-xs font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
              disabled={policyPending}
              type="submit"
            >
              {policyPending
                ? t("Mentés...", "Saving...")
                : t("Szabályzat mentése", "Save Policy")}
            </button>
          </div>
          {policyState.error && (
            <p className="sm:col-span-2 lg:col-span-3 text-xs font-semibold text-red-600" role="alert">
              {policyState.error}
            </p>
          )}
          {policyState.success && (
            <p className="sm:col-span-2 lg:col-span-3 text-xs font-semibold text-emerald-700" role="status">
              {policyState.success}
            </p>
          )}
        </form>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 mb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
              {t("Prémium (Pro) modulok", "Premium (Pro) Modules")}
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              {t(
                "Havi statisztika, Mini-CRM, Feketelista és Automatizmusok",
                "Monthly Analytics, Mini-CRM, Blacklist & Automations",
              )}
            </h2>
          </div>
          <span
            className={`rounded-full px-3.5 py-1 text-xs font-bold ring-1 ${
              isPro
                ? "bg-violet-50 text-violet-800 ring-violet-200"
                : "bg-slate-100 text-slate-700 ring-slate-200"
            }`}
          >
            {isPro
              ? t("Prémium (Pro) csomag aktív", "Premium (Pro) Plan Active")
              : t("Alap (Starter) csomag", "Starter Plan")}
          </span>
        </div>

        {!isPro && <UpsellLockBanner />}

        {/* 1. Prémium Statisztika és Havi Összesítő */}
        <div className={isPro ? "" : "opacity-65 pointer-events-none select-none"}>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            {t("Havi pénzügyi és foglalási összesítő", "Monthly Financial & Booking Summary")}
          </h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-medium text-slate-500">
                {t("Havi visszaigazolt foglalások", "Monthly Confirmed Bookings")}
              </p>
              <p className="mt-2 text-2xl font-bold text-slate-950">
                {isPro ? stats.confirmedCount : "—"}
              </p>
            </article>
            <article className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="text-xs font-medium text-emerald-800">
                {t("Várható havi bevétel", "Expected Monthly Revenue")}
              </p>
              <p className="mt-2 text-2xl font-bold text-emerald-950">
                {isPro
                  ? `${stats.expectedRevenueFt.toLocaleString("hu-HU")} Ft`
                  : "— Ft"}
              </p>
            </article>
            <article className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
              <p className="text-xs font-medium text-rose-800">
                {t("Lemondott / No-Show", "Cancelled / No-Show")}
              </p>
              <p className="mt-2 text-2xl font-bold text-rose-950">
                {isPro ? stats.cancelledOrNoShowCount : "—"}
              </p>
            </article>
            <article className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <p className="text-xs font-medium text-violet-800">
                {t("Legnépszerűbb szolgáltatás", "Most Popular Service")}
              </p>
              <p className="mt-2 truncate text-lg font-bold text-violet-950">
                {isPro
                  ? stats.topServiceName ?? t("Még nincs adat", "No data yet")
                  : "—"}
              </p>
            </article>
          </div>

          {/* 2. Prémium Automatizmusok állapota */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {t("24 órás e-mail emlékeztető", "24h Email Reminder")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {isPro
                  ? t("Aktív (automatikus kiküldés)", "Active (automated delivery)")
                  : t("Prémium (Pro) funkció", "Premium (Pro) feature")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {t("Online lemondási link (24h korláttal)", "Online Cancellation Link (24h cutoff)")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {isPro
                  ? t("Benne van a visszaigazoló és emlékeztető e-mailben", "Included in confirmation & reminder emails")
                  : t("Prémium (Pro) funkció", "Premium (Pro) feature")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                {t("Dinamikus egyedi kérdések", "Dynamic Custom Fields")}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {isPro
                  ? `${customFieldsCount} ${t("aktív egyedi mező", "active custom fields")}`
                  : t("Prémium (Pro) funkció", "Premium (Pro) feature")}
              </p>
            </div>
          </div>

          {/* 3. Mini-CRM & Feketelista Grid */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Mini-CRM: Vendégkarton és Belső Jegyzetek */}
            <div className="rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-950">
                {t(
                  "Mini-CRM: Vendégkarton és Privát Belső Jegyzetek",
                  "Mini-CRM: Customer Card & Private Internal Notes",
                )}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  "Ezeket a privát jegyzeteket kizárólag a szolgáltató látja.",
                  "These private notes are visible only to the provider.",
                )}
              </p>

              <form action={noteAction} className="mt-4 space-y-3">
                <input name="companyId" type="hidden" value={companyId} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                    disabled={!isPro}
                    maxLength={100}
                    name="customerName"
                    placeholder={t("Vendég neve", "Customer name")}
                  />
                  <input
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                    disabled={!isPro}
                    maxLength={320}
                    name="customerEmail"
                    placeholder={t("E-mail-cím", "Email address")}
                    type="email"
                  />
                  <input
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                    disabled={!isPro}
                    maxLength={40}
                    name="customerPhone"
                    placeholder={t("Telefonszám", "Phone number")}
                  />
                </div>
                <textarea
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  disabled={!isPro}
                  maxLength={2000}
                  name="privateNote"
                  placeholder={t(
                    "Privát belső megjegyzés (pl. érzékeny bőr, kedvenc szolgáltatás, pontos érkező)...",
                    "Private internal note...",
                  )}
                  required
                  rows={2}
                />
                {noteState.error && (
                  <p className="text-xs font-semibold text-red-600" role="alert">
                    {noteState.error}
                  </p>
                )}
                {noteState.success && (
                  <p className="text-xs font-semibold text-emerald-700" role="status">
                    {noteState.success}
                  </p>
                )}
                <button
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  disabled={!isPro || notePending}
                  type="submit"
                >
                  {notePending
                    ? t("Mentés...", "Saving...")
                    : t("Vendégjegyzet mentése", "Save Customer Note")}
                </button>
              </form>

              {customerHistory.length > 0 && (
                <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t("Vendég előzmények és jegyzetek", "Customer History & Notes")}
                  </p>
                  <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {customerHistory.map((item) => (
                      <li
                        className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
                        key={item.customerKey}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900">
                            {item.customerName || item.customerEmail || item.customerPhone}
                          </span>
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                            {item.bookingsCount} {t("foglalás", "bookings")}
                          </span>
                        </div>
                        <p className="mt-0.5 text-slate-500">
                          {[item.customerEmail, item.customerPhone].filter(Boolean).join(" · ")}
                        </p>
                        {item.privateNote && (
                          <p className="mt-1.5 rounded-lg bg-white p-2 text-slate-800 ring-1 ring-slate-200">
                            {item.privateNote}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {notes.length > 0 && customerHistory.length === 0 && (
                <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {notes.map((note) => (
                    <li
                      className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
                      key={note.id}
                    >
                      <p className="font-bold text-slate-900">
                        {note.customer_name || note.customer_email || note.customer_phone}
                      </p>
                      <p className="mt-1 text-slate-700">{note.private_note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Feketelista / No-Show blokkoló */}
            <div className="rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-950">
                {t(
                  "Feketelista (Blacklist) és No-Show blokkoló",
                  "Blacklist & No-Show Blocker",
                )}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  "A feketelistás e-mail-címmel vagy telefonszámmal rendelkező ügyfelek nem tudnak online időpontot foglalni.",
                  "Blacklisted emails or phone numbers are blocked from booking online.",
                )}
              </p>

              <form action={blacklistAction} className="mt-4 space-y-3">
                <input name="companyId" type="hidden" value={companyId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                    disabled={!isPro}
                    maxLength={320}
                    name="email"
                    placeholder={t("Tiltandó e-mail-cím", "Email to block")}
                    type="email"
                  />
                  <input
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
                    disabled={!isPro}
                    maxLength={40}
                    name="phone"
                    placeholder={t("Tiltandó telefonszám", "Phone to block")}
                  />
                </div>
                <input
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  disabled={!isPro}
                  maxLength={500}
                  name="reason"
                  placeholder={t(
                    "Ok (pl. Nem jelent meg / No-show)",
                    "Reason (e.g. No-show)",
                  )}
                />
                {blacklistState.error && (
                  <p className="text-xs font-semibold text-red-600" role="alert">
                    {blacklistState.error}
                  </p>
                )}
                {blacklistState.success && (
                  <p className="text-xs font-semibold text-emerald-700" role="status">
                    {blacklistState.success}
                  </p>
                )}
                <button
                  className="rounded-xl bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
                  disabled={!isPro || blacklistPending}
                  type="submit"
                >
                  {blacklistPending
                    ? t("Tiltás...", "Blocking...")
                    : t("Hozzáadás a feketelistához", "Add to Blacklist")}
                </button>
              </form>

              {recentBookings.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t("Foglalás megjelölése: Nem jelent meg (No-Show)", "Mark Booking as No-Show")}
                  </p>
                  <form action={noShowAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input name="companyId" type="hidden" value={companyId} />
                    <select
                      className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
                      disabled={!isPro}
                      name="bookingId"
                    >
                      {recentBookings.map((booking) => (
                        <option key={booking.id} value={booking.id}>
                          {booking.ugyfel_nev || booking.ugyfel_email || "Ügyfél"} (
                          {new Date(booking.kezdes_ideje).toLocaleDateString("hu-HU")})
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        defaultChecked
                        disabled={!isPro}
                        name="addToBlacklist"
                        type="checkbox"
                      />
                      {t("+ Feketelista", "+ Blacklist")}
                    </label>
                    <button
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                      disabled={!isPro || noShowPending}
                      type="submit"
                    >
                      {t("Nem jelent meg", "Mark No-Show")}
                    </button>
                  </form>
                  {noShowState.error && (
                    <p className="mt-1 text-xs text-red-600">{noShowState.error}</p>
                  )}
                  {noShowState.success && (
                    <p className="mt-1 text-xs text-emerald-700">{noShowState.success}</p>
                  )}
                </div>
              )}

              {blacklist.length > 0 && (
                <ul className="mt-4 max-h-44 space-y-2 overflow-y-auto border-t border-slate-100 pt-3">
                  {blacklist.map((entry) => (
                    <li
                      className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs"
                      key={entry.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-rose-950">
                          {[entry.email, entry.phone].filter(Boolean).join(" · ")}
                        </p>
                        <p className="truncate text-rose-700">{entry.reason}</p>
                      </div>
                      <form action={removeAction}>
                        <input name="companyId" type="hidden" value={companyId} />
                        <input name="blacklistId" type="hidden" value={entry.id} />
                        <button
                          className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                          disabled={!isPro || removePending}
                          type="submit"
                        >
                          {t("Feloldás", "Unblock")}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {removeState.error && (
                <p className="mt-1 text-xs text-red-600">{removeState.error}</p>
              )}
            </div>
          </div>

          {/* 4. Kétirányú Google Calendar Szinkronizáció & Automatikus Google Review */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-950">
                {t(
                  "Kétirányú Google Calendar & Automatikus Értékeléskérő (Google Review)",
                  "Two-Way Google Calendar Sync & Automated Google Review Request",
                )}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  "Szinkronizáld a foglalásokat a saját Google / Apple naptáraddal, és kérj automatikusan 5 csillagos értékelést a lezajlott időpontok után.",
                  "Sync bookings with your Google / Apple Calendar and automatically request 5-star reviews after completed appointments.",
                )}
              </p>

              {calendarFeedToken && (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs">
                  <p className="font-semibold text-blue-900">
                    {t(
                      "Kimenő élő naptár-hivatkozás (Google / Apple / Outlook naptárfájlként / .ics előfizetésként):",
                      "Outbound Live Calendar Feed URL (Google / Apple / Outlook .ics subscription):",
                    )}
                  </p>
                  <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-[11px] text-slate-800 ring-1 ring-blue-100">
                    {`/api/calendar/${calendarFeedToken}.ics`}
                  </code>
                </div>
              )}

              <form action={integrationsAction} className="mt-4 space-y-3">
                <input name="companyId" type="hidden" value={companyId} />
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  {t(
                    "Google Maps / Google Cégprofil Értékelő Link (Automatikus e-mail a foglalás után 2 órával)",
                    "Google Maps / Business Review URL (Sent 2h after appointment ends)",
                  )}
                  <input
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal"
                    defaultValue={googleReviewUrl ?? ""}
                    disabled={!isPro}
                    name="googleReviewUrl"
                    placeholder="https://g.page/r/..."
                    type="url"
                  />
                </label>
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  {t(
                    "Bejövő külső Google Calendar privát iCal (.ics) URL (Magánprogramok automatikus blokkolása)",
                    "Inbound External Google Calendar Private iCal (.ics) URL (Auto-block personal events)",
                  )}
                  <input
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-normal"
                    defaultValue={externalCalendarIcsUrl ?? ""}
                    disabled={!isPro}
                    name="externalCalendarIcsUrl"
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    type="url"
                  />
                </label>
                {integrationsState.error && (
                  <p className="text-xs font-semibold text-red-600" role="alert">
                    {integrationsState.error}
                  </p>
                )}
                {integrationsState.success && (
                  <p className="text-xs font-semibold text-emerald-700" role="status">
                    {integrationsState.success}
                  </p>
                )}
                <button
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  disabled={!isPro || integrationsPending}
                  type="submit"
                >
                  {integrationsPending
                    ? t("Mentés...", "Saving...")
                    : t("Integrációk mentése", "Save Integrations")}
                </button>
              </form>

              <div className="mt-4 border-t border-slate-100 pt-3">
                <form action={syncAction} className="flex flex-wrap items-center justify-between gap-2">
                  <input name="companyId" type="hidden" value={companyId} />
                  <span className="text-xs text-slate-500">
                    {externalCalendarLastSyncedAt
                      ? `${t("Utolsó szinkronizálás:", "Last synced:")} ${new Date(externalCalendarLastSyncedAt).toLocaleString("hu-HU")}`
                      : t("Külső Google Naptár események azonnali beolvasása", "Import external Google Calendar events now")}
                  </span>
                  <button
                    className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                    disabled={!isPro || syncPending}
                    type="submit"
                  >
                    {syncPending
                      ? t("Szinkronizálás...", "Syncing...")
                      : t("Külső Google Naptár szinkronizálása most", "Sync External Google Calendar Now")}
                  </button>
                </form>
                {syncState.error && (
                  <p className="mt-1 text-xs font-semibold text-red-600">{syncState.error}</p>
                )}
                {syncState.success && (
                  <p className="mt-1 text-xs font-semibold text-emerald-700">{syncState.success}</p>
                )}
              </div>
            </div>

            {/* 5. Üzemeltetés, CSV/Excel Export, E-mail hitelesítés & Audit Log */}
            <div className="rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-950">
                {t(
                  "Üzemeltetés, Könyvelési CSV/Excel Export és Eseménynapló (Audit Log)",
                  "Operations, Accounting CSV/Excel Export & Audit Log",
                )}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {t(
                  "Töltsd le a foglalási és bevételi kimutatást Excel-kompatibilis CSV formátumban, és kövesd nyomon a rendszereseményeket.",
                  "Download booking & revenue reports in Excel-compatible CSV format and track system audit events.",
                )}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                  download
                  href={`/api/dashboard/export-csv?companyId=${encodeURIComponent(companyId)}`}
                >
                  {t("CSV / Excel jelentés letöltése", "Download CSV / Excel Report")}
                </a>
                <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800">
                  {t(
                    "SPF / DKIM / DMARC: E-mail kézbesítési hitelesítés aktív",
                    "SPF / DKIM / DMARC: Email delivery authentication active",
                  )}
                </span>
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t("Legutóbbi biztonsági és működési események (Audit Log)", "Recent Security & Operational Events (Audit Log)")}
                </p>
                {auditLogs.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    {t("Még nincs naplózott művelet.", "No audit events logged yet.")}
                  </p>
                ) : (
                  <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {auditLogs.map((log) => (
                      <li
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                        key={log.id}
                      >
                        <span className="font-semibold text-slate-800">
                          {log.action} <span className="font-normal text-slate-500">({log.entity_type})</span>
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {new Date(log.created_at).toLocaleString("hu-HU")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
