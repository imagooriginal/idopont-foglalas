"use client";

import { useActionState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  addBlacklistEntryAction,
  markBookingNoShowAction,
  removeBlacklistEntryAction,
  saveCustomerNoteAction,
  type ActionState,
  type CompanyPlan,
} from "./actions";

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

export default function PremiumFeaturesSection({
  companyId,
  plan,
  stats,
  customerHistory,
  notes,
  blacklist,
  recentBookings,
  customFieldsCount,
}: {
  companyId: string;
  plan: CompanyPlan;
  stats: MonthlyPremiumStats;
  customerHistory: CustomerHistorySummary[];
  notes: CustomerNoteItem[];
  blacklist: BlacklistEntryItem[];
  recentBookings: RecentBookingForNoShow[];
  customFieldsCount: number;
}) {
  const { t } = useLanguage();
  const isPro = plan === "pro";

  const [noteState, noteAction, notePending] = useActionState(
    saveCustomerNoteAction,
    initialState,
  );
  const [blacklistState, blacklistAction, blacklistPending] = useActionState(
    addBlacklistEntryAction,
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeBlacklistEntryAction,
    initialState,
  );
  const [noShowState, noShowAction, noShowPending] = useActionState(
    markBookingNoShowAction,
    initialState,
  );

  return (
    <section className="space-y-6" id="premium-features">
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
        </div>
      </div>
    </section>
  );
}
