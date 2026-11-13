"use client";

import { useState } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n";

interface CancelBookingClientProps {
  token: string;
  companyName: string;
  serviceName: string;
  customerName: string;
  startsAtFormatted: string;
  isWithin24Hours: boolean;
  cancellationWindowHours?: number;
  isAlreadyCancelled: boolean;
  isProCompany: boolean;
}

export default function CancelBookingClient({
  token,
  companyName,
  serviceName,
  customerName,
  startsAtFormatted,
  isWithin24Hours,
  cancellationWindowHours = 24,
  isAlreadyCancelled,
  isProCompany,
}: CancelBookingClientProps) {
  const { t } = useLanguage();
  const [cancelled, setCancelled] = useState(isAlreadyCancelled);
  const [rescheduledTo, setRescheduledTo] = useState("");
  const [newStartLocal, setNewStartLocal] = useState("");
  const [loading, setLoading] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [error, setError] = useState("");

  async function handleCancel() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          result.error ||
            t(
              "Az időpont lemondása nem sikerült.",
              "Could not cancel the appointment.",
            ),
        );
      }
      setCancelled(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              "Az időpont lemondása nem sikerült.",
              "Could not cancel the appointment.",
            ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleReschedule(event: React.FormEvent) {
    event.preventDefault();
    if (!newStartLocal) return;
    setRescheduling(true);
    setError("");
    try {
      const isoStart = new Date(newStartLocal).toISOString();
      const response = await fetch("/api/bookings/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newStart: isoStart }),
      });
      const result = (await response.json()) as {
        error?: string;
        startsAt?: string;
      };
      if (!response.ok) {
        throw new Error(
          result.error ||
            t(
              "Az időpont átütemezése nem sikerült.",
              "Could not reschedule the appointment.",
            ),
        );
      }
      const formattedNew = new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(result.startsAt || isoStart));
      setRescheduledTo(formattedNew);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              "Az időpont átütemezése nem sikerült.",
              "Could not reschedule the appointment.",
            ),
      );
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            {t(
              "Online időpont-kezelés (Átütemezés / Lemondás)",
              "Online Appointment Management (Reschedule / Cancel)",
            )}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">
            {companyName}
          </h1>
        </div>
        <LanguageSwitcher />
      </div>

      <dl className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="font-medium text-slate-500">
            {t("Ügyfél", "Customer")}
          </dt>
          <dd className="font-semibold text-slate-900">{customerName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-medium text-slate-500">
            {t("Szolgáltatás", "Service")}
          </dt>
          <dd className="font-semibold text-slate-900">{serviceName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-medium text-slate-500">
            {t("Időpont", "Appointment Time")}
          </dt>
          <dd className="font-semibold text-slate-900">
            {rescheduledTo || startsAtFormatted}
          </dd>
        </div>
      </dl>

      {error && (
        <p
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}

      {rescheduledTo && (
        <div
          className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900"
          role="status"
        >
          {t(
            `Az időpontot sikeresen átütemezted erre: ${rescheduledTo}. Küldtünk egy frissített visszaigazoló e-mailt.`,
            `Your appointment has been rescheduled to: ${rescheduledTo}. An updated confirmation email has been sent.`,
          )}
        </div>
      )}

      {cancelled ? (
        <div
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900"
          role="status"
        >
          {t(
            "Az időpontot sikeresen lemondtad. Az idősáv felszabadult, és értesítettük a szolgáltatót.",
            "Your appointment has been cancelled. The time slot has been freed and the provider has been notified.",
          )}
        </div>
      ) : !isProCompany ? (
        <div
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900"
          role="alert"
        >
          {t(
            "Az online lemondás ennél a szolgáltatónál nem érhető el. Kérjük, hívd közvetlenül a szolgáltatót!",
            "Online cancellation is not available for this provider. Please call the provider directly!",
          )}
        </div>
      ) : isWithin24Hours ? (
        <div
          className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900"
          role="alert"
        >
          {t(
            `${cancellationWindowHours} órán belüli időpont online már nem mondható le. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!`,
            `Appointments within ${cancellationWindowHours} hours cannot be cancelled online. Please contact the provider directly by phone!`,
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Customer Reschedule Option */}
          <form
            className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4"
            onSubmit={handleReschedule}
          >
            <h2 className="text-sm font-bold text-slate-900">
              {t(
                "Másik időpontot szeretnél? (Átütemezés)",
                "Prefer another time? (Reschedule)",
              )}
            </h2>
            <p className="text-xs text-slate-600">
              {t(
                "A lemondás helyett 1 kattintással átteheted a foglalásodat egy másik szabad időpontra:",
                "Instead of cancelling, move your appointment to another available slot:",
              )}
            </p>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              {t("Új időpont kiválasztása", "Select New Date & Time")}
              <input
                aria-label={t("Új időpont kiválasztása", "Select New Date & Time")}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
                onChange={(e) => setNewStartLocal(e.target.value)}
                required
                type="datetime-local"
                value={newStartLocal}
              />
            </label>
            <button
              className="w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-60"
              disabled={rescheduling || !newStartLocal}
              type="submit"
            >
              {rescheduling
                ? t("Átütemezés...", "Rescheduling...")
                : t("Időpont átütemezése", "Reschedule Appointment")}
            </button>
          </form>

          {/* Customer Cancel Option */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">
              {t(
                "Biztosan szeretnéd lemondani a fenti időpontot? A művelet nem vonható vissza.",
                "Are you sure you want to cancel this appointment? This action cannot be undone.",
              )}
            </p>
            <button
              className="w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
              disabled={loading}
              onClick={() => void handleCancel()}
              type="button"
            >
              {loading
                ? t("Lemondás folyamatban...", "Cancelling...")
                : t("Időpont lemondása", "Cancel Appointment")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
