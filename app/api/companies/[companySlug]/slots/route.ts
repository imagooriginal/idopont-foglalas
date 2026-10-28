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
  const serviceId = url.searchParams.get("serviceId") ?? "";
  const day = url.searchParams.get("day") ?? "";

  if (!uuidPattern.test(serviceId) || !datePattern.test(day)) {
    return Response.json({ error: "Érvénytelen szolgáltatás vagy dátum." }, { status: 400 });
  }

  const parsedDay = new Date(`${day}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== day
  ) {
    return Response.json({ error: "Érvénytelen dátum." }, { status: 400 });
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

  const { data, error } = await supabase.rpc("list_available_slots", {
    p_company_id: company.id,
    p_service_id: serviceId,
    p_day: day,
  });

  if (error) {
    console.error("Available-slot lookup failed", error);
    return Response.json({ error: "Az elérhetőségek nem tölthetők be." }, { status: 500 });
  }

  return Response.json({
    slots: (data ?? []).map((row: { slot_start: string }) => row.slot_start),
  });
}
