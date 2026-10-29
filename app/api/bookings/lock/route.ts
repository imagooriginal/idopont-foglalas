import { createSupabasePublicClient } from "@/lib/supabase/public";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LockRequest {
  companyId?: unknown;
  serviceIds?: unknown;
  start?: unknown;
  vehicleMake?: unknown;
  vehicleModel?: unknown;
  vehicleRegistration?: unknown;
}

export async function POST(request: Request) {
  let body: LockRequest;
  try {
    body = (await request.json()) as LockRequest;
  } catch {
    return Response.json({ error: "A kérés törzse nem érvényes JSON." }, { status: 400 });
  }

  if (
    typeof body.companyId !== "string" ||
    !uuidPattern.test(body.companyId) ||
    !Array.isArray(body.serviceIds) ||
    !body.serviceIds.length ||
    body.serviceIds.some(
      (serviceId) =>
        typeof serviceId !== "string" || !uuidPattern.test(serviceId),
    ) ||
    new Set(body.serviceIds).size !== body.serviceIds.length ||
    typeof body.start !== "string" ||
    !Number.isFinite(new Date(body.start).getTime()) ||
    typeof body.vehicleMake !== "string" ||
    typeof body.vehicleModel !== "string" ||
    typeof body.vehicleRegistration !== "string"
  ) {
    return Response.json({ error: "Hiányos vagy hibás foglalási adatok." }, { status: 400 });
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("create_booking_lock", {
    p_company_id: body.companyId,
    p_service_ids: body.serviceIds,
    p_start: new Date(body.start).toISOString(),
    p_vehicle_make: body.vehicleMake,
    p_vehicle_model: body.vehicleModel,
    p_vehicle_registration: body.vehicleRegistration,
  });

  if (error) {
    console.error("Booking lock RPC failed", error);
    const conflict = error.message.includes("no longer available");
    return Response.json(
      {
        error: conflict
          ? "Ezt az időpontot időközben lefoglalták. Válassz másikat."
          : "Az időpont zárolása nem sikerült. Ellenőrizd az adatokat, majd próbáld újra.",
      },
      { status: conflict ? 409 : 400 },
    );
  }

  const lock = data?.[0];
  if (!lock) {
    console.error("Booking lock RPC returned no lock data");
    return Response.json({ error: "A zárolás létrehozása nem sikerült." }, { status: 500 });
  }

  return Response.json({
    bookingId: lock.booking_id,
    lockToken: lock.lock_token,
    lockedUntil: lock.locked_until,
  });
}
