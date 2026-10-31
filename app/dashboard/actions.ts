"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
  success?: string;
}

export interface SuperadminActionState {
  error?: string;
  success?: string;
}

type CompanyPlan = "free" | "starter" | "pro";

async function getSuperadminClients() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: isPlatformAdmin, error: roleError } =
    await supabase.rpc("is_platform_admin");
  if (roleError) {
    throw new Error(`Platform-admin jogosultság ellenőrzése nem sikerült: ${roleError.message}`);
  }
  if (isPlatformAdmin !== true) return null;

  return { supabase, admin: createSupabaseAdminClient() };
}

export async function createTenantAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim().toLowerCase();
  const primaryColor = String(formData.get("primaryColor") ?? "");
  const plan = String(formData.get("plan") ?? "");

  if (
    !name ||
    name.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
    ownerEmail.length > 320 ||
    !/^#[0-9a-fA-F]{6}$/.test(primaryColor) ||
    !["free", "starter", "pro"].includes(plan)
  ) {
    return { error: "Ellenőrizd a cég nevét, slugját, kapcsolattartó e-mail-címét és a kiválasztott csomagot." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };

  const { data: existingCompany, error: slugError } = await clients.admin
    .from("companies")
    .select("id")
    .ilike("slug", slug)
    .maybeSingle();
  if (slugError) {
    throw new Error(`A foglalóoldal címének ellenőrzése nem sikerült: ${slugError.message}`);
  }
  if (existingCompany) return { error: "Ez a foglalóoldal-cím már használatban van." };

  let ownerId: string | null = null;
  for (let page = 1; !ownerId; page += 1) {
    const { data, error } = await clients.admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(`A tenant kapcsolattartójának keresése nem sikerült: ${error.message}`);
    }

    ownerId = data.users.find(
      (user) => user.email?.toLowerCase() === ownerEmail,
    )?.id ?? null;
    if (ownerId || data.users.length < 1000) break;
  }

  if (!ownerId) {
    const { data, error } =
      await clients.admin.auth.admin.inviteUserByEmail(ownerEmail);
    if (error || !data.user) {
      return {
        error: `A kapcsolattartó meghívása nem sikerült: ${error?.message ?? "A felhasználó nem jött létre."}`,
      };
    }
    ownerId = data.user.id;
  }

  const { error: createError } = await clients.admin.from("companies").insert({
    owner_id: ownerId,
    nev: name,
    slug,
    primary_color: primaryColor,
    plan,
  });
  if (createError) {
    if (createError.code === "23505") {
      return { error: "Ez a foglalóoldal-cím már használatban van." };
    }
    throw new Error(`A szolgáltató létrehozása nem sikerült: ${createError.message}`);
  }

  revalidatePath("/superadmin");
  return { success: `A(z) ${name} szolgáltató létrejött.` };
}

export async function updateTenantPlanAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const plan = String(formData.get("plan") ?? "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId) ||
    !["free", "starter", "pro"].includes(plan)
  ) {
    return { error: "A szolgáltató vagy csomag érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };
  const { error } = await clients.admin
    .from("companies")
    .update({ plan: plan as CompanyPlan })
    .eq("id", companyId);
  if (error) throw new Error(`A szolgáltatói csomag módosítása nem sikerült: ${error.message}`);

  revalidatePath("/superadmin");
  return { success: "A csomag frissült." };
}

export async function createServiceAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("duration"));
  const price = Number(formData.get("price"));
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId) ||
    !name ||
    name.length > 100 ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 1440 ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 1_000_000_000
  ) {
    return { error: "Adj meg érvényes szolgáltatásnevet, időtartamot és árat." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };

  const { data: lastService, error: orderError } = await clients.admin
    .from("services")
    .select("display_order")
    .eq("cég_id", companyId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    throw new Error(`A szolgáltatások betöltése nem sikerült: ${orderError.message}`);
  }

  const { error } = await clients.admin.from("services").insert({
    "cég_id": companyId,
    nev: name,
    idotartam_percben: duration,
    ar: price,
    display_order: (lastService?.display_order ?? -1) + 1,
  });
  if (error) throw new Error(`A szolgáltatás mentése nem sikerült: ${error.message}`);

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás létrejött." };
}

export async function reorderServicesAction(
  companyId: string,
  serviceIds: string[],
): Promise<SuperadminActionState> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId) ||
    !Array.isArray(serviceIds) ||
    serviceIds.some(
      (id) =>
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    ) ||
    new Set(serviceIds).size !== serviceIds.length
  ) {
    return { error: "A szolgáltatások sorrendje érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };
  const { error } = await clients.supabase.rpc("reorder_company_services", {
    p_company_id: companyId,
    p_service_ids: serviceIds,
  });
  if (error) {
    return { error: `A sorrend mentése nem sikerült: ${error.message}` };
  }

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatások új sorrendje elmentve." };
}

export async function signInAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email.includes("@") || password.length < 8) {
    return { error: "Adj meg érvényes e-mail-címet és legalább 8 karakteres jelszót." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: "A bejelentkezés nem sikerült. Ellenőrizd az adatokat." };

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) throw new Error(`Kijelentkezési hiba: ${error.message}`);

  redirect("/dashboard/login");
}

export async function createBlockoutAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const start = String(formData.get("startsAt") ?? "");
  const end = String(formData.get("endsAt") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (
    !companyId ||
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(endDate.getTime()) ||
    endDate <= startDate ||
    startDate <= new Date() ||
    note.length > 200
  ) {
    return { error: "Adj meg érvényes jövőbeli kezdő és végidőpontot, valamint legfeljebb 200 karakteres megjegyzést." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();

  if (authError || !userData.user) {
    return { error: "A művelethez jelentkezz be újra." };
  }

  const { error } = await supabase.rpc("add_manual_blockout", {
    p_company_id: companyId,
    p_start: startDate.toISOString(),
    p_end: endDate.toISOString(),
    p_note: note || null,
  });

  if (error) return { error: `A blokkolás mentése nem sikerült: ${error.message}` };

  revalidatePath("/dashboard");
  return { success: "A blokkolást elmentettük." };
}

export async function deleteBlockoutAction(formData: FormData) {
  const blockoutId = String(formData.get("blockoutId") ?? "");
  if (!blockoutId) throw new Error("Hiányzik a blokkolás azonosítója.");

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/dashboard/login");

  const { error } = await supabase.rpc("delete_manual_blockout", {
    p_blockout_id: blockoutId,
  });
  if (error) throw new Error(`A blokkolás törlése nem sikerült: ${error.message}`);

  revalidatePath("/dashboard");
}
