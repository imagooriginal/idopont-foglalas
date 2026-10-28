import { notFound } from "next/navigation";
import { connection } from "next/server";
import BookingWidget from "@/components/BookingWidget";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export const instant = false;

interface CompanyBookingPageProps {
  params: Promise<{ companySlug: string }>;
}

function getLocalDay(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function CompanyBookingPage({
  params,
}: CompanyBookingPageProps) {
  await connection();

  const { companySlug } = await params;
  if (!getSupabasePublicConfig()) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Online időpontfoglalás</h1>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
          Az online foglalás használatához állítsd be a Supabase
          környezeti változókat.
        </p>
      </main>
    );
  }

  const supabase = createSupabasePublicClient();
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, nev, slug, time_zone")
    .eq("slug", companySlug)
    .maybeSingle();

  if (companyError) {
    console.error("Public company lookup failed", companyError);
    throw new Error("A szolgáltató adatainak betöltése nem sikerült.");
  }
  if (!company) notFound();

  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, nev, idotartam_percben, ar")
    .eq("cég_id", company.id)
    .order("nev", { ascending: true });

  if (servicesError) {
    console.error("Public services lookup failed", servicesError);
    throw new Error("A szolgáltatások betöltése nem sikerült.");
  }

  const timeZone = company.time_zone || "Europe/Budapest";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 sm:py-16">
      <BookingWidget
        companyId={company.id}
        companyName={company.nev}
        companySlug={company.slug}
        initialDay={getLocalDay(timeZone)}
        services={services ?? []}
        timeZone={timeZone}
      />
      <footer className="mx-auto mt-8 flex max-w-2xl justify-center gap-5 text-sm text-slate-500">
        <a className="underline hover:text-slate-800" href="/aszf.pdf">
          ÁSZF
        </a>
        <a
          className="underline hover:text-slate-800"
          href="/adatvedelmi-tajekoztato.pdf"
        >
          Adatvédelmi tájékoztató
        </a>
      </footer>
    </main>
  );
}
