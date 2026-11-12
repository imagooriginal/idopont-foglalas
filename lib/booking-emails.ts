import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import {
  createBookingEmailHtml,
  createGoogleCalendarUrl,
  createGoogleReviewEmailHtml,
  createIcsCalendarFile,
  createReminderEmailHtml,
  sanitizeSingleLineText,
} from "@/lib/calendar";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface BookingEmailMessage {
  to: string;
  subject: string;
  html: string;
  ics: string;
}

export function verifyCronAuthorization(
  request: Request,
  cronSecret = process.env.CRON_SECRET,
): boolean {
  if (!cronSecret || cronSecret.trim().length < 16) {
    return false;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret.trim()}`;
  const actualBuf = Buffer.from(authHeader, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(actualBuf, expectedBuf);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = "Operation timed out",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendSingleEmailWithTimeout(
  resend: Resend,
  from: string,
  message: BookingEmailMessage,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const { error } = await withTimeout(
      resend.emails.send({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        attachments: [
          {
            filename: "idopont.ics",
            content: Buffer.from(message.ics).toString("base64"),
            contentType: "text/calendar; charset=utf-8",
          },
        ],
      }),
      timeoutMs,
      "Resend request timed out within 2000ms",
    );

    if (error) {
      console.error("Resend rejected a booking email", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Booking email delivery failed or timed out", error);
    return false;
  }
}

async function buildBookingEmailContext(admin: AdminClient, bookingId: string) {
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
      .select("id, nev, slug, owner_id, time_zone, plan, custom_booking_fields")
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
  const companyPlan =
    (companyResult.data as { plan?: string }).plan ?? "pro";
  const siteBase = (
    process.env.NEXT_PUBLIC_SITE_URL || "https://idopontfoglalo.hu"
  ).replace(/\/+$/, "");
  const cancellationUrl =
    companyPlan === "pro" && booking.cancellation_token
      ? `${siteBase}/cancel/${encodeURIComponent(String(booking.cancellation_token))}`
      : undefined;

  return {
    booking,
    company: companyResult.data as typeof companyResult.data & {
      plan?: string;
      slug?: string;
    },
    companyPlan,
    cancellationUrl,
    serviceName,
    extraFields,
    startLabel,
    endLabel,
    safeCompanyName,
    safeCustomerName,
    googleCalendarUrl,
    ics,
  };
}

export async function deliverBookingConfirmationEmail(
  admin: AdminClient,
  bookingId: string,
  options: {
    apiKey: string;
    from: string;
    timeoutMs?: number;
  },
): Promise<{ allSent: boolean }> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const ctx = await buildBookingEmailContext(admin, bookingId);

  const { data: ownerResult, error: ownerError } =
    await admin.auth.admin.getUserById(ctx.company.owner_id);
  if (ownerError) {
    throw new Error(
      `Szolgáltatói e-mail betöltése nem sikerült: ${ownerError.message}`,
    );
  }

  const resend = new Resend(options.apiKey);
  const recipients: BookingEmailMessage[] = [];
  if (ctx.booking.ugyfel_email) {
    recipients.push({
      to: ctx.booking.ugyfel_email,
      subject: "Időpontfoglalás visszaigazolása",
      html: createBookingEmailHtml({
        greeting: `Kedves ${ctx.safeCustomerName}!`,
        companyName: ctx.safeCompanyName,
        serviceName: ctx.serviceName,
        customerName: ctx.safeCustomerName,
        start: ctx.startLabel,
        end: ctx.endLabel,
        googleCalendarUrl: ctx.googleCalendarUrl,
        extraFields: ctx.extraFields,
        cancellationUrl: ctx.cancellationUrl,
      }),
      ics: ctx.ics,
    });
  }

  const ownerEmail = ownerResult.user?.email;
  const allRecipientsConfigured = Boolean(ownerEmail);
  if (ownerEmail) {
    recipients.push({
      to: ownerEmail,
      subject: "Időpontfoglalás visszaigazolása",
      html: createBookingEmailHtml({
        greeting: `Új foglalás: ${ctx.safeCustomerName}`,
        companyName: ctx.safeCompanyName,
        serviceName: ctx.serviceName,
        customerName: ctx.safeCustomerName,
        start: ctx.startLabel,
        end: ctx.endLabel,
        googleCalendarUrl: ctx.googleCalendarUrl,
        extraFields: ctx.extraFields,
      }),
      ics: ctx.ics,
    });
  } else {
    console.error("No email address is associated with the company owner", {
      companyId: ctx.company.id,
    });
  }

  const delivery = await Promise.all(
    recipients.map((recipient) =>
      sendSingleEmailWithTimeout(resend, options.from, recipient, timeoutMs),
    ),
  );
  const allSent = allRecipientsConfigured && delivery.every(Boolean);

  if (allSent) {
    await admin
      .from("bookings")
      .update({
        confirmation_email_sent: true,
        confirmation_email_sent_at: new Date().toISOString(),
      })
      .eq("id", bookingId);
  }

  return { allSent };
}

export async function deliverBookingReminderEmail(
  admin: AdminClient,
  bookingId: string,
  options: {
    apiKey: string;
    from: string;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean }> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const ctx = await buildBookingEmailContext(admin, bookingId);
  // 24-hour automated reminders are a Pro (Prémium) feature only
  if (ctx.companyPlan !== "pro" || !ctx.booking.ugyfel_email) {
    return { sent: false };
  }

  const resend = new Resend(options.apiKey);
  const reminderMessage: BookingEmailMessage = {
    to: ctx.booking.ugyfel_email,
    subject: `Emlékeztető: közelgő időpont (${ctx.safeCompanyName})`,
    html: createReminderEmailHtml({
      greeting: `Kedves ${ctx.safeCustomerName}!`,
      companyName: ctx.safeCompanyName,
      serviceName: ctx.serviceName,
      customerName: ctx.safeCustomerName,
      start: ctx.startLabel,
      end: ctx.endLabel,
      googleCalendarUrl: ctx.googleCalendarUrl,
      extraFields: ctx.extraFields,
      cancellationUrl: ctx.cancellationUrl,
    }),
    ics: ctx.ics,
  };

  const sent = await sendSingleEmailWithTimeout(
    resend,
    options.from,
    reminderMessage,
    timeoutMs,
  );

  if (sent) {
    await admin
      .from("bookings")
      .update({
        reminder_sent: true,
        reminder_sent_at: new Date().toISOString(),
      })
      .eq("id", bookingId);
  }

  return { sent };
}

export async function deliverProviderCancellationNoticeEmail(
  admin: AdminClient,
  details: {
    companyId: string;
    companyName: string;
    customerName: string;
    customerEmail: string;
    startsAt: string;
    endsAt: string;
  },
  options: {
    apiKey: string;
    from: string;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean }> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const { data: company } = await admin
    .from("companies")
    .select("owner_id, time_zone")
    .eq("id", details.companyId)
    .maybeSingle();

  if (!company?.owner_id) {
    return { sent: false };
  }

  const { data: ownerResult } = await admin.auth.admin.getUserById(
    company.owner_id,
  );
  const ownerEmail = ownerResult?.user?.email;
  if (!ownerEmail) {
    return { sent: false };
  }

  const timeZone = company.time_zone || "Europe/Budapest";
  const start = new Date(details.startsAt);
  const end = new Date(details.endsAt);
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

  const resend = new Resend(options.apiKey);
  const html = createBookingEmailHtml({
    greeting: `Lemondott foglalás: ${sanitizeSingleLineText(details.customerName)}`,
    companyName: sanitizeSingleLineText(details.companyName),
    serviceName: "Ügyfél által online lemondott időpont",
    customerName: sanitizeSingleLineText(details.customerName),
    start: startLabel,
    end: endLabel,
    googleCalendarUrl: "https://calendar.google.com/calendar/render",
    introText:
      "Az ügyfél online lemondta a foglalását (legalább 24 órával a kezdés előtt). Az idősáv automatikusan felszabadult:",
  });

  const ics = createIcsCalendarFile({
    title: `LEMONDVA – ${sanitizeSingleLineText(details.companyName)}`,
    description: `Az ügyfél (${sanitizeSingleLineText(details.customerName)}) lemondta az időpontot.`,
    start,
    end,
  });

  const sent = await sendSingleEmailWithTimeout(
    resend,
    options.from,
    {
      to: ownerEmail,
      subject: `Időpont lemondva: ${sanitizeSingleLineText(details.customerName)}`,
      html,
      ics,
    },
    timeoutMs,
  );

  return { sent };
}

export async function deliverCustomerCancellationNoticeEmail(
  details: {
    companyName: string;
    customerName: string;
    customerEmail: string;
    startsAt: string;
    endsAt: string;
    timeZone?: string;
    reason?: string;
  },
  options: {
    apiKey: string;
    from: string;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean }> {
  if (!details.customerEmail) {
    return { sent: false };
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  const timeZone = details.timeZone || "Europe/Budapest";
  const start = new Date(details.startsAt);
  const end = new Date(details.endsAt);
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

  const resend = new Resend(options.apiKey);
  const html = createBookingEmailHtml({
    greeting: `Kedves ${sanitizeSingleLineText(details.customerName || "Ügyfelünk")}!`,
    companyName: sanitizeSingleLineText(details.companyName),
    serviceName: "Szolgáltató által lemondott időpont",
    customerName: sanitizeSingleLineText(details.customerName || "Ügyfél"),
    start: startLabel,
    end: endLabel,
    googleCalendarUrl: "https://calendar.google.com/calendar/render",
    extraFields: details.reason ? [["Megjegyzés", details.reason]] : [],
    introText:
      "Értesítünk, hogy a szolgáltató lemondta az alábbi időpontot. Kérjük, válassz új időpontot a foglalóoldalon:",
  });

  const ics = createIcsCalendarFile({
    title: `LEMONDVA – ${sanitizeSingleLineText(details.companyName)}`,
    description: "A szolgáltató lemondta az időpontot.",
    start,
    end,
  });

  const sent = await sendSingleEmailWithTimeout(
    resend,
    options.from,
    {
      to: details.customerEmail,
      subject: `Időpont lemondva (${sanitizeSingleLineText(details.companyName)})`,
      html,
      ics,
    },
    timeoutMs,
  );

  return { sent };
}

export async function deliverBookingRescheduledEmail(
  admin: AdminClient,
  bookingId: string,
  options: {
    apiKey: string;
    from: string;
    initiatedBy: "customer" | "provider";
    timeoutMs?: number;
  },
): Promise<{ sent: boolean }> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const ctx = await buildBookingEmailContext(admin, bookingId);
  const resend = new Resend(options.apiKey);
  const recipients: BookingEmailMessage[] = [];

  if (ctx.booking.ugyfel_email) {
    recipients.push({
      to: ctx.booking.ugyfel_email,
      subject: `Időpont átütemezve (${ctx.safeCompanyName})`,
      html: createBookingEmailHtml({
        greeting: `Kedves ${ctx.safeCustomerName}!`,
        companyName: ctx.safeCompanyName,
        serviceName: ctx.serviceName,
        customerName: ctx.safeCustomerName,
        start: ctx.startLabel,
        end: ctx.endLabel,
        googleCalendarUrl: ctx.googleCalendarUrl,
        extraFields: ctx.extraFields,
        cancellationUrl: ctx.cancellationUrl,
        introText:
          options.initiatedBy === "provider"
            ? "A szolgáltató módosította a foglalásod időpontját. Az új időpont részletei:"
            : "Sikeresen átütemezted a foglalásodat. Az új időpont részletei:",
      }),
      ics: ctx.ics,
    });
  }

  if (ctx.company.owner_id) {
    const { data: ownerResult } = await admin.auth.admin.getUserById(
      ctx.company.owner_id,
    );
    const ownerEmail = ownerResult?.user?.email;
    if (ownerEmail) {
      recipients.push({
        to: ownerEmail,
        subject: `Átütemezett foglalás: ${ctx.safeCustomerName}`,
        html: createBookingEmailHtml({
          greeting: `Átütemezett foglalás: ${ctx.safeCustomerName}`,
          companyName: ctx.safeCompanyName,
          serviceName: ctx.serviceName,
          customerName: ctx.safeCustomerName,
          start: ctx.startLabel,
          end: ctx.endLabel,
          googleCalendarUrl: ctx.googleCalendarUrl,
          extraFields: ctx.extraFields,
          introText: "A foglalás új időpontra került:",
        }),
        ics: ctx.ics,
      });
    }
  }

  const results = await Promise.all(
    recipients.map((msg) =>
      sendSingleEmailWithTimeout(resend, options.from, msg, timeoutMs),
    ),
  );
  return { sent: results.some(Boolean) };
}

export async function deliverGoogleReviewEmail(
  admin: AdminClient,
  bookingId: string,
  options: {
    apiKey: string;
    from: string;
    timeoutMs?: number;
  },
): Promise<{ sent: boolean }> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const { data: booking } = await admin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("status", "confirmed")
    .maybeSingle();

  if (!booking || !booking.ugyfel_email) {
    return { sent: false };
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, nev, plan, google_review_url")
    .eq("id", booking.cég_id)
    .maybeSingle();

  if (
    !company ||
    company.plan !== "pro" ||
    !company.google_review_url ||
    !String(company.google_review_url).trim()
  ) {
    return { sent: false };
  }

  const { data: service } = await admin
    .from("services")
    .select("nev")
    .eq("id", booking.service_id)
    .maybeSingle();

  const resend = new Resend(options.apiKey);
  const html = createGoogleReviewEmailHtml({
    customerName: booking.ugyfel_nev || "Ügyfelünk",
    companyName: company.nev,
    serviceName: service?.nev || "Szolgáltatás",
    reviewUrl: String(company.google_review_url).trim(),
  });

  try {
    const { error } = await withTimeout(
      resend.emails.send({
        from: options.from,
        to: [booking.ugyfel_email],
        subject: `Hogy tetszett a szolgáltatás? (${sanitizeSingleLineText(company.nev)})`,
        html,
      }),
      timeoutMs,
      "Google review email timed out",
    );

    if (error) {
      return { sent: false };
    }

    await admin
      .from("bookings")
      .update({
        review_email_sent: true,
        review_email_sent_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    return { sent: true };
  } catch {
    return { sent: false };
  }
}
