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
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">Szünetek és blokkolások</h2>
          <p className="mt-1 text-sm text-slate-600">
            A blokkolás az online foglalásból is kiveszi az érintett időt.
          </p>
        </div>
        <button
          className="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-800"
          onClick={() => setOpen(true)}
          type="button"
        >
          + Időpont blokkolása
        </button>
      </div>

      {blockouts.length === 0 ? (
        <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          Nincs rögzített jövőbeli blokkolás.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-slate-100">
          {blockouts.map((blockout) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
              key={blockout.id}
            >
              <div>
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
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  type="submit"
                >
                  Törlés
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          aria-labelledby="blockout-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
        >
          <form
            action={action}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
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
                className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
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
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                onChange={(event) => setStart(event.target.value)}
                required
                type="datetime-local"
                value={start}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Befejezés
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                onChange={(event) => setEnd(event.target.value)}
                required
                type="datetime-local"
                value={end}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Megjegyzés
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
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
                className="rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700"
                onClick={() => setOpen(false)}
                type="button"
              >
                Mégse
              </button>
              <button
                className="rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
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
