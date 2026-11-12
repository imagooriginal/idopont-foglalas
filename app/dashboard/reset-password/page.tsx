"use client";

import { useActionState } from "react";
import { useLanguage } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { updatePasswordAction, type ActionState } from "../actions";

const initialState: ActionState = {};

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(
    updatePasswordAction,
    initialState,
  );
  const { t } = useLanguage();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              {t("Fiókbiztonság", "Account Security")}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">
              {t("Új jelszó beállítása", "Set New Password")}
            </h1>
          </div>
          <LanguageSwitcher />
        </div>

        <form action={action} className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            {t("Új jelszó", "New password")}
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            {t("Új jelszó megerősítése", "Confirm new password")}
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              minLength={8}
              name="passwordConfirm"
              required
              type="password"
            />
          </label>

          {state.error && (
            <p className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700" role="alert">
              {state.error}
            </p>
          )}
          {state.success && (
            <p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700" role="status">
              {state.success}
            </p>
          )}

          <button
            className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending
              ? t("Mentés...", "Saving...")
              : t("Jelszó frissítése", "Update Password")}
          </button>
        </form>

        <div className="mt-5 text-center">
          <a
            className="text-xs font-semibold text-blue-700 hover:underline"
            href="/dashboard/login"
          >
            {t("Vissza a bejelentkezéshez", "Back to Sign In")}
          </a>
        </div>
      </div>
    </main>
  );
}
