import { Resend } from "resend";
import {
  createBookingEmailHtml,
  createGoogleCalendarUrl,
  createIcsCalendarFile,
} from "@/lib/calendar";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabasePublicClient } from "@/lib/supabase/public";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ConfirmationRequest {
  lockToken?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}

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
  let body: ConfirmationRequest;
  try {
    body = (await request.json()) as ConfirmationRequest;
  } catch {
    return Response.json({ error: "A kérés törzse nem érvényes JSON." }, { status: 400 });
  }

  if (
    typeof body.lockToken !== "string" ||
    !uuidPattern.test(body.lockToken) ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 200 ||
    typeof body.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
    body.email.trim().length > 320 ||
    (body.phone !== undefined &&
      body.phone !== null &&
      (typeof body.phone !== "string" || body.phone.trim().length > 40))
  ) {
    return Response.json({ error: "Adj meg érvényes nevet és e-mail-címet." }, { status: 400 });
  }

  const supabase = createSupabasePublicClient();
  const { data: bookingId, error: confirmError } = await supabase.rpc(
    "confirm_booking",
    {
      p_lock_token: body.lockToken,
      p_customer_name: body.name.trim(),
      p_customer_email: body.email.trim(),
      p_customer_phone:
        typeof body.phone === "string" ? body.phone.trim() || null : null,
    },
  );

  if (confirmError) {
    console.error("Booking confirmation RPC failed", confirmError);
    return Response.json(
      { error: "A foglalás nem véglegesíthető. Lehet, hogy lejárt az időzárolás." },
      { status: 409 },
    );
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
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bookingError) throw new Error(`Foglalás betöltése nem sikerült: ${bookingError.message}`);

    const [companyResult, bookingServicesResult] = await Promise.all([
      admin
        .from("companies")
        .select("id, nev, owner_id, time_zone")
        .eq("id", booking.cég_id)
        .single(),
      admin
        .from("booking_services")
        .select("service_id, service_order")
        .eq("booking_id", booking.id)
        .order("service_order", { ascending: true }),
    ]);

    if (companyResult.error) {
      throw new Error(`Szolgáltató betöltése nem sikerült: ${companyResult.error.message}`);
    }
    if (bookingServicesResult.error) {
      throw new Error(`Foglalási szolgáltatások betöltése nem sikerült: ${bookingServicesResult.error.message}`);
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
      throw new Error(`Szolgáltatások betöltése nem sikerült: ${servicesError.message}`);
    }

    const serviceNames = serviceIds
      .map((id) => services.find((service) => service.id === id)?.nev)
      .filter((name): name is string => Boolean(name));
    if (serviceNames.length !== serviceIds.length) {
      throw new Error("A foglalás egyik szolgáltatása nem található.");
    }
    const serviceName = serviceNames.join(" + ");

    const { data: ownerResult, error: ownerError } =
      await admin.auth.admin.getUserById(companyResult.data.owner_id);
    if (ownerError) throw new Error(`Szolgáltatói e-mail betöltése nem sikerült: ${ownerError.message}`);

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
    const description = `${serviceName} – ${companyResult.data.nev}. Ügyfél: ${booking.ugyfel_nev}.`;
    const calendarEvent = {
      title: `${serviceName} – ${companyResult.data.nev}`,
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
        greeting: `Kedves ${booking.ugyfel_nev}!`,
        companyName: companyResult.data.nev,
        serviceName,
        customerName: booking.ugyfel_nev,
        start: startLabel,
        end: endLabel,
        googleCalendarUrl,
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
          greeting: `Új foglalás: ${booking.ugyfel_nev}`,
          companyName: companyResult.data.nev,
          serviceName,
          customerName: booking.ugyfel_nev,
          start: startLabel,
          end: endLabel,
          googleCalendarUrl,
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
    const allSent =
      allRecipientsConfigured && delivery.every(Boolean);

    return Response.json({
      bookingId,
      emailStatus: allSent ? "sent" : "failed",
      warning: allSent
        ? undefined
        : "A foglalás sikeres, de legalább egy visszaigazoló e-mail kézbesítése nem sikerült.",
    });
  } catch (error) {
    console.error("Booking confirmed but confirmation email setup failed", error);
    return Response.json({
      bookingId,
      emailStatus: "failed",
      warning: "A foglalás sikeres, de a visszaigazoló e-mail küldése nem sikerült.",
    });
  }
}
