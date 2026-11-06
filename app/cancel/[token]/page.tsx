import { notFound } from "next/navigation";
import { connection } from "next/server";
import CancelBookingClient from "./CancelBookingClient";
import { uuidSchema } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export const instant = false;

interface CancelBookingPageProps {
  params: Promise<{ token: string }>;
}

interface CancelBookingLookupRow {
  id: string;
  cég_id: string;
  service_id: string;
  ugyfel_nev: string | null;
  kezdes_ideje: string;
  status: string;
  cancellation_token: string | null;
}

export default async function CancelBookingPage({
  params,
}: CancelBookingPageProps) {
  await connection();

  const { token } = await params;
  const parsedToken = uuidSchema.safeParse(token);
  if (!parsedToken.success) {
    notFound();
  }

  if (!getSupabasePublicConfig()) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">Időpont lemondása</h1>
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-900">
          A szolgáltatás használatához állítsd be a Supabase környezeti változókat.
        </p>
      </main>
    );
  }

  const admin = createSupabaseAdminClient();
  const bookingColumns: string =
    "id, cég_id, service_id, ugyfel_nev, kezdes_ideje, status, cancellation_token";
  const { data: rawBooking } = await admin
    .from("bookings")
    .select(bookingColumns)
    .eq("cancellation_token", parsedToken.data)
    .maybeSingle();

  const booking = rawBooking as CancelBookingLookupRow | null;
  if (!booking) {
    notFound();
  }

  const [{ data: company }, { data: service }] = await Promise.all([
    admin
      .from("companies")
      .select("id, nev, plan, time_zone")
      .eq("id", booking.cég_id)
      .maybeSingle(),
    admin
      .from("services")
      .select("nev")
      .eq("id", booking.service_id)
      .maybeSingle(),
  ]);

  if (!company) {
    notFound();
  }

  const timeZone = company.time_zone || "Europe/Budapest";
  const startsAt = new Date(booking.kezdes_ideje);
  const startsAtFormatted = new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(startsAt);
  const isWithin24Hours =
    startsAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 sm:px-6">
      <CancelBookingClient
        companyName={company.nev}
        customerName={booking.ugyfel_nev || "Ügyfél"}
        isAlreadyCancelled={booking.status !== "confirmed"}
        isProCompany={company.plan === "pro"}
        isWithin24Hours={isWithin24Hours}
        serviceName={service?.nev || "Szolgáltatás"}
        startsAtFormatted={startsAtFormatted}
        token={parsedToken.data}
      />
    </main>
  );
}
