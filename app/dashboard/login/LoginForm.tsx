"use client";

import { useActionState, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import { signInAction, type ActionState } from "../actions";
import { submitPasswordResetAction } from "./reset-action";

const initialState: ActionState = {};

export default function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);
  const [resetState, resetAction, resetPending] = useActionState(
    submitPasswordResetAction,
    initialState,
  );
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-5">
        {state.error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {state.error}
          </p>
        )}
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t("E-mail-cím", "Email address")}
          <input
            required
            autoComplete="email"
            name="email"
            type="email"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          {t("Jelszó", "Password")}
          <input
            required
            autoComplete="current-password"
            minLength={8}
            name="password"
            type="password"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <button
          className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending
            ? t("Bejelentkezés...", "Signing in...")
            : t("Bejelentkezés", "Sign in")}
        </button>
      </form>

      <div className="border-t border-slate-100 pt-3 text-center">
        <button
          className="text-xs font-semibold text-blue-700 hover:underline"
          onClick={() => setShowForgotPassword((prev) => !prev)}
          type="button"
        >
          {t("Elfelejtett jelszó?", "Forgot password?")}
        </button>

        {showForgotPassword && (
          <form action={resetAction} className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
            <p className="text-xs text-slate-600">
              {t(
                "Add meg az e-mail-címed, és küldünk egy jelszó-visszaállító linket.",
                "Enter your email address and we will send you a password reset link.",
              )}
            </p>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600"
              name="email"
              placeholder="pelda@muhely.hu"
              required
              type="email"
            />
            {resetState.error && (
              <p className="text-xs font-semibold text-red-600">{resetState.error}</p>
            )}
            {resetState.success && (
              <p className="text-xs font-semibold text-emerald-700">{resetState.success}</p>
            )}
            <button
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              disabled={resetPending}
              type="submit"
            >
              {resetPending
                ? t("Küldés...", "Sending...")
                : t("Visszaállító link küldése", "Send Reset Link")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
