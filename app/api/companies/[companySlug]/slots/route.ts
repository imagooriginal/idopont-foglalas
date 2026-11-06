import { slotsQuerySchema } from "@/lib/security";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companySlug: string }> },
) {
  const { companySlug } = await params;
  const url = new URL(request.url);
  const rawServiceIds = (url.searchParams.get("serviceIds") ?? "")
    .split(",")
    .filter(Boolean);
  const rawWeekStart = url.searchParams.get("weekStart") ?? "";

  const parsed = slotsQuerySchema.safeParse({
    companySlug,
    serviceIds: rawServiceIds,
    weekStart: rawWeekStart,
  });

  if (!parsed.success) {
    const hasWeekStartError = parsed.error.issues.some((issue) =>
      issue.path.includes("weekStart"),
    );
    const hasServiceError = parsed.error.issues.some(
      (issue) =>
        issue.path.includes("serviceIds") || issue.path.includes("companySlug"),
    );
    if (!hasServiceError && hasWeekStartError && /^\d{4}-\d{2}-\d{2}$/.test(rawWeekStart)) {
      return Response.json(
        { error: "A hét kezdőnapja érvénytelen." },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Érvénytelen szolgáltatás vagy dátum." },
      { status: 400 },
    );
  }

  const { serviceIds, weekStart } = parsed.data;

  const supabase = createSupabasePublicClient();
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", parsed.data.companySlug)
    .maybeSingle();

  if (companyError) {
    console.error("Company lookup failed for public slot query", companyError);
    return Response.json(
      { error: "Az elérhetőségek nem tölthetők be." },
      { status: 500 },
    );
  }
  if (!company) {
    return Response.json(
      { error: "A szolgáltató nem található." },
      { status: 404 },
    );
  }

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
            "A heti naptár adatbázis-frissítése hiányzik. Futtasd le sorrendben a Supabase-migrációkat, köztük a 20261102230000_booking_rpc_and_public_hours_fallback.sql fájlt.",
        },
        { status: 503 },
      );
    }
    if (
      error.code === "P0001" &&
      error.message === "Company or selected active services are unavailable."
    ) {
      return Response.json(
        {
          error:
            "A szolgáltató nem aktív, vagy a kiválasztott szolgáltatás nem érhető el ennél a szolgáltatónál.",
        },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Az elérhetőségek nem tölthetők be." },
      { status: 500 },
    );
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
