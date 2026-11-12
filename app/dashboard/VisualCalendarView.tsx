"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import type { StaffOption } from "./BookingActionsControl";

export interface CalendarBookingItem {
  id: string;
  customerName: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  staffId?: string | null;
  staffName?: string | null;
}

export interface CalendarBlockoutItem {
  id: string;
  startsAt: string;
  endsAt: string;
  note: string | null;
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMondayOfDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getLocalParts(isoString: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(isoString))
      .map(({ type, value }) => [type, value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    timeLabel: `${parts.hour}:${parts.minute}`,
  };
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // 08:00 .. 19:00

export default function VisualCalendarView({
  todayDate,
  timeZone,
  bookings,
  blockouts,
  staff = [],
}: {
  todayDate: string;
  timeZone: string;
  bookings: CalendarBookingItem[];
  blockouts: CalendarBlockoutItem[];
  staff?: StaffOption[];
}) {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [anchorDate, setAnchorDate] = useState(todayDate);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");

  const visibleDays = useMemo(() => {
    if (viewMode === "day") {
      return [anchorDate];
    }
    const monday = getMondayOfDate(anchorDate);
    return Array.from({ length: 7 }, (_, idx) => addDaysIso(monday, idx));
  }, [anchorDate, viewMode]);

  const filteredBookings = useMemo(() => {
    if (selectedStaffId === "all") return bookings;
    return bookings.filter(
      (b) => !b.staffId || b.staffId === selectedStaffId,
    );
  }, [bookings, selectedStaffId]);

  function shiftAnchor(direction: -1 | 1) {
    const step = viewMode === "week" ? 7 * direction : direction;
    setAnchorDate((prev) => addDaysIso(prev, step));
  }

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
      id="calendar-view"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t("Vizuális időrács", "Visual Schedule Grid")}
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            {t("Naptárnézet (Heti / Napi)", "Calendar View (Weekly / Daily)")}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {staff.length > 0 && (
            <select
              aria-label={t("Munkatárs szűrő", "Staff filter")}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
              onChange={(e) => setSelectedStaffId(e.target.value)}
              value={selectedStaffId}
            >
              <option value="all">
                {t("Minden munkatárs / állás", "All staff / workstations")}
              </option>
              {staff.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          )}

          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
            <button
              className={`rounded-lg px-3 py-1.5 transition ${
                viewMode === "week"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600"
              }`}
              onClick={() => setViewMode("week")}
              type="button"
            >
              {t("Heti nézet", "Week View")}
            </button>
            <button
              className={`rounded-lg px-3 py-1.5 transition ${
                viewMode === "day"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600"
              }`}
              onClick={() => setViewMode("day")}
              type="button"
            >
              {t("Napi nézet", "Day View")}
            </button>
          </div>

          <div className="inline-flex items-center gap-1">
            <button
              aria-label={t("Előző időszak", "Previous period")}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => shiftAnchor(-1)}
              type="button"
            >
              ←
            </button>
            <button
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setAnchorDate(todayDate)}
              type="button"
            >
              {t("Ma", "Today")}
            </button>
            <button
              aria-label={t("Következő időszak", "Next period")}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => shiftAnchor(1)}
              type="button"
            >
              →
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div
          className="grid min-w-[44rem] gap-2"
          style={{
            gridTemplateColumns: `3.5rem repeat(${visibleDays.length}, minmax(7.5rem, 1fr))`,
          }}
        >
          {/* Header Row */}
          <div className="text-xs font-semibold text-slate-400">
            {t("Óra", "Hour")}
          </div>
          {visibleDays.map((day) => {
            const isToday = day === todayDate;
            const label = new Intl.DateTimeFormat("hu-HU", {
              weekday: "short",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${day}T12:00:00.000Z`));
            return (
              <div
                className={`rounded-xl px-2.5 py-2 text-center text-xs font-bold ${
                  isToday
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
                key={day}
              >
                {label}
              </div>
            );
          })}

          {/* Hourly Rows */}
          {HOURS.map((hour) => (
            <div className="contents" key={hour}>
              <div className="border-t border-slate-100 py-2 pr-2 text-right text-xs font-medium text-slate-400">
                {String(hour).padStart(2, "0")}:00
              </div>
              {visibleDays.map((day) => {
                const cellBookings = filteredBookings.filter((b) => {
                  const p = getLocalParts(b.startsAt, timeZone);
                  return p.dateKey === day && p.hour === hour;
                });
                const cellBlockouts = blockouts.filter((bl) => {
                  const p = getLocalParts(bl.startsAt, timeZone);
                  return p.dateKey === day && p.hour === hour;
                });

                return (
                  <div
                    className="min-h-12 space-y-1 border-t border-slate-100 p-1"
                    key={`${day}-${hour}`}
                  >
                    {cellBookings.map((b) => {
                      const startP = getLocalParts(b.startsAt, timeZone);
                      const endP = getLocalParts(b.endsAt, timeZone);
                      return (
                        <div
                          className="rounded-lg border border-blue-200 bg-blue-50/90 px-2 py-1 text-[11px] leading-tight text-blue-950 shadow-2xs"
                          key={b.id}
                        >
                          <p className="font-bold">
                            {startP.timeLabel}–{endP.timeLabel}
                          </p>
                          <p className="truncate font-semibold">
                            {b.customerName}
                          </p>
                          <p className="truncate text-[10px] text-blue-700">
                            {b.serviceName}
                            {b.staffName ? ` · ${b.staffName}` : ""}
                          </p>
                        </div>
                      );
                    })}
                    {cellBlockouts.map((bl) => {
                      const startP = getLocalParts(bl.startsAt, timeZone);
                      const endP = getLocalParts(bl.endsAt, timeZone);
                      return (
                        <div
                          className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-tight text-amber-900"
                          key={bl.id}
                        >
                          <p className="font-bold">
                            {startP.timeLabel}–{endP.timeLabel}
                          </p>
                          <p className="truncate">
                            {bl.note || t("Zárva", "Blocked")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
