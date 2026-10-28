"use client";

import { useActionState } from "react";
import { signInAction, type ActionState } from "../actions";

const initialState: ActionState = {};

export default function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <label className="block space-y-2 text-sm font-medium text-slate-700">
        E-mail-cím
        <input
          required
          autoComplete="email"
          name="email"
          type="email"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
        />
      </label>
      <label className="block space-y-2 text-sm font-medium text-slate-700">
        Jelszó
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
        {pending ? "Bejelentkezés..." : "Bejelentkezés"}
      </button>
    </form>
  );
}
