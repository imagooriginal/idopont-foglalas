import {
  deliverBookingConfirmationEmail,
  deliverBookingReminderEmail,
  deliverGoogleReviewEmail,
  verifyCronAuthorization,
} from "@/lib/booking-emails";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  if (!verifyCronAuthorization(request)) {
    return Response.json(
      { error: "Nincs jogosultság a cron végpont futtatásához." },
      { status: 401 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return Response.json(
      {
        error:
          "A RESEND_API_KEY és RESEND_FROM_EMAIL környezeti változók szükségesek az e-mailek kiküldéséhez.",
      },
      { status: 503 },
    );
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const in24HoursIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // 1. Outbox Pattern: Retry unsent confirmation emails for active/upcoming confirmed bookings
  const { data: pendingConfirmations, error: outboxError } = await admin
    .from("bookings")
    .select("id")
    .eq("status", "confirmed")
    .eq("confirmation_email_sent", false)
    .gte("vege_ideje", nowIso)
    .order("kezdes_ideje", { ascending: true })
    .limit(50);

  if (outboxError) {
    console.error("Outbox query failed", outboxError);
    return Response.json(
      { error: "A megerősítő e-mail várólista lekérdezése nem sikerült." },
      { status: 500 },
    );
  }

  let outboxSent = 0;
  for (const item of pendingConfirmations ?? []) {
    try {
      const { allSent } = await deliverBookingConfirmationEmail(admin, item.id, {
        apiKey,
        from,
        timeoutMs: 8000,
      });
      if (allSent) outboxSent += 1;
    } catch (error) {
      console.error(`Outbox retry failed for booking ${item.id}`, error);
    }
  }

  // 2. 24-Hour Automated Reminder Emails: Find confirmed bookings starting within the next 24 hours
  const { data: dueReminders, error: reminderError } = await admin
    .from("bookings")
    .select("id")
    .eq("status", "confirmed")
    .eq("reminder_sent", false)
    .gt("kezdes_ideje", nowIso)
    .lte("kezdes_ideje", in24HoursIso)
    .order("kezdes_ideje", { ascending: true })
    .limit(50);

  if (reminderError) {
    console.error("Reminder query failed", reminderError);
    return Response.json(
      { error: "Az emlékeztető e-mail várólista lekérdezése nem sikerült." },
      { status: 500 },
    );
  }

  let remindersSent = 0;
  for (const item of dueReminders ?? []) {
    try {
      const { sent } = await deliverBookingReminderEmail(admin, item.id, {
        apiKey,
        from,
        timeoutMs: 8000,
      });
      if (sent) remindersSent += 1;
    } catch (error) {
      console.error(`Reminder email failed for booking ${item.id}`, error);
    }
  }

  // 3. Automated Post-Appointment Google Review Emails (2 to 24 hours after end time)
  const twoHoursAgoIso = new Date(
    now.getTime() - 2 * 60 * 60 * 1000,
  ).toISOString();
  const twentyFourHoursAgoIso = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();

  let reviewsProcessed = 0;
  let reviewsSent = 0;
  try {
    const { data: dueReviews, error: reviewError } = await admin
      .from("bookings")
      .select("id")
      .eq("status", "confirmed")
      .eq("review_email_sent", false)
      .gte("vege_ideje", twentyFourHoursAgoIso)
      .lte("vege_ideje", twoHoursAgoIso)
      .order("vege_ideje", { ascending: true })
      .limit(30);

    if (!reviewError && Array.isArray(dueReviews)) {
      reviewsProcessed = dueReviews.length;
      for (const item of dueReviews) {
        try {
          const { sent } = await deliverGoogleReviewEmail(admin, item.id, {
            apiKey,
            from,
            timeoutMs: 8000,
          });
          if (sent) reviewsSent += 1;
        } catch (error) {
          console.error(`Review email failed for booking ${item.id}`, error);
        }
      }
    }
  } catch (error) {
    console.error("Review queue processing skipped or failed", error);
  }

  return Response.json({
    ok: true,
    outboxProcessed: (pendingConfirmations ?? []).length,
    outboxSent,
    remindersProcessed: (dueReminders ?? []).length,
    remindersSent,
    ...(reviewsProcessed > 0 ? { reviewsProcessed, reviewsSent } : {}),
  });
}
