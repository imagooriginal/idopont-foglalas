import { redirect } from "next/navigation";
import { connection } from "next/server";
import SuperadminConsole, {
  type SuperadminCompany,
  type SuperadminService,
} from "./SuperadminConsole";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

interface SuperadminPageProps {
  searchParams: Promise<{ company?: string }>;
}

export default async function SuperadminPage({
  searchParams,
}: SuperadminPageProps) {
  await connection();

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) redirect("/dashboard/login");

  const { data: isPlatformAdmin, error: roleError } =
    await supabase.rpc("is_platform_admin");
  if (roleError) {
    throw new Error(`Platform-admin jogosultság ellenőrzése nem sikerült: ${roleError.message}`);
  }
  if (isPlatformAdmin !== true) redirect("/dashboard");

  const admin = createSupabaseAdminClient();
  const { data: companyData, error: companiesError } = await admin
    .from("companies")
    .select(
      "id, nev, slug, owner_id, plan, primary_color, subscription_started_at",
    )
    .order("nev", { ascending: true });
  if (companiesError) {
    throw new Error(`Tenantok betöltése nem sikerült: ${companiesError.message}`);
  }

  const companies = (companyData ?? []) as SuperadminCompany[];
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(`Felhasználók betöltése nem sikerült: ${error.message}`);
    }
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const ownerEmails = new Map(
    users.map((user) => [user.id, user.email ?? "Nincs e-mail-cím"]),
  );
  const { company: requestedCompanyId } = await searchParams;
  const selectedCompany =
    companies.find((company) => company.id === requestedCompanyId) ??
    companies[0] ??
    null;

  let services: SuperadminService[] = [];
  if (selectedCompany) {
    const { data, error } = await admin
      .from("services")
      .select("id, nev, idotartam_percben, ar, display_order")
      .eq("cég_id", selectedCompany.id)
      .order("display_order", { ascending: true })
      .order("nev", { ascending: true });
    if (error) {
      throw new Error(`Szolgáltatások betöltése nem sikerült: ${error.message}`);
    }
    services = (data ?? []) as SuperadminService[];
  }

  return (
    <SuperadminConsole
      companies={companies}
      ownerEmails={Object.fromEntries(ownerEmails)}
      selectedCompanyId={selectedCompany?.id ?? ""}
      services={services}
      totalAuthUsers={users.length}
    />
  );
}
