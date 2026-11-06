"use client";

import { useActionState, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import { createManualBookingAction, type ActionState } from "./actions";

export interface ManualBookingServiceOption {
  id: string;
  nev: string;
  idotartam_percben: number;
  ar: number | string;
  is_active: boolean;
}

const initialState: ActionState = {};

function localDateTimeToIso(value: string, timeZone: string) {
  if (!value) return "";

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";

  const [, year, month, day, hour, minute] = match;
  const wanted = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  let timestamp = wanted;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(timestamp))
        .map(({ type, value: partValue }) => [type, partValue]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    timestamp += wanted - represented;
  }

  return new Date(timestamp).toISOString();
}

export default function ManualBookingManager({
  companyId,
  timeZone,
  services,
}: {
  companyId: string;
  timeZone: string;
  services: ManualBookingServiceOption[];
}) {
  const { t } = useLanguage();
  const [startLocal, setStartLocal] = useState("");
  const [state, action, pending] = useActionState(
    createManualBookingAction,
    initialState,
  );
  const activeServices = services.filter((service) => service.is_active);
  const startIso = localDateTimeToIso(startLocal, timeZone);

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
      id="manual-booking"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t("Alap és Prémium funkció", "Starter & Pro Feature")}
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            {t(
              "Kézi foglalásrögzítés (Telefonos / helyszíni ügyfél)",
              "Manual Booking Entry (Phone / Walk-in Customer)",
            )}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t(
              "Közvetlen időpontrögzítés OTP-hitelesítés nélkül. Ha megadsz e-mail-címet, a rendszer visszaigazoló e-mailt küld.",
              "Record a booking directly without OTP verification. If you provide an email address, a confirmation email will be sent.",
            )}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
          {t("Azonnal visszaigazolt", "Confirmed immediately")}
        </span>
      </div>

      {!activeServices.length ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          {t(
            "Kézi foglalás rögzítéséhez először hozz létre vagy aktiválj legalább egy szolgáltatást.",
            "To record a manual booking, first create or activate at least one service.",
          )}
        </p>
      ) : (
        <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <input name="companyId" type="hidden" value={companyId} />
          <input name="startTime" type="hidden" value={startIso} />

          <label className="space-y-1.5 text-xs font-semibold text-slate-700">
            {t("Ügyfél neve *", "Customer Name *")}
            <input
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              maxLength={100}
              name="customerName"
              placeholder={t("Pl. Kovács János", "e.g. John Doe")}
              required
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold text-slate-700">
            {t("Telefonszám *", "Phone Number *")}
            <input
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              maxLength={40}
              name="customerPhone"
              placeholder="+36 30 123 4567"
              required
              type="tel"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold text-slate-700">
            {t("E-mail-cím (opcionális)", "Email Address (optional)")}
            <input
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              maxLength={320}
              name="customerEmail"
              placeholder="ugyfel@pelda.hu"
              type="email"
            />
          </label>

          <label className="space-y-1.5 text-xs font-semibold text-slate-700">
            {t("Szolgáltatás *", "Service *")}
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              defaultValue={activeServices[0]?.id ?? ""}
              name="serviceId"
              required
            >
              {activeServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.nev} ({service.idotartam_percben} {t("perc", "min")} ·{" "}
                  {Number(service.ar).toLocaleString("hu-HU")} Ft)
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-xs font-semibold text-slate-700">
            {t("Kezdés időpontja *", "Start Date & Time *")}
            <input
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setStartLocal(event.target.value)}
              required
              type="datetime-local"
              value={startLocal}
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-5">
            <div>
              {state.error && (
                <p
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                  role="alert"
                >
                  {t(state.error, state.error)}
                </p>
              )}
              {state.success && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                  role="status"
                >
                  {t(state.success, state.success)}
                </p>
              )}
            </div>
            <button
              className="rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-60"
              disabled={pending || !startIso}
              type="submit"
            >
              {pending
                ? t("Rögzítés...", "Saving...")
                : t("Kézi foglalás rögzítése", "Record Manual Booking")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
