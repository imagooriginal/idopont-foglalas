"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

interface Service {
  id: string;
  nev: string;
  idotartam_percben: number;
  ar: number | string;
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

export default function BookingWidget({
  companyId,
  companyName,
  companySlug,
  slotIntervalMinutes,
  timeZone,
  initialDay,
  primaryColor,
  services,
}: BookingWidgetProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [weekStart, setWeekStart] = useState(() => getMonday(initialDay));
  const [slotResult, setSlotResult] = useState<{
    key: string;
    slots: WeekSlot[];
  } | null>(null);
  const [vehicle, setVehicle] = useState({
    make: "",
    model: "",
    registration: "",
  });
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
    selectedServices.length && weekStart
      ? `${companySlug}:${selectedServiceIds.join(",")}:${weekStart}`
      : "";
  const weekSlots =
    slotResult?.key === slotRequestKey ? slotResult.slots : [];
  const loadingSlots =
    step === 2 && Boolean(slotRequestKey) && slotResult?.key !== slotRequestKey;
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index),
  );
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
  const timeRows = [...new Set(weekSlots.map(slotTime))].sort();
  const weekLabel = `${dateFormatter.format(new Date(`${weekStart}T12:00:00.000Z`))} – ${dateFormatter.format(new Date(`${weekDays[6]}T12:00:00.000Z`))}`;

  useEffect(() => {
    if (step !== 2 || !selectedServices.length || !weekStart) return;

    const controller = new AbortController();
    const serviceIdsForRequest = selectedServices.map((service) => service.id);
    const requestKey = `${companySlug}:${serviceIdsForRequest.join(",")}:${weekStart}`;
    const serviceIds = encodeURIComponent(serviceIdsForRequest.join(","));

    fetch(
      `/api/companies/${encodeURIComponent(companySlug)}/slots?serviceIds=${serviceIds}&weekStart=${encodeURIComponent(weekStart)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as
          | { slots: WeekSlot[] }
          | ApiError;
        if (!response.ok || !("slots" in result)) {
          throw new Error(
            ("error" in result && result.error) ||
              "Az időpontok betöltése nem sikerült.",
          );
        }
        setSlotResult({ key: requestKey, slots: result.slots });
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
  }, [companySlug, selectedServices, step, weekStart]);

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
          vehicleMake: vehicle.make,
          vehicleModel: vehicle.model,
          vehicleRegistration: vehicle.registration,
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
    setVehicle({ make: "", model: "", registration: "" });
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
      className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5 sm:p-8"
      style={{ "--brand-color": primaryColor } as React.CSSProperties}
    >
      <header className="mb-7 border-b border-slate-100 pb-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--brand-color)]">
          Online időpontfoglalás
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">{companyName}</h1>
      </header>

      {error && (
        <p className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold">1. Jármű és szolgáltatás</h2>
            <p className="mt-1 text-sm text-slate-600">
              Válassz egy vagy több szolgáltatást, és add meg a jármű adatait.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium">
              Márka
              <input
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                maxLength={100}
                onChange={(event) =>
                  setVehicle({ ...vehicle, make: event.target.value })
                }
                required
                value={vehicle.make}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Modell
              <input
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                maxLength={100}
                onChange={(event) =>
                  setVehicle({ ...vehicle, model: event.target.value })
                }
                required
                value={vehicle.model}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Rendszám
              <input
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 uppercase"
                maxLength={20}
                onChange={(event) =>
                  setVehicle({
                    ...vehicle,
                    registration: event.target.value,
                  })
                }
                required
                value={vehicle.registration}
              />
            </label>
          </div>

          <div className="space-y-3">
            <label
              className="block space-y-1.5 text-sm font-semibold text-slate-800"
              htmlFor="service-selection"
            >
              Szolgáltatások
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
                disabled={!services.length}
                id="service-selection"
                onChange={(event) => {
                  const service = services.find(
                    (item) => item.id === event.target.value,
                  );
                  if (
                    service &&
                    !selectedServices.some((item) => item.id === service.id)
                  ) {
                    setSelectedServices((current) => [...current, service]);
                  }
                }}
                value=""
              >
                <option disabled value="">
                  Kérjük, válasszon szolgáltatást...
                </option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.nev} - {Number(service.ar).toLocaleString("hu-HU")} Ft -{" "}
                    {service.idotartam_percben} perc
                  </option>
                ))}
              </select>
            </label>
            {services.length === 0 && (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                Jelenleg nincs foglalható szolgáltatás.
              </p>
            )}
            {selectedServices.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-900">
                  Kiválasztott szolgáltatások
                </h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {selectedServices.map((service) => (
                    <li
                      className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                      key={service.id}
                    >
                      <span className="text-sm text-slate-700">
                        {service.nev} · {Number(service.ar).toLocaleString("hu-HU")} Ft ·{" "}
                        {service.idotartam_percben} perc
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
                        Eltávolítás
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm font-semibold text-slate-900">
                  Összesen: {totalServicePrice.toLocaleString("hu-HU")} Ft ·{" "}
                  {totalServiceDuration} perc
                </p>
              </div>
            )}
          </div>
          <button
            className="w-full rounded-lg bg-[var(--brand-color)] px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              !selectedServices.length ||
              !vehicle.make.trim() ||
              !vehicle.model.trim() ||
              !vehicle.registration.trim()
            }
            onClick={() => setStep(2)}
            type="button"
          >
            Tovább az időpontokhoz
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
            ← Vissza
          </button>
          <h2 className="text-xl font-bold">2. Válassz időpontot</h2>
          <p className="mt-1 text-sm text-slate-600">
            {selectedServices.map((service) => service.nev).join(" + ")} ·{" "}
            {totalServiceDuration} perc összesen
          </p>
          <p className="mt-1 text-sm text-slate-600">
            A kezdési időpontok {slotIntervalMinutes} perces rácsban érhetők el.
          </p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              aria-label="Előző hét"
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setWeekStart((current) => addDays(current, -7));
                setError("");
              }}
              type="button"
            >
              ← Előző hét
            </button>
            <p aria-live="polite" className="text-center text-sm font-semibold text-slate-800">
              {weekLabel}
            </p>
            <button
              aria-label="Következő hét"
              className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setWeekStart((current) => addDays(current, 7));
                setError("");
              }}
              type="button"
            >
              Következő hét →
            </button>
          </div>
          {loadingSlots ? (
            <p className="mt-6 text-sm text-slate-600">Időpontok betöltése...</p>
          ) : weekSlots.length ? (
            <div className="mt-5 overflow-x-auto">
              <div
                aria-label="Heti időpontnaptár"
                className="min-w-[58rem]"
                role="grid"
              >
                <div
                  className="grid grid-cols-[4rem_repeat(7,minmax(7rem,1fr))]"
                  role="row"
                >
                  <span className="p-2 text-xs font-medium text-slate-500">Idő</span>
                  {weekDays.map((day) => (
                    <div
                      className="border-b border-slate-200 p-2 text-center text-xs font-semibold capitalize text-slate-800"
                      key={day}
                      role="columnheader"
                    >
                      {dateFormatter.format(new Date(`${day}T12:00:00.000Z`))}
                    </div>
                  ))}
                </div>
                {timeRows.map((time) => (
                  <div
                    className="grid grid-cols-[4rem_repeat(7,minmax(7rem,1fr))]"
                    key={time}
                    role="row"
                  >
                    <span
                      className="border-b border-slate-100 p-2 text-xs font-medium text-slate-500"
                      role="rowheader"
                    >
                      {time}
                    </span>
                    {weekDays.map((day) => {
                      const daySlots = weekSlots.filter(
                        (slot) => slotDate(slot) === day && slotTime(slot) === time,
                      );

                      return (
                        <div
                          className="flex min-h-12 items-center justify-center border-b border-l border-slate-100 p-1"
                          key={day}
                          role="gridcell"
                        >
                          {daySlots.length ? (
                            daySlots.map((slot) => {
                              const isPast =
                                new Date(slot.slotStart).getTime() <= Date.now();
                              const isDisabled = loading || !slot.available || isPast;
                              return (
                                <button
                                  aria-label={`${time} ${slot.available && !isPast ? "szabad" : isPast ? "lejárt" : "foglalt"}, ${dateFormatter.format(new Date(`${day}T12:00:00.000Z`))}`}
                                  className={`w-full rounded-md border px-1 py-2 text-sm font-semibold ${
                                    isPast
                                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                      : slot.available
                                        ? "border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-600 hover:bg-blue-100"
                                        : "cursor-not-allowed border-red-100 bg-red-50 line-through text-red-500"
                                  } disabled:opacity-100`}
                                  disabled={isDisabled}
                                  key={slot.slotStart}
                                  onClick={() => void handleSelectSlot(slot.slotStart)}
                                  type="button"
                                >
                                  {time}
                                </button>
                              );
                            })
                          ) : (
                            <span aria-hidden="true" className="text-slate-200">
                              —
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Erre a hétre nincs megjeleníthető időpont.
            </p>
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
              <h2 className="text-xl font-bold">3. Személyes adatok</h2>
              <p className="mt-1 text-sm text-slate-600">
                Az időpontot öt percig fenntartjuk.
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
              Név
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
              E-mail-cím
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
              Telefonszám
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
            Sikeres foglalás!
          </h2>
          <p className="mt-2 text-slate-600">
            A foglalásod bekerült a {companyName} rendszerébe.
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
            Új foglalás indítása
          </button>
        </div>
      )}
    </section>
  );
}
