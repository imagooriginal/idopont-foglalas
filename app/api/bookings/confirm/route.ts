import { Resend } from "resend";
import {
  createBookingEmailHtml,
  createGoogleCalendarUrl,
  createIcsCalendarFile,
  sanitizeSingleLineText,
} from "@/lib/calendar";
import { confirmRequestSchema, releaseActiveClientLock } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const privacyPolicyVersion = "2026-10-31";

interface BookingEmail {
  to: string;
  html: string;
  ics: string;
}

async function sendBookingEmail(
  resend: Resend,
  from: string,
  message: BookingEmail,
) {
  try {
    const { error } = await resend.emails.send({
      from,
      to: [message.to],
      subject: "Időpontfoglalás visszaigazolása",
      html: message.html,
      attachments: [
        {
          filename: "idopont.ics",
          content: Buffer.from(message.ics).toString("base64"),
          contentType: "text/calendar; charset=utf-8",
        },
      ],
    });

    if (error) {
      console.error("Resend rejected a booking email", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Booking email delivery failed", error);
    return false;
  }
}

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
    return Response.json(
      {
        error:
          "A foglalás nem véglegesíthető. Lehet, hogy lejárt az időzárolás.",
      },
      { status: 409 },
    );
  }

  releaseActiveClientLock(body.lockToken);

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
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .eq("status", "confirmed")
      .single();

    if (bookingError || !booking) {
      throw new Error(
        `Foglalás betöltése nem sikerült: ${bookingError?.message ?? "Nem található visszaigazolt foglalás."}`,
      );
    }

    const [companyResult, bookingServicesResult] = await Promise.all([
      admin
        .from("companies")
        .select("id, nev, owner_id, time_zone, custom_booking_fields")
        .eq("id", booking.cég_id)
        .single(),
      admin
        .from("booking_services")
        .select("service_id, service_order")
        .eq("booking_id", booking.id)
        .order("service_order", { ascending: true }),
    ]);

    if (companyResult.error) {
      throw new Error(
        `Szolgáltató betöltése nem sikerült: ${companyResult.error.message}`,
      );
    }
    if (bookingServicesResult.error) {
      throw new Error(
        `Foglalási szolgáltatások betöltése nem sikerült: ${bookingServicesResult.error.message}`,
      );
    }

    const serviceIds = bookingServicesResult.data.length
      ? bookingServicesResult.data.map((item) => item.service_id)
      : [booking.service_id];
    const { data: services, error: servicesError } = await admin
      .from("services")
      .select("id, nev")
      .eq("cég_id", booking.cég_id)
      .in("id", serviceIds);

    if (servicesError) {
      throw new Error(
        `Szolgáltatások betöltése nem sikerült: ${servicesError.message}`,
      );
    }

    const serviceNames = serviceIds
      .map((id) => services.find((service) => service.id === id)?.nev)
      .filter((name): name is string => Boolean(name));
    if (serviceNames.length !== serviceIds.length) {
      throw new Error("A foglalás egyik szolgáltatása nem található.");
    }
    const serviceName = sanitizeSingleLineText(serviceNames.join(" + "));

    const { data: ownerResult, error: ownerError } =
      await admin.auth.admin.getUserById(companyResult.data.owner_id);
    if (ownerError) {
      throw new Error(
        `Szolgáltatói e-mail betöltése nem sikerült: ${ownerError.message}`,
      );
    }

    const extraFields: Array<[string, string]> = [];
    const vehicleLabel = [booking.jarmu_marka, booking.jarmu_modell]
      .filter(Boolean)
      .join(" ");
    if (vehicleLabel) {
      extraFields.push(["Jármű", sanitizeSingleLineText(vehicleLabel)]);
    }
    if (booking.jarmu_rendszam) {
      extraFields.push([
        "Rendszám",
        sanitizeSingleLineText(String(booking.jarmu_rendszam)),
      ]);
    }

    if (
      booking.custom_fields &&
      typeof booking.custom_fields === "object" &&
      !Array.isArray(booking.custom_fields)
    ) {
      const labelMap = new Map<string, string>();
      if (Array.isArray(companyResult.data.custom_booking_fields)) {
        for (const item of companyResult.data.custom_booking_fields) {
          if (
            item &&
            typeof item === "object" &&
            typeof (item as { key?: unknown }).key === "string" &&
            typeof (item as { label?: unknown }).label === "string"
          ) {
            labelMap.set(
              (item as { key: string }).key,
              (item as { label: string }).label,
            );
          }
        }
      }

      for (const [key, value] of Object.entries(booking.custom_fields)) {
        if (typeof value === "string" && value.trim()) {
          extraFields.push([
            sanitizeSingleLineText(labelMap.get(key) ?? key),
            sanitizeSingleLineText(value),
          ]);
        }
      }
    }

    const start = new Date(booking.kezdes_ideje);
    const end = new Date(booking.vege_ideje);
    const timeZone = companyResult.data.time_zone || "Europe/Budapest";
    const startLabel = new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone,
    }).format(start);
    const endLabel = new Intl.DateTimeFormat("hu-HU", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    }).format(end);
    const safeCompanyName = sanitizeSingleLineText(companyResult.data.nev);
    const safeCustomerName = sanitizeSingleLineText(booking.ugyfel_nev ?? "");
    const extraSummary = extraFields.length
      ? ` ${extraFields.map(([k, v]) => `${k}: ${v}`).join(", ")}.`
      : "";
    const description = `${serviceName} – ${safeCompanyName}. Ügyfél: ${safeCustomerName}.${extraSummary}`;
    const calendarEvent = {
      title: `${serviceName} – ${safeCompanyName}`,
      description,
      start,
      end,
    };
    const googleCalendarUrl = createGoogleCalendarUrl(calendarEvent);
    const ics = createIcsCalendarFile(calendarEvent);
    const resend = new Resend(apiKey);
    const customerEmail: BookingEmail = {
      to: booking.ugyfel_email,
      html: createBookingEmailHtml({
        greeting: `Kedves ${safeCustomerName}!`,
        companyName: safeCompanyName,
        serviceName,
        customerName: safeCustomerName,
        start: startLabel,
        end: endLabel,
        googleCalendarUrl,
        extraFields,
      }),
      ics,
    };

    const recipients: BookingEmail[] = [customerEmail];
    const ownerEmail = ownerResult.user?.email;
    const allRecipientsConfigured = Boolean(ownerEmail);
    if (ownerEmail) {
      recipients.push({
        ...customerEmail,
        to: ownerEmail,
        html: createBookingEmailHtml({
          greeting: `Új foglalás: ${safeCustomerName}`,
          companyName: safeCompanyName,
          serviceName,
          customerName: safeCustomerName,
          start: startLabel,
          end: endLabel,
          googleCalendarUrl,
          extraFields,
        }),
      });
    } else {
      console.error("No email address is associated with the company owner", {
        companyId: companyResult.data.id,
      });
    }

    const delivery = await Promise.all(
      recipients.map((recipient) => sendBookingEmail(resend, from, recipient)),
    );
    const allSent = allRecipientsConfigured && delivery.every(Boolean);

    return Response.json({
      bookingId,
      emailStatus: allSent ? "sent" : "failed",
      warning: allSent
        ? undefined
        : "A foglalás sikeres, de legalább egy visszaigazoló e-mail kézbesítése nem sikerült.",
    });
  } catch (error) {
    console.error(
      "Booking confirmed but confirmation email setup failed",
      error,
    );
    return Response.json({
      bookingId,
      emailStatus: "failed",
      warning:
        "A foglalás sikeres, de a visszaigazoló e-mail küldése nem sikerült.",
    });
  }
}
