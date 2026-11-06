"use client";

import { useEffect, useState, type FormEvent } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface Service {
  id: string;
  nev: string;
  idotartam_percben: number;
  ar: number | string;
  leiras?: string;
}

interface CustomBookingField {
  key: string;
  label: string;
  type: "text";
  required: boolean;
}

interface BookingWidgetProps {
  companyId: string;
  companyName: string;
  companySlug: string;
  slotIntervalMinutes: number;
  timeZone: string;
  initialDay: string;
  primaryColor: string;
  services: Service[];
  customBookingFields: CustomBookingField[];
}

interface LockResponse {
  bookingId: string;
  lockToken: string;
  lockedUntil: string;
}

interface ApiError {
  error?: string;
  warning?: string;
  emailStatus?: "sent" | "failed" | "not_configured";
}

interface WeekSlot {
  slotStart: string;
  available: boolean;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function getMonday(date: string) {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function getMonthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(monthStart: string, offset: number) {
  const date = new Date(`${monthStart}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7) + "-01";
}

function getCalendarDays(monthStart: string) {
  const firstWeekday = new Date(`${monthStart}T00:00:00.000Z`).getUTCDay();
  const leadingDays = (firstWeekday + 6) % 7;
  const nextMonthStart = shiftMonth(monthStart, 1);
  const daysInMonth = Math.round(
    (new Date(`${nextMonthStart}T00:00:00.000Z`).getTime() -
      new Date(`${monthStart}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const calendarStart = addDays(monthStart, -leadingDays);
  return Array.from({ length: cellCount }, (_, index) =>
    addDays(calendarStart, index),
  );
}

function getMonthWeekStarts(monthStart: string) {
  const firstWeek = getMonday(monthStart);
  const lastDay = addDays(shiftMonth(monthStart, 1), -1);
  const lastWeek = getMonday(lastDay);
  const weeks: string[] = [];
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    weeks.push(week);
  }
  return weeks;
}

export default function BookingWidget({
  companyId,
  companyName,
  companySlug,
  slotIntervalMinutes,
  timeZone,
  initialDay,
  primaryColor,
  services,
  customBookingFields,
}: BookingWidgetProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [monthStart, setMonthStart] = useState(() => getMonthStart(initialDay));
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [slotResult, setSlotResult] = useState<{
    key: string;
    slots: WeekSlot[];
  } | null>(null);
  const [bookingFields, setBookingFields] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [lock, setLock] = useState<LockResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState(300);
  const [emailWarning, setEmailWarning] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { t } = useLanguage();

  const selectedServiceIds = selectedServices.map((service) => service.id);
  const totalServiceDuration = selectedServices.reduce(
    (total, service) => total + service.idotartam_percben,
    0,
  );
  const totalServicePrice = selectedServices.reduce(
    (total, service) => total + Number(service.ar),
    0,
  );
  const slotRequestKey =
    selectedServices.length && monthStart
      ? `${companySlug}:${selectedServiceIds.join(",")}:${monthStart}`
      : "";
  const weekSlots =
    slotResult?.key === slotRequestKey ? slotResult.slots : [];
  const loadingSlots =
    step === 2 && Boolean(slotRequestKey) && slotResult?.key !== slotRequestKey;
  const calendarDays = getCalendarDays(monthStart);
  const monthWeekStartsKey = getMonthWeekStarts(monthStart).join(",");
  const dateFormatter = new Intl.DateTimeFormat("hu-HU", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const slotDateFormatter = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  const slotTimeFormatter = new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const slotDate = (slot: WeekSlot) => {
    const parts = Object.fromEntries(
      slotDateFormatter
        .formatToParts(new Date(slot.slotStart))
        .map(({ type, value }) => [type, value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const slotTime = (slot: WeekSlot) =>
    slotTimeFormatter.format(new Date(slot.slotStart));
  const selectedDaySlots = weekSlots.filter(
    (slot) => slotDate(slot) === selectedDay,
  );
  const availableSlotsForDay = selectedDaySlots.filter((slot) => slot.available);
  const morningSlots = availableSlotsForDay.filter((slot) => slotTime(slot) < "12:00");
  const afternoonSlots = availableSlotsForDay.filter((slot) => slotTime(slot) >= "12:00");
  const requiredBookingFieldsComplete = customBookingFields.every(
    (field) => !field.required || Boolean(bookingFields[field.key]?.trim()),
  );
  const monthLabel = new Intl.DateTimeFormat("hu-HU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthStart}T12:00:00.000Z`));

  useEffect(() => {
    if (step !== 2 || !selectedServices.length || !monthStart) return;

    const controller = new AbortController();
    const serviceIdsForRequest = selectedServices.map((service) => service.id);
    const requestKey = `${companySlug}:${serviceIdsForRequest.join(",")}:${monthStart}`;
    const serviceIds = encodeURIComponent(serviceIdsForRequest.join(","));

    Promise.all(
      monthWeekStartsKey.split(",").map(async (weekStart) => {
        const response = await fetch(
          `/api/companies/${encodeURIComponent(companySlug)}/slots?serviceIds=${serviceIds}&weekStart=${encodeURIComponent(weekStart)}`,
          { signal: controller.signal },
        );
        const result = (await response.json()) as
          | { slots: WeekSlot[] }
          | ApiError;
        if (!response.ok || !("slots" in result)) {
          throw new Error(
            ("error" in result && result.error) ||
              "Az időpontok betöltése nem sikerült.",
          );
        }
        return result.slots;
      }),
    )
      .then((slotGroups) => {
        setSlotResult({ key: requestKey, slots: slotGroups.flat() });
        setError("");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setSlotResult({ key: requestKey, slots: [] });
        setError(
          cause instanceof Error
            ? cause.message
            : "Az időpontok betöltése nem sikerült.",
        );
      })
    return () => controller.abort();
  }, [companySlug, selectedServices, step, monthStart, monthWeekStartsKey]);

  useEffect(() => {
    if (step !== 3 || !lock) return;

    const updateCountdown = () => {
      const seconds = Math.max(
        0,
        Math.floor((new Date(lock.lockedUntil).getTime() - Date.now()) / 1000),
      );
      setTimeLeft(seconds);
      if (seconds === 0) {
        setLock(null);
        setError("Az időzárolás lejárt. Kérlek, válassz új időpontot.");
        setStep(2);
      }
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [lock, step]);

  async function handleSelectSlot(slot: string) {
    if (!selectedServices.length) return;

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bookings/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          serviceIds: selectedServiceIds,
          start: slot,
          customFields: bookingFields,
        }),
      });
      const result = (await response.json()) as LockResponse | ApiError;
      if (!response.ok || !("lockToken" in result)) {
        throw new Error(
          ("error" in result && result.error) ||
            "Az időpont zárolása nem sikerült.",
        );
      }
      setLock(result);
      setTimeLeft(300);
      setStep(3);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az időpont zárolása nem sikerült.",
      );
      setSlotResult((current) => ({
        key: slotRequestKey,
        slots:
          current?.key === slotRequestKey
            ? current.slots.map((value) =>
                value.slotStart === slot ? { ...value, available: false } : value,
              )
            : [],
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lock) return;

    setLoading(true);
    setError("");
    try {
      if (!emailVerified) {
        const supabase = createSupabaseBrowserClient();
        if (!emailCodeSent) {
          const { error: sendError } = await supabase.auth.signInWithOtp({
            email: customer.email.trim(),
            options: { shouldCreateUser: true },
          });
          if (sendError) {
            throw new Error(
              `Az e-mail-megerősítő kód küldése nem sikerült: ${sendError.message}`,
            );
          }
          setEmailCodeSent(true);
          return;
        }

        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: customer.email.trim(),
          token: emailCode.trim(),
          type: "email",
        });
        if (verifyError) {
          throw new Error("A kód érvénytelen vagy lejárt. Ellenőrizd, majd próbáld újra.");
        }
        setEmailVerified(true);
        setEmailCode("");
        setError("");
        return;
      }

      const response = await fetch("/api/bookings/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockToken: lock.lockToken,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          privacyAccepted,
        }),
      });
      const result = (await response.json()) as ApiError;
      if (!response.ok) {
        throw new Error(result.error || "A foglalás véglegesítése nem sikerült.");
      }
      setEmailWarning(result.warning || "");
      setLock(null);
      setStep(4);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A foglalás véglegesítése nem sikerült.",
      );
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep(1);
    setSelectedServices([]);
    setSlotResult(null);
    setBookingFields({});
    setCustomer({ name: "", email: "", phone: "" });
    setPrivacyAccepted(false);
    setPrivacyError(false);
    setEmailCodeSent(false);
    setEmailCode("");
    setEmailVerified(false);
    setLock(null);
    setEmailWarning("");
    setError("");
  }

  return (
    <section
      className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5 sm:p-8"
      style={{ "--brand-color": primaryColor } as React.CSSProperties}
    >
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand-color)]">
            {t("Online időpontfoglalás", "Online Appointment Booking")}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">{companyName}</h1>
        </div>
        <LanguageSwitcher />
      </header>

      {error && (
        <p className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold">
              {t("1. Szolgáltatások és adatok", "1. Services & Details")}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {t("Válassz egy vagy több szolgáltatást", "Select one or more services")}
              {customBookingFields.length
                ? t(", és töltsd ki a kért adatokat.", " and fill in the requested details.")
                : "."}
            </p>
          </div>
          {customBookingFields.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {customBookingFields.map((field) => (
                <label
                  className="space-y-1.5 text-sm font-medium"
                  key={field.key}
                >
                  {field.label}
                  {field.required && <span className="text-red-600"> *</span>}
                  <input
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                    maxLength={200}
                    onChange={(event) =>
                      setBookingFields((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    required={field.required}
                    type="text"
                    value={bookingFields[field.key] ?? ""}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-2">
              <h3
                className="text-sm font-semibold text-slate-800"
                id="service-selection-label"
              >
                {t("Szolgáltatások", "Services")}
              </h3>
              <div
                aria-labelledby="service-selection-label"
                className="grid gap-2 sm:grid-cols-2"
              >
                {services.map((service) => {
                  const isSelected = selectedServices.some(
                    (item) => item.id === service.id,
                  );
                  return (
                    <button
                      aria-label={service.nev}
                      aria-pressed={isSelected}
                      className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-yellow-400 bg-yellow-100 text-slate-950"
                          : "border-slate-200 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50"
                      }`}
                      key={service.id}
                      onClick={() =>
                        setSelectedServices((current) =>
                          current.some((item) => item.id === service.id)
                            ? current.filter((item) => item.id !== service.id)
                            : [...current, service],
                        )
                      }
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{service.nev}</span>
                        <span className="mt-1 block text-xs text-slate-600">
                          {service.idotartam_percben} perc ·{" "}
                          {Number(service.ar).toLocaleString("hu-HU")} Ft
                        </span>
                        {service.leiras && (
                          <span className="mt-1 block text-xs text-slate-500">
                            {service.leiras}
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                          isSelected
                            ? "border-yellow-500 bg-yellow-400 text-yellow-950"
                            : "border-slate-300"
                        }`}
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {services.length === 0 && (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                {t(
                  "Jelenleg nincs foglalható szolgáltatás.",
                  "No bookable services are currently available.",
                )}
              </p>
            )}
            {selectedServices.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900">
                  {t("Kiválasztott szolgáltatások", "Selected Services")}
                </h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {selectedServices.map((service) => (
                    <li
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                      key={service.id}
                    >
                      <span className="text-sm text-slate-700">
                        {service.nev} · {Number(service.ar).toLocaleString("hu-HU")} Ft ·{" "}
                        {service.idotartam_percben} {t("perc", "min")}
                      </span>
                      <button
                        aria-label={`${service.nev} eltávolítása`}
                        className="shrink-0 text-sm font-medium text-red-700 hover:underline"
                        onClick={() =>
                          setSelectedServices((current) =>
                            current.filter((item) => item.id !== service.id),
                          )
                        }
                        type="button"
                      >
                        {t("Eltávolítás", "Remove")}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900">
                  {t("Összesen", "Total")}: {totalServicePrice.toLocaleString("hu-HU")} Ft ·{" "}
                  {totalServiceDuration} {t("perc", "min")}
                </p>
              </div>
            )}
          </div>
          <button
            className="w-full rounded-lg bg-[var(--brand-color)] px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              !selectedServices.length || !requiredBookingFieldsComplete
            }
            onClick={() => setStep(2)}
            type="button"
          >
            {t("Tovább az időpontokhoz", "Continue to Time Slots")}
          </button>
        </div>
      )}

      {step === 2 && selectedServices.length > 0 && (
        <div>
          <button
            className="mb-4 text-sm font-medium text-blue-700 hover:underline"
            onClick={() => setStep(1)}
            type="button"
          >
            {t("← Vissza", "← Back")}
          </button>
          <h2 className="text-xl font-bold">
            {t("2. Válassz időpontot", "2. Select a Time Slot")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {selectedServices.map((service) => service.nev).join(" + ")} ·{" "}
            {totalServiceDuration} {t("perc összesen", "min total")}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {t(
              `A kezdési időpontok ${slotIntervalMinutes} perces rácsban érhetők el.`,
              `Start times are available in ${slotIntervalMinutes}-minute intervals.`,
            )}
          </p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              aria-label={t("Előző hónap", "Previous month")}
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                const nextMonth = shiftMonth(monthStart, -1);
                setMonthStart(nextMonth);
                setSelectedDay(nextMonth);
                setError("");
              }}
              type="button"
            >
              {t("← Előző hónap", "← Previous month")}
            </button>
            <p aria-live="polite" className="text-center text-sm font-semibold text-slate-800">
              {monthLabel}
            </p>
            <button
              aria-label={t("Következő hónap", "Next month")}
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                const nextMonth = shiftMonth(monthStart, 1);
                setMonthStart(nextMonth);
                setSelectedDay(nextMonth);
                setError("");
              }}
              type="button"
            >
              {t("Következő hónap →", "Next month →")}
            </button>
          </div>
          {loadingSlots ? (
            <p className="mt-6 text-sm text-slate-600">
              {t("Időpontok betöltése...", "Loading time slots...")}
            </p>
          ) : (
            <div className="mt-5 grid items-start gap-5 md:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.8fr)]">
              <div
                aria-label={t("Havi naptár – nap kiválasztása", "Monthly calendar – select a day")}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="mb-2 grid grid-cols-7 text-center text-xs font-semibold uppercase text-slate-500">
                  {[
                    t("H", "M"),
                    t("K", "Tu"),
                    t("Sze", "W"),
                    t("Cs", "Th"),
                    t("P", "F"),
                    t("Szo", "Sa"),
                    t("V", "Su"),
                  ].map((day, index) => (
                    <span key={`${day}-${index}`}>{day}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day) => {
                    const date = new Date(`${day}T12:00:00.000Z`);
                    const isSelected = day === selectedDay;
                    const isCurrentMonth = day.startsWith(monthStart.slice(0, 7));
                    const hasAvailability = weekSlots.some(
                      (slot) =>
                        slot.available &&
                        slotDate(slot) === day,
                    );
                    return (
                      <button
                        aria-label={dateFormatter.format(date)}
                        aria-pressed={isSelected}
                        className={`relative aspect-square rounded-lg text-sm transition ${
                          isSelected
                            ? "bg-blue-700 font-bold text-white"
                            : isCurrentMonth
                              ? "text-slate-800 hover:bg-white"
                              : "text-slate-400 hover:bg-white"
                        }`}
                        key={day}
                        onClick={() => {
                          setSelectedDay(day);
                          if (!isCurrentMonth) setMonthStart(getMonthStart(day));
                          setError("");
                        }}
                        type="button"
                      >
                        {date.getUTCDate()}
                        {hasAvailability && (
                          <span
                            aria-hidden="true"
                            className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${
                              isSelected ? "bg-white" : "bg-emerald-500"
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-center text-xs text-slate-500">
                  A zöld ponttal jelölt napokon van szabad időpont.
                </p>
              </div>

              <div
                aria-label="A kiválasztott nap időpontjai"
                className="space-y-4"
              >
                <h3 className="font-semibold capitalize text-slate-900">
                  {dateFormatter.format(new Date(`${selectedDay}T12:00:00.000Z`))}
                </h3>
                {availableSlotsForDay.length ? (
                  <>
                    <section className="rounded-xl border border-slate-200 p-4">
                      <h4 className="mb-3 text-sm font-bold text-slate-800">
                        Délelőtt
                      </h4>
                      {morningSlots.length ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {morningSlots.map((slot) => (
                            <button
                              aria-label={`${slotTime(slot)} szabad, ${dateFormatter.format(new Date(`${selectedDay}T12:00:00.000Z`))}`}
                              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-800 hover:border-blue-600 hover:bg-blue-100 disabled:opacity-60"
                              disabled={loading}
                              key={slot.slotStart}
                              onClick={() => void handleSelectSlot(slot.slotStart)}
                              type="button"
                            >
                              {slotTime(slot)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">
                          Nincs szabad délelőtti időpont.
                        </p>
                      )}
                    </section>
                    <section className="rounded-xl border border-slate-200 border-t-2 border-t-gray-400 p-4">
                      <h4 className="mb-3 text-sm font-bold text-slate-800">
                        Délután
                      </h4>
                      {afternoonSlots.length ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {afternoonSlots.map((slot) => (
                            <button
                              aria-label={`${slotTime(slot)} szabad, ${dateFormatter.format(new Date(`${selectedDay}T12:00:00.000Z`))}`}
                              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-800 hover:border-blue-600 hover:bg-blue-100 disabled:opacity-60"
                              disabled={loading}
                              key={slot.slotStart}
                              onClick={() => void handleSelectSlot(slot.slotStart)}
                              type="button"
                            >
                              {slotTime(slot)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">
                          Nincs szabad délutáni időpont.
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                    Erre a napra nincs szabad időpont.
                  </p>
                )}
              </div>
            </div>
          )}
          {loading && (
            <p className="mt-4 text-sm text-slate-600">Időpont zárolása...</p>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">
                {t("3. Személyes adatok", "3. Personal Details")}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {t(
                  "Az időpontot öt percig fenntartjuk.",
                  "Your selected slot is reserved for 5 minutes.",
                )}
              </p>
            </div>
            <span
              aria-live="polite"
              className="rounded-lg bg-amber-100 px-3 py-2 font-mono font-semibold text-amber-900"
            >
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
            </span>
          </div>
          <form className="space-y-4" onSubmit={handleConfirmBooking}>
            <label className="block space-y-1.5 text-sm font-medium">
              {t("Név", "Name")}
              <input
                autoComplete="name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                maxLength={200}
                onChange={(event) =>
                  setCustomer({ ...customer, name: event.target.value })
                }
                required
                value={customer.name}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              {t("E-mail-cím", "Email address")}
              <input
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                maxLength={320}
                onChange={(event) => {
                  setCustomer({ ...customer, email: event.target.value });
                  setEmailCodeSent(false);
                  setEmailCode("");
                  setEmailVerified(false);
                }}
                required
                type="email"
                value={customer.email}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              {t("Telefonszám", "Phone number")}
              <input
                autoComplete="tel"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                maxLength={40}
                onChange={(event) =>
                  setCustomer({ ...customer, phone: event.target.value })
                }
                type="tel"
                value={customer.phone}
              />
            </label>
            <fieldset
              className={`rounded-xl border p-4 transition ${
                privacyError && !privacyAccepted
                  ? "border-red-500 bg-red-50/50 ring-2 ring-red-100"
                  : "border-slate-200 bg-slate-50/70"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-700">
                <input
                  aria-describedby={privacyError ? "privacy-error" : undefined}
                  aria-invalid={privacyError && !privacyAccepted}
                  checked={privacyAccepted}
                  className="mt-1 size-4 shrink-0 accent-[var(--brand-color)]"
                  onChange={(event) => {
                    setPrivacyAccepted(event.target.checked);
                    if (event.target.checked) setPrivacyError(false);
                  }}
                  onInvalid={() => setPrivacyError(true)}
                  required
                  type="checkbox"
                />
                <span>
                  Elolvastam és elfogadom az{" "}
                  <a
                    className="font-semibold text-[var(--brand-color)] underline underline-offset-2"
                    href="/adatvedelmi-tajekoztato.pdf"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Adatkezelési Tájékoztatót
                  </a>
                  .
                </span>
              </label>
              {privacyError && !privacyAccepted && (
                <p className="mt-2 text-sm font-medium text-red-700" id="privacy-error" role="alert">
                  A foglalás folytatásához el kell fogadnod az adatkezelési tájékoztatót.
                </p>
              )}
            </fieldset>

            {emailCodeSent && !emailVerified && (
              <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                <p className="text-sm font-semibold text-slate-800">
                  Küldtünk egy megerősítő kódot a(z) {customer.email} címre.
                </p>
                <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                  E-mail-megerősítő kód
                  <input
                    autoComplete="one-time-code"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    inputMode="numeric"
                    onChange={(event) => setEmailCode(event.target.value)}
                    required
                    value={emailCode}
                  />
                </label>
              </div>
            )}

            {emailVerified && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800" role="status">
                Az e-mail-címed megerősítve.
              </p>
            )}

            <button
              className="w-full rounded-lg bg-[var(--brand-color)] px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading || timeLeft === 0 || (emailCodeSent && !emailVerified && !emailCode.trim())}
              type="submit"
            >
              {loading
                ? emailVerified
                  ? "Foglalás véglegesítése..."
                  : emailCodeSent
                    ? "E-mail-cím ellenőrzése..."
                    : "Kód küldése..."
                : emailVerified
                  ? "Foglalás megerősítése"
                  : emailCodeSent
                    ? "Kód ellenőrzése"
                    : "E-mail-cím megerősítése"}
            </button>
          </form>
        </div>
      )}

      {step === 4 && (
        <div className="py-5 text-center">
          <p aria-hidden="true" className="text-5xl">
            ✓
          </p>
          <h2 className="mt-4 text-2xl font-bold text-slate-950">
            {t("Sikeres foglalás!", "Booking Confirmed!")}
          </h2>
          <p className="mt-2 text-slate-600">
            {t(
              `A foglalásod bekerült a ${companyName} rendszerébe.`,
              `Your booking has been registered with ${companyName}.`,
            )}
          </p>
          {emailWarning && (
            <p className="mx-auto mt-5 max-w-lg rounded-lg bg-amber-50 p-4 text-left text-sm text-amber-900">
              {emailWarning}
            </p>
          )}
          <button
            className="mt-6 rounded-lg border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
            onClick={reset}
            type="button"
          >
            {t("Új foglalás indítása", "Start New Booking")}
          </button>
        </div>
      )}
    </section>
  );
}
