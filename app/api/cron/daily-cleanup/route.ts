import { verifyCronAuthorization } from "@/lib/booking-emails";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  if (!verifyCronAuthorization(request)) {
    return Response.json(
      { error: "Nincs jogosultság a cron végpont futtatásához." },
      { status: 401 },
    );
  }

  const rawRetention = Number(process.env.BOOKING_RETENTION_DAYS ?? "365");
  const retentionDays =
    Number.isInteger(rawRetention) && rawRetention >= 30 && rawRetention <= 3650
      ? rawRetention
      : 365;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("run_daily_database_maintenance", {
    p_retention_days: retentionDays,
  });

  if (error) {
    console.error("Daily database maintenance RPC failed", error);
    return Response.json(
      { error: "Az adatbázis-karbantartás futtatása nem sikerült." },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    maintenance: data,
  });
}
