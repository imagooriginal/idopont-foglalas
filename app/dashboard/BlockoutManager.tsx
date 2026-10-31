"use client";

import { useActionState, useState } from "react";
import {
  createBlockoutAction,
  deleteBlockoutAction,
  type ActionState,
} from "./actions";

interface Blockout {
  id: string;
  kezdes_ideje: string;
  vege_ideje: string;
  megjegyzes: string | null;
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

  const resolved = formatter.formatToParts(new Date(timestamp));
  const parts = Object.fromEntries(
    resolved.map(({ type, value: partValue }) => [type, partValue]),
  );
  if (
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    return "";
  }

  return new Date(timestamp).toISOString();
}

export default function BlockoutManager({
  companyId,
  timeZone,
  blockouts,
}: {
  companyId: string;
  timeZone: string;
  blockouts: Blockout[];
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [state, action, pending] = useActionState(
    createBlockoutAction,
    initialState,
  );

  return (
    <section
      className="relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
      id="blockouts"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Szünetek és blokkolások
            </h2>
          <p className="mt-1 text-sm text-slate-600">
            A blokkolás az online foglalásból is kiveszi az érintett időt.
          </p>
          </div>
        </div>
        <button
          className="hidden shrink-0 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 hover:shadow-md sm:inline-flex"
          onClick={() => setOpen(true)}
          type="button"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          Időpont blokkolása
        </button>
      </div>

      {blockouts.length === 0 ? (
        <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200/70">
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 11h18" />
            </svg>
          </span>
          <p className="mt-3 text-sm font-semibold text-slate-800">
            Nincs közelgő blokkolás
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            A műhely szüneteit itt rögzítheted.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {blockouts.map((blockout) => (
            <li
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition hover:border-slate-300 hover:bg-slate-50/70"
              key={blockout.id}
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">
                  {blockout.megjegyzes || "Blokkolt időszak"}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {new Intl.DateTimeFormat("hu-HU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone,
                  }).format(new Date(blockout.kezdes_ideje))}
                  {" – "}
                  {new Intl.DateTimeFormat("hu-HU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone,
                  }).format(new Date(blockout.vege_ideje))}
                </p>
              </div>
              <form action={deleteBlockoutAction}>
                <input name="blockoutId" type="hidden" value={blockout.id} />
                <button
                  aria-label="Blokkolás törlése"
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  type="submit"
                >
                  Törlés
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <button
        aria-label="Időpont blokkolása"
        className="fixed bottom-24 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-blue-700 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/25 transition hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-xl sm:hidden"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="text-xl leading-none">+</span>
        Blokkolás
      </button>

      {open && (
        <div
          aria-labelledby="blockout-title"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="dialog"
        >
          <form
            action={action}
            className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold" id="blockout-title">
                  Időpont blokkolása
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Műhelyidő, ebédszünet vagy telefonon rögzített foglalás.
                </p>
              </div>
              <button
                aria-label="Bezárás"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setOpen(false)}
                type="button"
              >
                ✕
              </button>
            </div>

            {state.error && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
                {state.error}
              </p>
            )}
            {state.success && (
              <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">
                {state.success}
              </p>
            )}

            <input name="companyId" type="hidden" value={companyId} />
            <input
              name="startsAt"
              type="hidden"
              value={localDateTimeToIso(start, timeZone)}
            />
            <input
              name="endsAt"
              type="hidden"
              value={localDateTimeToIso(end, timeZone)}
            />

            <label className="block space-y-1.5 text-sm font-medium">
              Kezdés
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                onChange={(event) => setStart(event.target.value)}
                required
                type="datetime-local"
                value={start}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Befejezés
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                onChange={(event) => setEnd(event.target.value)}
                required
                type="datetime-local"
                value={end}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Megjegyzés
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                maxLength={200}
                name="note"
                placeholder="Például: Ebédszünet"
                type="text"
              />
            </label>
            <p className="text-xs text-slate-500">
              A helyi időzóna: {timeZone}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                className="rounded-xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setOpen(false)}
                type="button"
              >
                Mégse
              </button>
              <button
                className="rounded-xl bg-blue-700 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pending}
                type="submit"
              >
                {pending ? "Mentés..." : "Blokkolás mentése"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
