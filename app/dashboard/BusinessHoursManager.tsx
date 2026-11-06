"use client";

import { useActionState, useState } from "react";
import { saveBusinessHoursAction, type ActionState } from "./actions";

interface BusinessHour {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

interface ScheduleEntry {
  weekday: number;
  is_open: boolean;
  opens_at: string;
  closes_at: string;
}

const weekdayNames = [
  "Vasárnap",
  "Hétfő",
  "Kedd",
  "Szerda",
  "Csütörtök",
  "Péntek",
  "Szombat",
];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const initialState: ActionState = {};

function ActionMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

export default function BusinessHoursManager({
  companyId,
  hours,
}: {
  companyId: string;
  hours: BusinessHour[];
}) {
  const [state, action, pending] = useActionState(
    saveBusinessHoursAction,
    initialState,
  );
  const [schedule, setSchedule] = useState<ScheduleEntry[]>(() => {
    const storedHours = new Map(hours.map((hour) => [hour.weekday, hour]));
    return weekdayNames.map((_, weekday) => {
      const current = storedHours.get(weekday);
      return {
        weekday,
        is_open: Boolean(current),
        opens_at: current?.opens_at.slice(0, 5) ?? "09:00",
        closes_at: current?.closes_at.slice(0, 5) ?? "17:00",
      };
    });
  });

  function updateDay(
    weekday: number,
    update: Partial<Omit<ScheduleEntry, "weekday">>,
  ) {
    setSchedule((current) =>
      current.map((entry) =>
        entry.weekday === weekday ? { ...entry, ...update } : entry,
      ),
    );
  }

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
      id="settings"
    >
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Beállítások
        </p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Heti nyitvatartás
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Naponta külön állíthatod a foglalható időszakot. A kikapcsolt napokon
          nem jelennek meg időpontok.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <input name="companyId" type="hidden" value={companyId} />
        <input name="schedule" type="hidden" value={JSON.stringify(schedule)} />
        <div className="space-y-2">
          {weekdayOrder.map((weekday) => {
            const entry = schedule.find((item) => item.weekday === weekday);
            if (!entry) return null;

            return (
              <div
                className="grid gap-3 rounded-xl border border-slate-100 p-3 sm:grid-cols-[minmax(7rem,1fr)_auto_auto] sm:items-center"
                key={weekday}
              >
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    checked={entry.is_open}
                    className="size-4 accent-blue-700"
                    onChange={(event) =>
                      updateDay(weekday, { is_open: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {weekdayNames[weekday]}
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  Nyitás
                  <input
                    aria-label={`${weekdayNames[weekday]} nyitás`}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 sm:w-28"
                    disabled={!entry.is_open}
                    onChange={(event) =>
                      updateDay(weekday, { opens_at: event.target.value })
                    }
                    required={entry.is_open}
                    type="time"
                    value={entry.opens_at}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  Zárás
                  <input
                    aria-label={`${weekdayNames[weekday]} zárás`}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 sm:w-28"
                    disabled={!entry.is_open}
                    onChange={(event) =>
                      updateDay(weekday, { closes_at: event.target.value })
                    }
                    required={entry.is_open}
                    type="time"
                    value={entry.closes_at}
                  />
                </label>
              </div>
            );
          })}
        </div>
        <ActionMessage state={state} />
        <button
          className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          disabled={pending || !schedule.some((entry) => entry.is_open)}
          type="submit"
        >
          {pending ? "Mentés..." : "Nyitvatartás mentése"}
        </button>
      </form>
    </section>
  );
}
