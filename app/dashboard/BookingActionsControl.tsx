"use client";

import { useActionState, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  cancelBookingByProviderAction,
  rescheduleBookingByProviderAction,
  type ActionState,
} from "./actions";

export interface StaffOption {
  id: string;
  name: string;
  role_title: string;
  is_active: boolean;
}

const initialState: ActionState = {};

export default function BookingActionsControl({
  companyId,
  bookingId,
  currentStaffId,
  staffOptions = [],
}: {
  companyId: string;
  bookingId: string;
  currentStaffId?: string | null;
  staffOptions?: StaffOption[];
}) {
  const { t } = useLanguage();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newStartLocal, setNewStartLocal] = useState("");
  const [rescheduleState, rescheduleAction, rescheduling] = useActionState(
    rescheduleBookingByProviderAction,
    initialState,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelBookingByProviderAction,
    initialState,
  );

  const newStartIso = newStartLocal
    ? (() => {
        const d = new Date(newStartLocal);
        return Number.isFinite(d.getTime()) ? d.toISOString() : "";
      })()
    : "";

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 transition hover:bg-blue-100"
          onClick={() => setRescheduleOpen((prev) => !prev)}
          type="button"
        >
          {t("Átütemezés", "Reschedule")}
        </button>

        <form action={cancelAction}>
          <input name="companyId" type="hidden" value={companyId} />
          <input name="bookingId" type="hidden" value={bookingId} />
          <button
            className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
            disabled={cancelling}
            type="submit"
          >
            {cancelling
              ? t("Lemondás...", "Cancelling...")
              : t("Lemondás", "Cancel")}
          </button>
        </form>
      </div>

      {rescheduleOpen && (
        <form
          action={rescheduleAction}
          className="space-y-2 rounded-xl border border-blue-100 bg-slate-50 p-2.5 text-xs"
        >
          <input name="companyId" type="hidden" value={companyId} />
          <input name="bookingId" type="hidden" value={bookingId} />
          <input name="newStart" type="hidden" value={newStartIso} />
          <label className="block space-y-1 font-semibold text-slate-700">
            {t("Új időpont", "New Date & Time")}
            <input
              aria-label={t("Új időpont", "New Date & Time")}
              className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-normal text-slate-900"
              onChange={(e) => setNewStartLocal(e.target.value)}
              required
              type="datetime-local"
              value={newStartLocal}
            />
          </label>
          {staffOptions.length > 0 && (
            <label className="block space-y-1 font-semibold text-slate-700">
              {t("Munkatárs / Állás", "Staff / Workstation")}
              <select
                className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-normal text-slate-900"
                defaultValue={currentStaffId ?? ""}
                name="staffId"
              >
                <option value="">
                  {t("Bármely szabad munkatárs", "Any available staff")}
                </option>
                {staffOptions
                  .filter((s) => s.is_active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              disabled={rescheduling || !newStartIso}
              type="submit"
            >
              {rescheduling
                ? t("Mentés...", "Saving...")
                : t("Új időpont mentése", "Save New Time")}
            </button>
            <button
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              onClick={() => setRescheduleOpen(false)}
              type="button"
            >
              {t("Mégse", "Close")}
            </button>
          </div>
        </form>
      )}

      {rescheduleState.error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {rescheduleState.error}
        </p>
      )}
      {rescheduleState.success && (
        <p className="text-xs font-medium text-emerald-700" role="status">
          {rescheduleState.success}
        </p>
      )}
      {cancelState.error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {cancelState.error}
        </p>
      )}
      {cancelState.success && (
        <p className="text-xs font-medium text-emerald-700" role="status">
          {cancelState.success}
        </p>
      )}
    </div>
  );
}
