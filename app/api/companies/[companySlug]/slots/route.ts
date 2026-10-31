import { createSupabasePublicClient } from "@/lib/supabase/public";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companySlug: string }> },
) {
  const { companySlug } = await params;
  const url = new URL(request.url);
  const serviceIds = (url.searchParams.get("serviceIds") ?? "").split(",");
  const weekStart = url.searchParams.get("weekStart") ?? "";

  if (
    !serviceIds.length ||
    serviceIds.some((serviceId) => !uuidPattern.test(serviceId)) ||
    new Set(serviceIds).size !== serviceIds.length ||
    !datePattern.test(weekStart)
  ) {
    return Response.json({ error: "Érvénytelen szolgáltatás vagy dátum." }, { status: 400 });
  }

  const parsedDay = new Date(`${weekStart}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== weekStart ||
    parsedDay.getUTCDay() !== 1
  ) {
    return Response.json({ error: "A hét kezdőnapja érvénytelen." }, { status: 400 });
  }

  const supabase = createSupabasePublicClient();
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", companySlug)
    .maybeSingle();

  if (companyError) {
    console.error("Company lookup failed for public slot query", companyError);
    return Response.json({ error: "Az elérhetőségek nem tölthetők be." }, { status: 500 });
  }
  if (!company) return Response.json({ error: "A szolgáltató nem található." }, { status: 404 });

  const { data, error } = await supabase.rpc("list_week_slot_grid", {
    p_company_id: company.id,
    p_service_ids: serviceIds,
    p_week_start: weekStart,
  });

  if (error) {
    console.error("Available-slot lookup failed", error);
    if (error.code === "PGRST202" || error.code === "42883") {
      return Response.json(
        {
          error:
            "A heti naptár adatbázis-frissítése hiányzik. Futtasd le a 20261031190000_weekly_slot_grid.sql migrációt a Supabase projektben.",
        },
        { status: 503 },
      );
    }
    return Response.json({ error: "Az elérhetőségek nem tölthetők be." }, { status: 500 });
  }

  return Response.json({
    slots: (data ?? []).map(
      (row: { slot_start: string; is_available: boolean }) => ({
        slotStart: row.slot_start,
        available: row.is_available,
      }),
    ),
  });
}
