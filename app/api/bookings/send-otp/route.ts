import {
  checkRateLimit,
  extractClientIdentifier,
  hashIdentifier,
  sendOtpRequestSchema,
} from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  const parsed = sendOtpRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Adj meg érvényes e-mail-címet és aktív időpont-zárolást." },
      { status: 400 },
    );
  }

  const { lockToken, email } = parsed.data;
  const clientId = extractClientIdentifier(request);
  if (clientId) {
    const ipLimit = checkRateLimit("otp_ip", clientId, 5, 10 * 60 * 1000);
    if (!ipLimit.allowed) {
      return Response.json(
        {
          error:
            "Túl sok megerősítőkód-kérés érkezett erről a hálózatról. Kérlek, várj 10 percet.",
        },
        { status: 429 },
      );
    }
  }

  const emailHash = hashIdentifier(email);
  const emailLimit = checkRateLimit("otp_email", emailHash, 3, 10 * 60 * 1000);
  if (!emailLimit.allowed) {
    return Response.json(
      {
        error:
          "Erre az e-mail-címre túl sok megerősítő kódot kértél. Kérlek, várj néhány percet.",
      },
      { status: 429 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: hasActiveLock, error: lockCheckError } = await supabase.rpc(
    "has_active_booking_lock",
    { p_lock_token: lockToken },
  );

  if (lockCheckError || hasActiveLock !== true) {
    return Response.json(
      {
        error:
          "Az időpont-zárolás lejárt vagy érvénytelen. Kérlek, válassz új időpontot.",
      },
      { status: 409 },
    );
  }

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (otpError) {
    return Response.json(
      {
        error: "Az e-mail-megerősítő kód küldése nem sikerült. Próbáld újra később.",
      },
      { status: 502 },
    );
  }

  return Response.json({ sent: true });
}
