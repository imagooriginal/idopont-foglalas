import { createIcsCalendarFeed } from "@/lib/calendar";
import { uuidSchema } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface FeedBookingRow {
  id: string;
  service_id: string;
  ugyfel_nev: string | null;
  ugyfel_telefon: string | null;
  ugyfel_email: string | null;
  kezdes_ideje: string;
  vege_ideje: string;
  status: string;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ feedToken: string }> },
) {
  const { feedToken } = await context.params;
  const cleanToken = feedToken.replace(/\.ics$/i, "");
  const parsedToken = uuidSchema.safeParse(cleanToken);
  if (!parsedToken.success) {
    return new Response("Invalid calendar feed token", { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: company } = await admin
    .from("companies")
    .select("id, nev, slug")
    .eq("calendar_feed_token", parsedToken.data)
    .maybeSingle();

  if (!company) {
    return new Response("Calendar feed not found", { status: 404 });
  }

  const thirtyDaysAgoIso = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const bookingCols: string =
    "id, service_id, ugyfel_nev, ugyfel_telefon, ugyfel_email, kezdes_ideje, vege_ideje, status";
  const [bookingsRes, blockoutsRes, servicesRes] = await Promise.all([
    admin
      .from("bookings")
      .select(bookingCols)
      .eq("cég_id", company.id)
      .eq("status", "confirmed")
      .gte("vege_ideje", thirtyDaysAgoIso)
      .order("kezdes_ideje", { ascending: true })
      .limit(500),
    admin
      .from("manual_blockouts")
      .select("id, kezdes_ideje, vege_ideje, megjegyzes")
      .eq("cég_id", company.id)
      .gte("vege_ideje", thirtyDaysAgoIso)
      .order("kezdes_ideje", { ascending: true })
      .limit(200),
    admin.from("services").select("id, nev").eq("cég_id", company.id),
  ]);

  const serviceMap = new Map(
    (servicesRes.data ?? []).map((s: { id: string; nev: string }) => [s.id, s.nev]),
  );

  const bookings = (bookingsRes.data ?? []) as unknown as FeedBookingRow[];
  const events = [
    ...bookings.map((b) => {
      const sName = serviceMap.get(b.service_id) ?? "Időpontfoglalás";
      const customer = b.ugyfel_nev || "Ügyfél";
      const details = [
        `Szolgáltatás: ${sName}`,
        `Ügyfél: ${customer}`,
        b.ugyfel_telefon ? `Telefon: ${b.ugyfel_telefon}` : "",
        b.ugyfel_email ? `E-mail: ${b.ugyfel_email}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        uid: `booking-${b.id}@idopont-foglalo`,
        title: `${customer} – ${sName}`,
        description: details,
        start: new Date(b.kezdes_ideje),
        end: new Date(b.vege_ideje),
      };
    }),
    ...(blockoutsRes.data ?? []).map(
      (bl: {
        id: string;
        kezdes_ideje: string;
        vege_ideje: string;
        megjegyzes: string | null;
      }) => ({
        uid: `blockout-${bl.id}@idopont-foglalo`,
        title: `ZÁRVA: ${bl.megjegyzes || "Blokkolt időszak"}`,
        description: bl.megjegyzes || "Időszakos szünet / zárvatartás",
        start: new Date(bl.kezdes_ideje),
        end: new Date(bl.vege_ideje),
      }),
    ),
  ];

  const icsContent = createIcsCalendarFeed(
    `${company.nev} – Foglalási naptár`,
    events,
  );

  return new Response(icsContent, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${company.slug}-calendar.ics"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
