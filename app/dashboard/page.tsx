import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signOutAction } from "./actions";
import BlockoutManager from "./BlockoutManager";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

interface DashboardPageProps {
  searchParams: Promise<{ company?: string }>;
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  await connection();

  if (!getSupabasePublicConfig()) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-3xl font-bold">Szolgáltatói dashboard</h1>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
          A dashboardhoz állítsd be a Supabase környezeti változókat.
        </p>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/dashboard/login");

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, nev, slug, status, time_zone")
    .eq("owner_id", userData.user.id)

  if (companiesError) throw new Error(`Cégek betöltése nem sikerült: ${companiesError.message}`);

  if (!companies?.length) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <DashboardHeader email={userData.user.email ?? ""} />
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-2xl font-bold">Még nincs szolgáltatód</h1>
          <p className="mt-3 text-slate-600">
            Ehhez a felhasználóhoz nem tartozik szolgáltató. A kezdeti
            prototípusban a platform-admin hozza létre vagy hagyja jóvá a céget.
          </p>
        </section>
      </main>
    );
  }

  const { company: requestedCompanyId } = await searchParams;
  const company =
    companies.find((item) => item.id === requestedCompanyId) ?? companies[0];
  const now = new Date().toISOString();
  const [bookingsResult, blockoutsResult, servicesResult] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, service_id, ugyfel_nev, ugyfel_email, ugyfel_telefon, jarmu_marka, jarmu_modell, jarmu_rendszam, kezdes_ideje, vege_ideje",
      )
      .eq("cég_id", company.id)
      .eq("status", "confirmed")
      .gte("kezdes_ideje", now)
      .order("kezdes_ideje", { ascending: true })
      .limit(50),
    supabase
      .from("manual_blockouts")
      .select("id, kezdes_ideje, vege_ideje, megjegyzes")
      .eq("cég_id", company.id)
      .gte("vege_ideje", now)
      .order("kezdes_ideje", { ascending: true })
      .limit(50),
    supabase
      .from("services")
      .select("id, nev")
      .eq("cég_id", company.id),
  ]);

  if (bookingsResult.error) {
    throw new Error(`Foglalások betöltése nem sikerült: ${bookingsResult.error.message}`);
  }
  if (blockoutsResult.error) {
    throw new Error(`Blokkolások betöltése nem sikerült: ${blockoutsResult.error.message}`);
  }
  if (servicesResult.error) {
    throw new Error(`Szolgáltatások betöltése nem sikerült: ${servicesResult.error.message}`);
  }

  const serviceNames = new Map(
    (servicesResult.data ?? []).map((service) => [service.id, service.nev]),
  );
  const timeZone = company.time_zone || "Europe/Budapest";

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <DashboardHeader email={userData.user.email ?? ""} />
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
            Szolgáltatói dashboard
          </p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950">
            {company.nev}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            /{company.slug} · {company.status === "active" ? "Aktív" : "Jóváhagyásra vár"}
          </p>
        </div>
        {companies.length > 1 && (
          <form action="/dashboard" className="flex items-center gap-2">
            <label className="text-sm font-medium" htmlFor="company">
              Szolgáltató
            </label>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              defaultValue={company.id}
              id="company"
              name="company"
            >
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nev}
                </option>
              ))}
            </select>
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
              type="submit"
            >
              Megnyitás
            </button>
          </form>
        )}
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Közelgő foglalások</h2>
          <p className="mt-1 text-sm text-slate-600">
            A következő 50 visszaigazolt időpont.
          </p>
          {!bookingsResult.data?.length ? (
            <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              Nincs közelgő foglalás.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {bookingsResult.data.map((booking) => (
                <li className="py-4 first:pt-0 last:pb-0" key={booking.id}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      {booking.ugyfel_nev || "Ügyfél"}
                    </p>
                    <time className="text-sm font-medium text-blue-800">
                      {formatDate(booking.kezdes_ideje, timeZone)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {serviceNames.get(booking.service_id) || "Szolgáltatás"}
                    {" · "}
                    {formatDate(booking.kezdes_ideje, timeZone)}
                    {" – "}
                    {new Intl.DateTimeFormat("hu-HU", {
                      timeStyle: "short",
                      timeZone,
                    }).format(new Date(booking.vege_ideje))}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {booking.jarmu_marka} {booking.jarmu_modell}
                    {booking.jarmu_rendszam
                      ? ` · ${booking.jarmu_rendszam}`
                      : ""}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {booking.ugyfel_email}
                    {booking.ugyfel_telefon
                      ? ` · ${booking.ugyfel_telefon}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <BlockoutManager
          blockouts={blockoutsResult.data ?? []}
          companyId={company.id}
          timeZone={timeZone}
        />
      </div>
    </main>
  );
}

function DashboardHeader({ email }: { email: string }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <p className="truncate text-sm text-slate-600">{email}</p>
      <form action={signOutAction}>
        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-white"
          type="submit"
        >
          Kijelentkezés
        </button>
      </form>
    </header>
  );
}
