import { deliverBookingConfirmationEmail } from "@/lib/booking-emails";
import { confirmRequestSchema, releaseActiveClientLock } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const privacyPolicyVersion = "2026-10-31";

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

  const parsed = confirmRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Adj meg érvényes nevet és e-mail-címet." },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (
    authError ||
    !authData.user?.email_confirmed_at ||
    authData.user.email?.toLowerCase() !== body.email.toLowerCase()
  ) {
    return Response.json(
      { error: "A foglalás előtt erősítsd meg a megadott e-mail-címet." },
      { status: 401 },
    );
  }

  const { data: bookingId, error: confirmError } = await supabase.rpc(
    "confirm_booking_with_privacy",
    {
      p_lock_token: body.lockToken,
      p_customer_name: body.name,
      p_customer_email: body.email,
      p_customer_phone: body.phone ? body.phone : null,
      p_privacy_accepted: true,
      p_privacy_policy_version: privacyPolicyVersion,
    },
  );

  if (confirmError || typeof bookingId !== "string" || !bookingId) {
    console.error("Booking confirmation RPC failed", confirmError);
    if (confirmError?.message?.includes("restricted for this contact")) {
      return Response.json(
        {
          error:
            "Online foglalás nem elérhető, kérjük, vegye fel a kapcsolatot telefonon a szolgáltatóval.",
        },
        { status: 403 },
      );
    }
    return Response.json(
      {
        error:
          "A foglalás nem véglegesíthető. Lehet, hogy lejárt az időzárolás.",
      },
      { status: 409 },
    );
  }

  releaseActiveClientLock(body.lockToken);

  const authWithSignOut = supabase.auth as {
    signOut?: () => unknown;
  };
  if (typeof authWithSignOut.signOut === "function") {
    await Promise.resolve(authWithSignOut.signOut()).catch(() => undefined);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return Response.json({
      bookingId,
      emailStatus: "not_configured",
      warning: "A foglalás sikeres, de az e-mail-küldés nincs beállítva.",
    });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { allSent } = await deliverBookingConfirmationEmail(admin, bookingId, {
      apiKey,
      from,
      timeoutMs: 2000,
    });

    return Response.json({
      bookingId,
      emailStatus: allSent ? "sent" : "queued_for_retry",
      warning: allSent
        ? undefined
        : "A foglalás sikeres! A visszaigazoló e-mail kézbesítése folyamatban van (automatikus újrapróbálás ütemezve).",
    });
  } catch (error) {
    console.error(
      "Booking confirmed; immediate email failed, queued for outbox retry",
      error,
    );
    return Response.json({
      bookingId,
      emailStatus: "queued_for_retry",
      warning:
        "A foglalás sikeres! A visszaigazoló e-mailt a háttérfolyamat hamarosan újraküldi.",
    });
  }
}
