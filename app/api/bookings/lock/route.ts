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
  customFields?: unknown;
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
    (body.vehicleMake !== undefined &&
      (typeof body.vehicleMake !== "string" || body.vehicleMake.length > 100)) ||
    (body.vehicleModel !== undefined &&
      (typeof body.vehicleModel !== "string" || body.vehicleModel.length > 100)) ||
    (body.vehicleRegistration !== undefined &&
      (typeof body.vehicleRegistration !== "string" ||
        body.vehicleRegistration.length > 20)) ||
    (body.customFields !== undefined &&
      (!body.customFields ||
        typeof body.customFields !== "object" ||
        Array.isArray(body.customFields) ||
        Object.keys(body.customFields).length > 20 ||
        Object.entries(body.customFields).some(
          ([key, value]) =>
            !/^[a-z0-9_]{1,40}$/.test(key) ||
            typeof value !== "string" ||
            value.length > 500,
        )))
  ) {
    return Response.json({ error: "Hiányos vagy hibás foglalási adatok." }, { status: 400 });
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("create_booking_lock", {
    p_company_id: body.companyId,
    p_service_ids: body.serviceIds,
    p_start: new Date(body.start).toISOString(),
    p_vehicle_make:
      typeof body.vehicleMake === "string" ? body.vehicleMake : null,
    p_vehicle_model:
      typeof body.vehicleModel === "string" ? body.vehicleModel : null,
    p_vehicle_registration:
      typeof body.vehicleRegistration === "string"
        ? body.vehicleRegistration
        : null,
    p_custom_fields:
      body.customFields && typeof body.customFields === "object"
        ? body.customFields
        : {},
  });

  if (error) {
    console.error("Booking lock RPC failed", error);
    const conflict = error.message.includes("no longer available");
    const missingMigration =
      error.code === "PGRST202" ||
      (error.code === "42883" && error.message.includes("create_booking_lock"));
    if (missingMigration) {
      return Response.json(
        {
          error:
            "A foglalási adatbázis-frissítés hiányzik. Futtasd le sorrendben a Supabase-migrációkat, köztük a 20261102220000_dynamic_booking_fields_and_service_access.sql fájlt.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        error: conflict
          ? "Ezt az időpontot időközben lefoglalták. Válassz másikat."
          : "Az időpont zárolása nem sikerült. Ellenőrizd az adatokat, majd próbáld újra.",
      },
      {
        status: conflict
          ? 409
          : error.code === "P0001" || error.code === "22023"
            ? 400
            : 500,
      },
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
