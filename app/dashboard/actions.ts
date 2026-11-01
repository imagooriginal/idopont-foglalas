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
type BusinessHourEntry = {
  weekday: number;
  is_open: boolean;
  opens_at: string;
  closes_at: string;
};
type CustomBookingField = {
  key: string;
  label: string;
  type: "text";
  required: boolean;
};

const companyIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidServiceInput(name: string, duration: number, price: number) {
  return (
    Boolean(name) &&
    name.length <= 100 &&
    Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= 1440 &&
    Number.isFinite(price) &&
    price >= 0 &&
    price <= 1_000_000_000
  );
}

function parseCustomBookingFields(value: string): CustomBookingField[] | null {
  const labels = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (labels.length > 20 || labels.some((line) => line.length > 80)) return null;

  const usedKeys = new Set<string>();
  const fields: CustomBookingField[] = [];
  for (const entry of labels) {
    const required = entry.startsWith("*");
    const label = (required ? entry.slice(1) : entry).trim();
    if (!label) return null;

    const baseKey =
      label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "mezo";
    let key = baseKey;
    for (let suffix = 2; usedKeys.has(key); suffix += 1) {
      key = `${baseKey.slice(0, 36)}_${suffix}`;
    }
    usedKeys.add(key);
    fields.push({ key, label, type: "text", required });
  }
  return fields;
}

function isValidTimeZone(value: string) {
  if (!value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isBusinessHourSchedule(value: unknown): value is BusinessHourEntry[] {
  if (!Array.isArray(value) || value.length !== 7) return false;
  const weekdays = new Set<number>();
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

  return value.every((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.weekday !== "number" ||
      !Number.isInteger(item.weekday) ||
      item.weekday < 0 ||
      item.weekday > 6 ||
      weekdays.has(item.weekday) ||
      typeof item.is_open !== "boolean" ||
      typeof item.opens_at !== "string" ||
      typeof item.closes_at !== "string" ||
      !timePattern.test(item.opens_at) ||
      !timePattern.test(item.closes_at) ||
      (item.is_open && item.opens_at >= item.closes_at)
    ) {
      return false;
    }

    weekdays.add(item.weekday);
    return true;
  });
}

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
  const openingTime = String(formData.get("openingTime") ?? "");
  const closingTime = String(formData.get("closingTime") ?? "");
  const timeZone = String(formData.get("timeZone") ?? "").trim();
  const slotIntervalMinutes = Number(formData.get("slotIntervalMinutes"));
  const canEditPrices = formData.get("canEditPrices") === "on";
  const canManageServicesAdvanced =
    formData.get("canManageServicesAdvanced") === "on";
  const customBookingFields = parseCustomBookingFields(
    String(formData.get("customBookingFields") ?? ""),
  );

  if (
    !name ||
    name.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
    ownerEmail.length > 320 ||
    !/^#[0-9a-fA-F]{6}$/.test(primaryColor) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(openingTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(closingTime) ||
    openingTime >= closingTime ||
    !isValidTimeZone(timeZone) ||
    !Number.isInteger(slotIntervalMinutes) ||
    slotIntervalMinutes < 5 ||
    slotIntervalMinutes > 240 ||
    !["free", "starter", "pro"].includes(plan) ||
    customBookingFields === null
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

  const { data: createdCompany, error: createError } = await clients.admin
    .from("companies")
    .insert({
      owner_id: ownerId,
      nev: name,
      slug,
      primary_color: primaryColor,
      plan,
      nyitvatartas_kezdet: openingTime,
      nyitvatartas_vege: closingTime,
      time_zone: timeZone,
      slot_interval_minutes: slotIntervalMinutes,
      can_manage_services: canManageServicesAdvanced,
      can_edit_prices: canEditPrices,
      can_manage_services_advanced: canManageServicesAdvanced,
      custom_booking_fields: customBookingFields,
      status: "active",
    })
    .select("id")
    .single();
  if (createError || !createdCompany) {
    if (createError?.code === "23505") {
      return { error: "Ez a foglalóoldal-cím már használatban van." };
    }
    throw new Error(
      `A szolgáltató létrehozása nem sikerült: ${createError?.message ?? "A létrehozott tenant nem érhető el."}`,
    );
  }

  const defaultHours = Array.from({ length: 5 }, (_, index) => ({
    company_id: createdCompany.id,
    weekday: index + 1,
    opens_at: openingTime,
    closes_at: closingTime,
  }));
  const { error: hoursError } = await clients.admin
    .from("company_business_hours")
    .upsert(defaultHours, { onConflict: "company_id,weekday" });
  if (hoursError) {
    throw new Error(
      `A szolgáltató létrejött, de az alapértelmezett nyitvatartás mentése nem sikerült: ${hoursError.message}`,
    );
  }

  revalidatePath("/superadmin");
  return { success: `A(z) ${name} szolgáltató létrejött.` };
}

export async function updateTenantSettingsAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const primaryColor = String(formData.get("primaryColor") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const openingTime = String(formData.get("openingTime") ?? "");
  const closingTime = String(formData.get("closingTime") ?? "");
  const timeZone = String(formData.get("timeZone") ?? "").trim();
  const slotIntervalMinutes = Number(formData.get("slotIntervalMinutes"));
  const canEditPrices = formData.get("canEditPrices") === "on";
  const canManageServicesAdvanced =
    formData.get("canManageServicesAdvanced") === "on";
  const customBookingFields = parseCustomBookingFields(
    String(formData.get("customBookingFields") ?? ""),
  );

  if (
    !companyIdPattern.test(companyId) ||
    !name ||
    name.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !/^#[0-9a-fA-F]{6}$/.test(primaryColor) ||
    !["free", "starter", "pro"].includes(plan) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(openingTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(closingTime) ||
    openingTime >= closingTime ||
    !isValidTimeZone(timeZone) ||
    !Number.isInteger(slotIntervalMinutes) ||
    slotIntervalMinutes < 5 ||
    slotIntervalMinutes > 240 ||
    customBookingFields === null
  ) {
    return { error: "Ellenőrizd a szolgáltató adatait és a nyitvatartást." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };

  const { data: conflictingCompany, error: slugError } = await clients.admin
    .from("companies")
    .select("id")
    .ilike("slug", slug)
    .neq("id", companyId)
    .maybeSingle();
  if (slugError) {
    throw new Error(`A foglalóoldal címének ellenőrzése nem sikerült: ${slugError.message}`);
  }
  if (conflictingCompany) return { error: "Ez a foglalóoldal-cím már használatban van." };

  const schedule: BusinessHourEntry[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_open: weekday >= 1 && weekday <= 5,
    opens_at: openingTime,
    closes_at: closingTime,
  }));
  const { error } = await clients.supabase.rpc(
    "update_platform_company_all_settings",
    {
      p_company_id: companyId,
      p_name: name,
      p_slug: slug,
      p_primary_color: primaryColor,
      p_plan: plan,
      p_time_zone: timeZone,
      p_slot_interval_minutes: slotIntervalMinutes,
      p_can_edit_prices: canEditPrices,
      p_can_manage_services_advanced: canManageServicesAdvanced,
      p_schedule: schedule,
      p_custom_booking_fields: customBookingFields,
    },
  );
  if (error) {
    if (error.code === "23505") {
      return { error: "Ez a foglalóoldal-cím már használatban van." };
    }
    throw new Error(`A szolgáltató adatainak módosítása nem sikerült: ${error.message}`);
  }

  revalidatePath("/superadmin");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltató adatai frissültek." };
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

export async function updateTenantStatusAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (
    !companyIdPattern.test(companyId) ||
    !["pending", "active", "suspended"].includes(status)
  ) {
    return { error: "A szolgáltató vagy státusz érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };
  const { error } = await clients.supabase.rpc("set_company_status", {
    p_company_id: companyId,
    p_status: status,
  });
  if (error) {
    throw new Error(`A szolgáltató státuszának módosítása nem sikerült: ${error.message}`);
  }

  revalidatePath("/superadmin");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltató státusza frissült." };
}

export async function createServiceAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("duration"));
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId) ||
    !name ||
    name.length > 100 ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 1440 ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 1_000_000_000 ||
    description.length > 1000
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
    leiras: description,
    display_order: (lastService?.display_order ?? -1) + 1,
  });
  if (error) throw new Error(`A szolgáltatás mentése nem sikerült: ${error.message}`);

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás létrejött." };
}

export async function updatePlatformServiceAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("duration"));
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim();
  if (
    !companyIdPattern.test(companyId) ||
    !companyIdPattern.test(serviceId) ||
    !isValidServiceInput(name, duration, price) ||
    description.length > 1000
  ) {
    return { error: "Ellenőrizd a szolgáltatás nevét, időtartamát, árát és leírását." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };
  const { data, error } = await clients.admin
    .from("services")
    .update({
      nev: name,
      idotartam_percben: duration,
      ar: price,
      leiras: description,
    })
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`A szolgáltatás mentése nem sikerült: ${error.message}`);
  if (!data) return { error: "A szolgáltatás nem található." };

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás frissült." };
}

export async function setPlatformServiceActiveAction(
  companyId: string,
  serviceId: string,
  isActive: boolean,
  previousState: SuperadminActionState,
  _formData: FormData,
): Promise<SuperadminActionState> {
  void previousState;
  void _formData;
  if (
    !companyIdPattern.test(companyId) ||
    !companyIdPattern.test(serviceId) ||
    typeof isActive !== "boolean"
  ) {
    return { error: "A szolgáltatás vagy szolgáltató azonosítója érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) return { error: "A művelethez platform-admin jogosultság szükséges." };
  const { data, error } = await clients.admin
    .from("services")
    .update({ is_active: isActive })
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`A szolgáltatás állapotának mentése nem sikerült: ${error.message}`);
  if (!data) return { error: "A szolgáltatás nem található." };

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return { success: isActive ? "A szolgáltatás újra aktív." : "A szolgáltatás elrejtve." };
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

export async function saveBusinessHoursAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const scheduleText = String(formData.get("schedule") ?? "");
  let schedule: unknown;

  try {
    schedule = JSON.parse(scheduleText);
  } catch {
    return { error: "A nyitvatartás formátuma érvénytelen." };
  }

  if (!companyIdPattern.test(companyId) || !isBusinessHourSchedule(schedule)) {
    return { error: "Ellenőrizd a heti nyitvatartást." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return { error: "A művelethez jelentkezz be újra." };
  }

  const { error } = await supabase.rpc("update_company_business_hours", {
    p_company_id: companyId,
    p_schedule: schedule,
  });
  if (error) {
    return { error: `A nyitvatartás mentése nem sikerült: ${error.message}` };
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A heti nyitvatartás elmentve." };
}

export async function createTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("duration"));
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim();
  if (
    !companyIdPattern.test(companyId) ||
    !isValidServiceInput(name, duration, price) ||
    description.length > 1000
  ) {
    return { error: "Adj meg érvényes szolgáltatásnevet, időtartamot és árat." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return { error: "A művelethez jelentkezz be újra." };
  }

  const { data: lastService, error: orderError } = await supabase
    .from("services")
    .select("display_order")
    .eq("cég_id", companyId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    return { error: `A szolgáltatások betöltése nem sikerült: ${orderError.message}` };
  }

  const { error } = await supabase.from("services").insert({
    "cég_id": companyId,
    nev: name,
    idotartam_percben: duration,
    ar: price,
    leiras: description,
    display_order: (lastService?.display_order ?? -1) + 1,
  });
  if (error) return { error: `A szolgáltatás mentése nem sikerült: ${error.message}` };

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás létrejött." };
}

export async function updateTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const durationValue = formData.get("duration");
  const priceValue = formData.get("price");
  const description = String(formData.get("description") ?? "").trim();
  const update: {
    nev?: string;
    idotartam_percben?: number;
    ar?: number;
    leiras?: string;
  } = {};
  if (
    !companyIdPattern.test(companyId) ||
    !companyIdPattern.test(serviceId)
  ) {
    return { error: "A szolgáltató vagy szolgáltatás azonosítója érvénytelen." };
  }
  if (formData.has("name")) {
    const duration = Number(durationValue);
    if (!name || name.length > 100 || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
      return { error: "Adj meg érvényes szolgáltatásnevet és időtartamot." };
    }
    update.nev = name;
    update.idotartam_percben = duration;
  }
  if (priceValue !== null) {
    const price = Number(priceValue);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
      return { error: "Adj meg érvényes árat." };
    }
    update.ar = price;
  }
  if (formData.has("description")) {
    if (description.length > 1000) return { error: "A leírás legfeljebb 1000 karakter lehet." };
    update.leiras = description;
  }
  if (!Object.keys(update).length) return { error: "Nincs mentendő módosítás." };

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return { error: "A művelethez jelentkezz be újra." };
  }

  const { data, error } = await supabase
    .from("services")
    .update(update)
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) return { error: `A szolgáltatás módosítása nem sikerült: ${error.message}` };
  if (!data) return { error: "A szolgáltatás nem található vagy nincs jogosultságod a módosításához." };

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás adatai frissültek." };
}

export async function deleteTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  if (!companyIdPattern.test(companyId) || !companyIdPattern.test(serviceId)) {
    return { error: "A szolgáltató vagy szolgáltatás azonosítója érvénytelen." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return { error: "A művelethez jelentkezz be újra." };
  }

  const { data, error } = await supabase
    .from("services")
    .update({ is_active: false })
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) return { error: `A szolgáltatás törlése nem sikerült: ${error.message}` };
  if (!data) return { error: "A szolgáltatás nem található vagy nincs jogosultságod a törléséhez." };

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás elrejtve." };
}

export async function restoreTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyId = String(formData.get("companyId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  if (!companyIdPattern.test(companyId) || !companyIdPattern.test(serviceId)) {
    return { error: "A szolgáltató vagy szolgáltatás azonosítója érvénytelen." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return { error: "A művelethez jelentkezz be újra." };
  }

  const { data, error } = await supabase
    .from("services")
    .update({ is_active: true })
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) return { error: `A szolgáltatás visszaállítása nem sikerült: ${error.message}` };
  if (!data) return { error: "A szolgáltatás nem található vagy nincs jogosultságod a visszaállításához." };

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás ismét foglalható." };
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
