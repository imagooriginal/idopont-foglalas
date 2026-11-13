import { z } from "zod";
import { deliverProviderCancellationNoticeEmail } from "@/lib/booking-emails";
import { checkRateLimit, extractClientIdentifier, uuidSchema } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabasePublicClient } from "@/lib/supabase/public";

const cancelRequestSchema = z
  .object({
    token: uuidSchema,
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

  const parsed = cancelRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Érvénytelen lemondási azonosító." },
      { status: 400 },
    );
  }

  const clientId = extractClientIdentifier(request);
  if (clientId) {
    const rateLimit = checkRateLimit("booking_cancel", clientId, 10, 10 * 60 * 1000);
    if (!rateLimit.allowed) {
      return Response.json(
        { error: "Túl sok próbálkozás. Kérlek, várj néhány percet." },
        { status: 429 },
      );
    }
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("cancel_booking_by_token", {
    p_cancellation_token: parsed.data.token,
  });

  if (error) {
    const msg = error.message ?? "";
    const hoursMatch = /more than (\d+) hours/i.exec(msg);
    if (hoursMatch) {
      const hours = Number.parseInt(hoursMatch[1], 10);
      return Response.json(
        {
          error: `${hours} órán belüli időpont online már nem mondható le. Kérjük, vedd fel a kapcsolatot közvetlenül a szolgáltatóval telefonon!`,
          code: "WITHIN_24_HOURS",
        },
        { status: 400 },
      );
    }
    if (msg.includes("Pro tier")) {
      return Response.json(
        {
          error:
            "Az online időpont-lemondás kizárólag a Prémium (Pro) csomagos szolgáltatóknál érhető el.",
          code: "PRO_REQUIRED",
        },
        { status: 403 },
      );
    }
    return Response.json(
      {
        error: "A foglalás nem található vagy már korábban le lett mondva.",
        code: "NOT_FOUND",
      },
      { status: 404 },
    );
  }

  const cancelledRow = Array.isArray(data) ? data[0] : data;
  if (!cancelledRow) {
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
      await deliverProviderCancellationNoticeEmail(
        admin,
        {
          companyId: cancelledRow.company_id,
          companyName: cancelledRow.company_name,
          customerName: cancelledRow.customer_name,
          customerEmail: cancelledRow.customer_email,
          startsAt: cancelledRow.starts_at,
          endsAt: cancelledRow.ends_at,
        },
        { apiKey, from },
      );
    } catch (notifyError) {
      console.error("Failed to send provider cancellation notice", notifyError);
    }
  }

  return Response.json({
    ok: true,
    bookingId: cancelledRow.booking_id,
    companyName: cancelledRow.company_name,
  });
}
