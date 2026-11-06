import {
  buildCustomBookingFieldsSchema,
  checkRateLimit,
  countActiveClientLocks,
  customBookingFieldDefinitionsListSchema,
  extractClientIdentifier,
  lockRequestSchema,
  registerActiveClientLock,
} from "@/lib/security";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { error: "A kérés törzse nem érvényes JSON." },
      { status: 400 },
    );
  }

  const parsed = lockRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Hiányos vagy hibás foglalási adatok." },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const clientId = extractClientIdentifier(request);
  if (clientId) {
    const rateLimit = checkRateLimit("booking_lock", clientId, 5, 10 * 60 * 1000);
    if (!rateLimit.allowed) {
      return Response.json(
        {
          error:
            "Túl sok zárolási próbálkozás rövid időn belül. Kérlek, várj néhány percet.",
        },
        { status: 429 },
      );
    }

    if (countActiveClientLocks(clientId) >= 3) {
      return Response.json(
        {
          error:
            "Egyszerre legfeljebb 3 aktív időpont-zárolásod lehet. Fejezd be a megkezdett foglalást, vagy várd meg a zárolás lejártát.",
        },
        { status: 429 },
      );
    }
  }

  const supabase = createSupabasePublicClient();
  let validatedCustomFields: Record<string, string> = body.customFields ?? {};

  if (typeof (supabase as { from?: unknown }).from === "function") {
    const { data: companyData } = await supabase
      .from("companies")
      .select("plan, custom_booking_fields")
      .eq("id", body.companyId)
      .maybeSingle();

    const companyPlan = (companyData as { plan?: string } | null)?.plan;
    if (companyPlan === "starter") {
      validatedCustomFields = {};
    } else if (companyData?.custom_booking_fields !== undefined) {
      const definitionsResult =
        customBookingFieldDefinitionsListSchema.safeParse(
          companyData.custom_booking_fields,
        );
      if (!definitionsResult.success) {
        return Response.json(
          { error: "A szolgáltató egyedi mezői hibásan vannak konfigurálva." },
          { status: 500 },
        );
      }

      const dynamicSchema = buildCustomBookingFieldsSchema(
        definitionsResult.data,
      );
      const customParse = dynamicSchema.safeParse(body.customFields ?? {});
      if (!customParse.success) {
        return Response.json(
          { error: "Hiányos vagy hibás foglalási adatok." },
          { status: 400 },
        );
      }
      validatedCustomFields = customParse.data;
    }
  }

  const { data, error } = await supabase.rpc("create_booking_lock", {
    p_company_id: body.companyId,
    p_service_ids: body.serviceIds,
    p_start: new Date(body.start).toISOString(),
    p_vehicle_make: body.vehicleMake || null,
    p_vehicle_model: body.vehicleModel || null,
    p_vehicle_registration: body.vehicleRegistration || null,
    p_custom_fields: validatedCustomFields,
  });

  if (error) {
    console.error("Booking lock RPC failed", error);
    const conflict = error.message.includes("no longer available");
    const rateLimited =
      error.message.includes("Rate limit exceeded") ||
      error.message.includes("Too many active booking locks");
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

    if (rateLimited) {
      return Response.json(
        {
          error:
            "Túl sok aktív zárolás vagy próbálkozás. Kérlek, várj néhány percet.",
        },
        { status: 429 },
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
    return Response.json(
      { error: "A zárolás létrehozása nem sikerült." },
      { status: 500 },
    );
  }

  if (clientId) {
    registerActiveClientLock(clientId, lock.lock_token, lock.locked_until);
  }

  return Response.json({
    bookingId: lock.booking_id,
    lockToken: lock.lock_token,
    lockedUntil: lock.locked_until,
  });
}
