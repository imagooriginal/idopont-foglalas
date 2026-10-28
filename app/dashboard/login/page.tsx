import { redirect } from "next/navigation";
import { connection } from "next/server";
import LoginForm from "./LoginForm";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function DashboardLoginPage() {
  await connection();

  if (!getSupabasePublicConfig()) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-2xl font-bold">Szolgáltatói belépés</h1>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
          A belépéshez állítsd be a Supabase környezeti változókat a
          fejlesztői környezetben.
        </p>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
          Időpontfoglaló
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">
          Szolgáltatói belépés
        </h1>
        <p className="mb-7 mt-2 text-slate-600">
          Jelentkezz be a foglalások és a műhely szüneteinek kezeléséhez.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
