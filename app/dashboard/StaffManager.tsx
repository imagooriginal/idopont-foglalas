"use client";

import { useActionState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  createStaffMemberAction,
  deleteStaffMemberAction,
  toggleStaffMemberActiveAction,
  type ActionState,
} from "./actions";
import type { StaffOption } from "./BookingActionsControl";

const initialState: ActionState = {};

function StaffRow({
  companyId,
  member,
}: {
  companyId: string;
  member: StaffOption;
}) {
  const { t } = useLanguage();
  const [toggleState, toggleAction, toggling] = useActionState(
    toggleStaffMemberActiveAction.bind(
      null,
      companyId,
      member.id,
      !member.is_active,
    ),
    initialState,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteStaffMemberAction,
    initialState,
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-900">{member.name}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              member.is_active
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {member.is_active ? t("Aktív", "Active") : t("Inaktív", "Inactive")}
          </span>
        </div>
        {member.role_title && (
          <p className="mt-0.5 text-xs text-slate-500">{member.role_title}</p>
        )}
        {(toggleState.error || deleteState.error) && (
          <p className="mt-1 text-xs text-red-600">
            {toggleState.error || deleteState.error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <form action={toggleAction}>
          <button
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={toggling}
            type="submit"
          >
            {member.is_active
              ? t("Szüneteltetés", "Deactivate")
              : t("Aktiválás", "Activate")}
          </button>
        </form>
        <form action={deleteAction}>
          <input name="companyId" type="hidden" value={companyId} />
          <input name="staffId" type="hidden" value={member.id} />
          <button
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            disabled={deleting}
            type="submit"
          >
            {t("Törlés", "Delete")}
          </button>
        </form>
      </div>
    </li>
  );
}

export default function StaffManager({
  companyId,
  staff,
}: {
  companyId: string;
  staff: StaffOption[];
}) {
  const { t } = useLanguage();
  const [state, action, pending] = useActionState(
    createStaffMemberAction,
    initialState,
  );

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
      id="staff-manager"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            {t("Erőforrások és beosztás", "Resources & Team")}
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            {t(
              "Munkatársak és munkaállomások kezelése",
              "Manage Staff Members & Workstations",
            )}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {t(
              "Adj hozzá több munkatársat vagy szerelőállást, hogy párhuzamosan vagy személyre szabva is fogadhass időpontokat.",
              "Add multiple staff members or workstations to handle parallel or assigned bookings.",
            )}
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          {staff.filter((s) => s.is_active).length}{" "}
          {t("aktív munkatárs / állás", "active staff / stations")}
        </span>
      </div>

      <form
        action={action}
        className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[1fr_1fr_auto]"
      >
        <input name="companyId" type="hidden" value={companyId} />
        <label className="space-y-1 text-xs font-semibold text-slate-700">
          {t("Munkatárs vagy állás neve *", "Staff or Workstation Name *")}
          <input
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
            maxLength={100}
            name="name"
            placeholder={t(
              "Pl. Kovács Gábor / 1-es Szerelőállás",
              "e.g. Alex Smith / Bay 1",
            )}
            required
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-700">
          {t("Pozíció / megjegyzés", "Role / Description")}
          <input
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
            maxLength={100}
            name="roleTitle"
            placeholder={t("Pl. Vezető szerelő", "e.g. Senior Technician")}
          />
        </label>
        <button
          className="self-end rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending
            ? t("Mentés...", "Saving...")
            : t("Munkatárs hozzáadása", "Add Staff Member")}
        </button>
      </form>

      {state.error && (
        <p className="mt-3 text-xs font-semibold text-red-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="mt-3 text-xs font-semibold text-emerald-700" role="status">
          {state.success}
        </p>
      )}

      {staff.length > 0 && (
        <ul className="mt-4 space-y-2">
          {staff.map((member) => (
            <StaffRow companyId={companyId} key={member.id} member={member} />
          ))}
        </ul>
      )}
    </section>
  );
}
