import { uuidSchema } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface ExportBookingRow {
  id: string;
  service_id: string;
  staff_id?: string | null;
  status: string;
  ugyfel_nev: string | null;
  ugyfel_email: string | null;
  ugyfel_telefon: string | null;
  kezdes_ideje: string;
  vege_ideje: string;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  const rawString = String(value ?? "");
  const startsWithFormulaTrigger = /^[\s\t\r\n]*[=+\-@]/.test(rawString);
  const normalized = rawString.replace(/[\r\n\t]+/g, " ").trim();
  const safeFormula =
    startsWithFormulaTrigger || /^[=+\-@]/.test(normalized)
      ? `'${normalized}`
      : normalized;
  return `"${safeFormula.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const companyIdParam = url.searchParams.get("companyId");
  const parsedCompanyId = uuidSchema.safeParse(companyIdParam);
  if (!parsedCompanyId.success) {
    return Response.json(
      { error: "Érvénytelen szolgáltató-azonosító." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return Response.json(
      { error: "A letöltéshez jelentkezz be." },
      { status: 401 },
    );
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id, nev, slug, owner_id, time_zone")
    .eq("id", parsedCompanyId.data)
    .maybeSingle();

  if (!company) {
    return Response.json(
      { error: "Nincs jogosultságod a szolgáltató adataihoz." },
      { status: 403 },
    );
  }

  if (company.owner_id !== authData.user.id) {
    const { data: isAdmin } = await supabase.rpc("is_platform_admin");
    if (isAdmin !== true) {
      return Response.json(
        { error: "Nincs jogosultságod a szolgáltató adataihoz." },
        { status: 403 },
      );
    }
  }

  const bookingColumns: string =
    "id, service_id, staff_id, status, ugyfel_nev, ugyfel_email, ugyfel_telefon, kezdes_ideje, vege_ideje";
  const [bookingsRes, servicesRes, staffRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(bookingColumns)
      .eq("cég_id", company.id)
      .in("status", ["confirmed", "cancelled", "no_show"])
      .order("kezdes_ideje", { ascending: false })
      .limit(1000),
    supabase
      .from("services")
      .select("id, nev, ar")
      .eq("cég_id", company.id),
    supabase
      .from("company_staff")
      .select("id, name")
      .eq("company_id", company.id),
  ]);

  const serviceNameMap = new Map<string, { name: string; price: number }>();
  for (const s of servicesRes.data ?? []) {
    serviceNameMap.set(s.id, { name: s.nev, price: Number(s.ar) || 0 });
  }
  const staffNameMap = new Map<string, string>();
  for (const st of staffRes.data ?? []) {
    staffNameMap.set(st.id, st.name);
  }

  const timeZone = company.time_zone || "Europe/Budapest";
  const formatter = new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

  const headers = [
    "Foglalás ID",
    "Kezdés",
    "Befejezés",
    "Státusz",
    "Szolgáltatás",
    "Ár (Ft)",
    "Munkatárs",
    "Ügyfél neve",
    "Ügyfél e-mail",
    "Ügyfél telefon",
  ];

  const rows = ((bookingsRes.data ?? []) as unknown as ExportBookingRow[]).map(
    (b) => {
      const sInfo = serviceNameMap.get(b.service_id);
      const staffName = b.staff_id ? staffNameMap.get(b.staff_id) ?? "" : "";
      return [
        escapeCsvCell(b.id),
        escapeCsvCell(formatter.format(new Date(b.kezdes_ideje))),
        escapeCsvCell(formatter.format(new Date(b.vege_ideje))),
        escapeCsvCell(b.status),
        escapeCsvCell(sInfo?.name ?? "Szolgáltatás"),
        escapeCsvCell(sInfo?.price ?? 0),
        escapeCsvCell(staffName),
        escapeCsvCell(b.ugyfel_nev ?? ""),
        escapeCsvCell(b.ugyfel_email ?? ""),
        escapeCsvCell(b.ugyfel_telefon ?? ""),
      ].join(";");
    },
  );

  // UTF-8 BOM (\uFEFF) + semicolon delimiter for seamless Hungarian Excel opening
  const csvContent = `\uFEFF${headers.map(escapeCsvCell).join(";")}\r\n${rows.join("\r\n")}\r\n`;

  const safeSlug =
    String(company.slug ?? "")
      .replace(/[^a-z0-9-_]/gi, "")
      .slice(0, 64) || "export";

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="foglalasok-${safeSlug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
