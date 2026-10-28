"use client";

import { useEffect, useState, type FormEvent } from "react";

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
  timeZone: string;
  initialDay: string;
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

export default function BookingWidget({
  companyId,
  companyName,
  companySlug,
  timeZone,
  initialDay,
  services,
}: BookingWidgetProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [slotResult, setSlotResult] = useState<{
    key: string;
    slots: string[];
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
  const [lock, setLock] = useState<LockResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState(300);
  const [emailWarning, setEmailWarning] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const slotRequestKey =
    selectedService && selectedDay
      ? `${companySlug}:${selectedService.id}:${selectedDay}`
      : "";
  const slots =
    slotResult?.key === slotRequestKey ? slotResult.slots : [];
  const loadingSlots =
    step === 2 && Boolean(slotRequestKey) && slotResult?.key !== slotRequestKey;

  useEffect(() => {
    if (step !== 2 || !selectedService || !selectedDay) return;

    const controller = new AbortController();
    const requestKey = `${companySlug}:${selectedService.id}:${selectedDay}`;

    fetch(
      `/api/companies/${encodeURIComponent(companySlug)}/slots?serviceId=${encodeURIComponent(selectedService.id)}&day=${encodeURIComponent(selectedDay)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as
          | { slots: string[] }
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
  }, [companySlug, selectedDay, selectedService, step]);

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
    if (!selectedService) return;

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bookings/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          serviceId: selectedService.id,
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
        slots: (current?.key === slotRequestKey ? current.slots : []).filter(
          (value) => value !== slot,
        ),
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
      const response = await fetch("/api/bookings/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lockToken: lock.lockToken,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
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
    setSelectedService(null);
    setSlotResult(null);
    setVehicle({ make: "", model: "", registration: "" });
    setCustomer({ name: "", email: "", phone: "" });
    setLock(null);
    setEmailWarning("");
    setError("");
  }

  const formattedSlot = (value: string) =>
    new Intl.DateTimeFormat("hu-HU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));

  return (
    <section className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5 sm:p-8">
      <header className="mb-7 border-b border-slate-100 pb-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
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
              Válassz egy szolgáltatást, és add meg a jármű adatait.
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

          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-semibold text-slate-800">
              Válassz egy szolgáltatást
            </legend>
            {services.map((service) => (
              <button
                aria-pressed={selectedService?.id === service.id}
                className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition ${
                  selectedService?.id === service.id
                    ? "border-blue-700 bg-blue-50 ring-1 ring-blue-700"
                    : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
                }`}
                key={service.id}
                onClick={() => setSelectedService(service)}
                type="button"
              >
                <span>
                  <span className="block font-semibold text-slate-950">
                    {service.nev}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">
                    {service.idotartam_percben} perc
                  </span>
                </span>
                <span className="whitespace-nowrap font-semibold text-slate-900">
                  {Number(service.ar).toLocaleString("hu-HU")} Ft
                </span>
              </button>
            ))}
            {services.length === 0 && (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                Jelenleg nincs foglalható szolgáltatás.
              </p>
            )}
          </fieldset>
          <button
            className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              !selectedService ||
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

      {step === 2 && selectedService && (
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
            {selectedService.nev} · {selectedService.idotartam_percben} perc
          </p>
          <label className="mt-5 block max-w-xs space-y-1.5 text-sm font-medium">
            Nap
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              min={initialDay}
              onChange={(event) => {
                setSelectedDay(event.target.value);
                setError("");
              }}
              type="date"
              value={selectedDay}
            />
          </label>
          {loadingSlots ? (
            <p className="mt-6 text-sm text-slate-600">Időpontok betöltése...</p>
          ) : slots.length ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {slots.map((slot) => (
                <button
                  className="rounded-lg border border-slate-300 px-3 py-3 font-semibold text-slate-800 hover:border-blue-600 hover:bg-blue-50 disabled:opacity-50"
                  disabled={loading}
                  key={slot}
                  onClick={() => void handleSelectSlot(slot)}
                  type="button"
                >
                  {formattedSlot(slot)}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Erre a napra nincs szabad időpont.
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
                onChange={(event) =>
                  setCustomer({ ...customer, email: event.target.value })
                }
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
            <button
              className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              disabled={loading || timeLeft === 0}
              type="submit"
            >
              {loading ? "Foglalás véglegesítése..." : "Foglalás megerősítése"}
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
