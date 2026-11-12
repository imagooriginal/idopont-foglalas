import { z } from "zod";
import { deliverBookingRescheduledEmail } from "@/lib/booking-emails";
import { checkRateLimit, extractClientIdentifier, uuidSchema } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabasePublicClient } from "@/lib/supabase/public";

const rescheduleRequestSchema = z
  .object({
    token: uuidSchema,
    newStart: z
      .string()
      .trim()
      .refine((val) => Number.isFinite(new Date(val).getTime()), {
        message: "Érvénytelen új kezdési időpont.",
      }),
  })
  .strict();

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

  const parsed = rescheduleRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Adj meg érvényes azonosítót és új kezdési időpontot." },
      { status: 400 },
    );
  }

  const clientId = extractClientIdentifier(request);
  if (clientId) {
    const rateLimit = checkRateLimit(
      "booking_reschedule",
      clientId,
      10,
      10 * 60 * 1000,
    );
    if (!rateLimit.allowed) {
      return Response.json(
        { error: "Túl sok próbálkozás. Kérlek, várj néhány percet." },
        { status: 429 },
      );
    }
  }

  const newStartIso = new Date(parsed.data.newStart).toISOString();
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("reschedule_booking_by_token", {
    p_cancellation_token: parsed.data.token,
    p_new_start: newStartIso,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("more than 24 hours")) {
      return Response.json(
        {
          error:
            "24 órán belüli időpont online már nem ütemezhető át. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!",
          code: "WITHIN_24_HOURS",
        },
        { status: 400 },
      );
    }
    if (msg.includes("Pro tier")) {
      return Response.json(
        {
          error:
            "Az online átütemezés kizárólag a Prémium (Pro) csomagos szolgáltatóknál érhető el.",
          code: "PRO_REQUIRED",
        },
        { status: 403 },
      );
    }
    if (msg.includes("no longer available") || msg.includes("conflicts")) {
      return Response.json(
        {
          error:
            "A kiválasztott új időpont sajnos már foglalt. Kérjük, válassz másik időpontot!",
          code: "CONFLICT",
        },
        { status: 409 },
      );
    }
    if (msg.includes("must be in the future")) {
      return Response.json(
        {
          error: "Az új időpontnak a jövőben kell lennie (legalább 1 órával később).",
          code: "PAST_TIME",
        },
        { status: 400 },
      );
    }
    return Response.json(
      {
        error: "A foglalás nem található vagy már le lett mondva.",
        code: "NOT_FOUND",
      },
      { status: 404 },
    );
  }

  const updatedRow = Array.isArray(data) ? data[0] : data;
  if (!updatedRow) {
    return Response.json(
      { error: "A foglalás nem található vagy már le lett mondva." },
      { status: 404 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (apiKey && from) {
    try {
      const admin = createSupabaseAdminClient();
      await deliverBookingRescheduledEmail(admin, updatedRow.booking_id, {
        apiKey,
        from,
        initiatedBy: "customer",
      });
    } catch (notifyError) {
      console.error("Failed to send reschedule notice email", notifyError);
    }
  }

  return Response.json({
    ok: true,
    bookingId: updatedRow.booking_id,
    startsAt: updatedRow.starts_at,
    endsAt: updatedRow.ends_at,
    companyName: updatedRow.company_name,
  });
}
