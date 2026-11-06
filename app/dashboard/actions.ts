"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkRateLimit, hashIdentifier, uuidSchema } from "@/lib/security";
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

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const serviceFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  duration: z.number().int().min(1).max(1440),
  price: z.number().finite().min(0).max(1_000_000_000),
  description: z.string().trim().max(1000).default(""),
});

const businessHourEntrySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    is_open: z.boolean(),
    opens_at: timeStringSchema,
    closes_at: timeStringSchema,
  })
  .refine((item) => !item.is_open || item.opens_at < item.closes_at, {
    message: "A nyitási időpontnak korábbinak kell lennie a zárásnál.",
  });

const businessHourScheduleSchema = z
  .array(businessHourEntrySchema)
  .length(7)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.weekday)).size === entries.length,
    "A hét minden napját pontosan egyszer kell megadni.",
  );

const tenantBaseSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    plan: z.enum(["free", "starter", "pro"]),
    openingTime: timeStringSchema,
    closingTime: timeStringSchema,
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((val) => isValidTimeZone(val)),
    slotIntervalMinutes: z.number().int().min(5).max(240),
    canEditPrices: z.boolean(),
    canManageServicesAdvanced: z.boolean(),
  })
  .refine((data) => data.openingTime < data.closingTime);

const signInSchema = z.object({
  email: z.string().trim().min(3).max(320).includes("@"),
  password: z.string().min(8).max(256),
});

const blockoutSchema = z
  .object({
    companyId: uuidSchema,
    startsAt: z
      .string()
      .refine((v) => Number.isFinite(new Date(v).getTime())),
    endsAt: z
      .string()
      .refine((v) => Number.isFinite(new Date(v).getTime())),
    note: z.string().trim().max(200),
  })
  .refine((data) => {
    const start = new Date(data.startsAt);
    const end = new Date(data.endsAt);
    return end > start && start > new Date();
  });

function parseCustomBookingFields(value: string): CustomBookingField[] | null {
  const labels = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim())
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

function sanitizeDatabaseError(
  fallbackPrefix: string,
  error: { message?: string; code?: string } | null | undefined,
): string {
  console.error(fallbackPrefix, error);
  const message = error?.message ?? "";
  if (message.includes("conflicts with an active booking")) {
    return `${fallbackPrefix}: Az időszak ütközik egy aktív foglalással.`;
  }
  if (message.includes("At least one valid opening day is required")) {
    return `${fallbackPrefix}: Legalább egy nyitvatartási nap megadása kötelező.`;
  }
  return `${fallbackPrefix}. Kérlek, próbáld újra.`;
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

async function getSuperadminClients() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: isPlatformAdmin, error: roleError } =
    await supabase.rpc("is_platform_admin");
  if (roleError) {
    throw new Error(
      `Platform-admin jogosultság ellenőrzése nem sikerült: ${roleError.message}`,
    );
  }
  if (isPlatformAdmin !== true) return null;

  return { supabase, admin: createSupabaseAdminClient() };
}

interface TenantCompanyPermissions {
  id: string;
  owner_id: string;
  can_edit_prices: boolean;
  can_manage_services_advanced: boolean;
}

/**
 * Explicitly verifies on the server that the authenticated user owns `companyId`
 * (or is a platform admin) and checks required service-management permission flags
 * to prevent IDOR and privilege escalation across tenants.
 */
async function verifyTenantCompanyAccess(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  requirements?: {
    requireAdvancedServices?: boolean;
    requireEditPrices?: boolean;
  },
): Promise<{
  ok: boolean;
  error?: string;
  company?: TenantCompanyPermissions;
}> {
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) {
    return { ok: false, error: "A művelethez jelentkezz be újra." };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, owner_id, can_edit_prices, can_manage_services_advanced")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError || !company) {
    return {
      ok: false,
      error: "Nincs jogosultságod a kiválasztott szolgáltató módosításához.",
    };
  }

  let isAdmin = false;
  if (company.owner_id !== userData.user.id) {
    const { data: adminFlag } = await supabase.rpc("is_platform_admin");
    isAdmin = adminFlag === true;
    if (!isAdmin) {
      return {
        ok: false,
        error: "Nincs jogosultságod a kiválasztott szolgáltató módosításához.",
      };
    }
  }

  if (
    !isAdmin &&
    requirements?.requireAdvancedServices &&
    !company.can_manage_services_advanced
  ) {
    return {
      ok: false,
      error: "Nincs jogosultságod a szolgáltatások bővített kezeléséhez.",
    };
  }

  if (
    !isAdmin &&
    requirements?.requireEditPrices &&
    !company.can_edit_prices
  ) {
    return {
      ok: false,
      error: "Nincs jogosultságod az árak és leírások módosításához.",
    };
  }

  return { ok: true, company };
}

export async function createTenantAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const ownerEmail = String(formData.get("ownerEmail") ?? "")
    .trim()
    .toLowerCase();
  const customBookingFields = parseCustomBookingFields(
    String(formData.get("customBookingFields") ?? ""),
  );
  const parsed = tenantBaseSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    primaryColor: String(formData.get("primaryColor") ?? ""),
    plan: String(formData.get("plan") ?? ""),
    openingTime: String(formData.get("openingTime") ?? ""),
    closingTime: String(formData.get("closingTime") ?? ""),
    timeZone: String(formData.get("timeZone") ?? ""),
    slotIntervalMinutes: Number(formData.get("slotIntervalMinutes")),
    canEditPrices: formData.get("canEditPrices") === "on",
    canManageServicesAdvanced:
      formData.get("canManageServicesAdvanced") === "on",
  });

  if (
    !parsed.success ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
    ownerEmail.length > 320 ||
    customBookingFields === null
  ) {
    return {
      error:
        "Ellenőrizd a cég nevét, slugját, kapcsolattartó e-mail-címét és a kiválasztott csomagot.",
    };
  }

  const {
    name,
    slug,
    primaryColor,
    plan,
    openingTime,
    closingTime,
    timeZone,
    slotIntervalMinutes,
    canEditPrices,
    canManageServicesAdvanced,
  } = parsed.data;

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }

  const { data: existingCompany, error: slugError } = await clients.admin
    .from("companies")
    .select("id")
    .ilike("slug", slug)
    .maybeSingle();
  if (slugError) {
    throw new Error(
      `A foglalóoldal címének ellenőrzése nem sikerült: ${slugError.message}`,
    );
  }
  if (existingCompany) {
    return { error: "Ez a foglalóoldal-cím már használatban van." };
  }

  let ownerId: string | null = null;
  const MAX_USER_PAGES = 10;
  for (let page = 1; !ownerId && page <= MAX_USER_PAGES; page += 1) {
    const { data, error } = await clients.admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw new Error(
        `A tenant kapcsolattartójának keresése nem sikerült: ${error.message}`,
      );
    }

    ownerId =
      data.users.find((user) => user.email?.toLowerCase() === ownerEmail)?.id ??
      null;
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
  const companyIdResult = uuidSchema.safeParse(formData.get("companyId"));
  const customBookingFields = parseCustomBookingFields(
    String(formData.get("customBookingFields") ?? ""),
  );
  const parsed = tenantBaseSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    primaryColor: String(formData.get("primaryColor") ?? ""),
    plan: String(formData.get("plan") ?? ""),
    openingTime: String(formData.get("openingTime") ?? ""),
    closingTime: String(formData.get("closingTime") ?? ""),
    timeZone: String(formData.get("timeZone") ?? ""),
    slotIntervalMinutes: Number(formData.get("slotIntervalMinutes")),
    canEditPrices: formData.get("canEditPrices") === "on",
    canManageServicesAdvanced:
      formData.get("canManageServicesAdvanced") === "on",
  });

  if (!companyIdResult.success || !parsed.success || customBookingFields === null) {
    return { error: "Ellenőrizd a szolgáltató adatait és a nyitvatartást." };
  }

  const companyId = companyIdResult.data;
  const {
    name,
    slug,
    primaryColor,
    plan,
    openingTime,
    closingTime,
    timeZone,
    slotIntervalMinutes,
    canEditPrices,
    canManageServicesAdvanced,
  } = parsed.data;

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }

  const { data: conflictingCompany, error: slugError } = await clients.admin
    .from("companies")
    .select("id")
    .ilike("slug", slug)
    .neq("id", companyId)
    .maybeSingle();
  if (slugError) {
    throw new Error(
      `A foglalóoldal címének ellenőrzése nem sikerült: ${slugError.message}`,
    );
  }
  if (conflictingCompany) {
    return { error: "Ez a foglalóoldal-cím már használatban van." };
  }

  const schedule: BusinessHourEntry[] = Array.from(
    { length: 7 },
    (_, weekday) => ({
      weekday,
      is_open: weekday >= 1 && weekday <= 5,
      opens_at: openingTime,
      closes_at: closingTime,
    }),
  );
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
    throw new Error(
      `A szolgáltató adatainak módosítása nem sikerült: ${error.message}`,
    );
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
  const parsed = z
    .object({
      companyId: uuidSchema,
      plan: z.enum(["free", "starter", "pro"]),
    })
    .safeParse({
      companyId: formData.get("companyId"),
      plan: formData.get("plan"),
    });

  if (!parsed.success) {
    return { error: "A szolgáltató vagy csomag érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }
  const { error } = await clients.admin
    .from("companies")
    .update({ plan: parsed.data.plan as CompanyPlan })
    .eq("id", parsed.data.companyId);
  if (error) {
    throw new Error(
      `A szolgáltatói csomag módosítása nem sikerült: ${error.message}`,
    );
  }

  revalidatePath("/superadmin");
  return { success: "A csomag frissült." };
}

export async function updateTenantStatusAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const parsed = z
    .object({
      companyId: uuidSchema,
      status: z.enum(["pending", "active", "suspended"]),
    })
    .safeParse({
      companyId: formData.get("companyId"),
      status: formData.get("status"),
    });

  if (!parsed.success) {
    return { error: "A szolgáltató vagy státusz érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }
  const { error } = await clients.supabase.rpc("set_company_status", {
    p_company_id: parsed.data.companyId,
    p_status: parsed.data.status,
  });
  if (error) {
    throw new Error(
      `A szolgáltató státuszának módosítása nem sikerült: ${error.message}`,
    );
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
  const companyIdResult = uuidSchema.safeParse(formData.get("companyId"));
  const serviceResult = serviceFieldsSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    duration: Number(formData.get("duration")),
    price: Number(formData.get("price")),
    description: String(formData.get("description") ?? ""),
  });

  if (!companyIdResult.success || !serviceResult.success) {
    return { error: "Adj meg érvényes szolgáltatásnevet, időtartamot és árat." };
  }

  const companyId = companyIdResult.data;
  const { name, duration, price, description } = serviceResult.data;

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }

  const { data: lastService, error: orderError } = await clients.admin
    .from("services")
    .select("display_order")
    .eq("cég_id", companyId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    throw new Error(
      `A szolgáltatások betöltése nem sikerült: ${orderError.message}`,
    );
  }

  const { error } = await clients.admin.from("services").insert({
    "cég_id": companyId,
    nev: name,
    idotartam_percben: duration,
    ar: price,
    leiras: description,
    display_order: (lastService?.display_order ?? -1) + 1,
  });
  if (error) {
    throw new Error(`A szolgáltatás mentése nem sikerült: ${error.message}`);
  }

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás létrejött." };
}

export async function updatePlatformServiceAction(
  _previousState: SuperadminActionState,
  formData: FormData,
): Promise<SuperadminActionState> {
  const idsResult = z
    .object({
      companyId: uuidSchema,
      serviceId: uuidSchema,
    })
    .safeParse({
      companyId: formData.get("companyId"),
      serviceId: formData.get("serviceId"),
    });
  const serviceResult = serviceFieldsSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    duration: Number(formData.get("duration")),
    price: Number(formData.get("price")),
    description: String(formData.get("description") ?? ""),
  });

  if (!idsResult.success || !serviceResult.success) {
    return {
      error: "Ellenőrizd a szolgáltatás nevét, időtartamát, árát és leírását.",
    };
  }

  const { companyId, serviceId } = idsResult.data;
  const { name, duration, price, description } = serviceResult.data;

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }
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
  if (error) {
    throw new Error(`A szolgáltatás mentése nem sikerült: ${error.message}`);
  }
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
  const parsed = z
    .object({
      companyId: uuidSchema,
      serviceId: uuidSchema,
      isActive: z.boolean(),
    })
    .safeParse({ companyId, serviceId, isActive });

  if (!parsed.success) {
    return { error: "A szolgáltatás vagy szolgáltató azonosítója érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }
  const { data, error } = await clients.admin
    .from("services")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.serviceId)
    .eq("cég_id", parsed.data.companyId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(
      `A szolgáltatás állapotának mentése nem sikerült: ${error.message}`,
    );
  }
  if (!data) return { error: "A szolgáltatás nem található." };

  revalidatePath("/superadmin");
  revalidatePath("/", "layout");
  return {
    success: parsed.data.isActive
      ? "A szolgáltatás újra aktív."
      : "A szolgáltatás elrejtve.",
  };
}

export async function reorderServicesAction(
  companyId: string,
  serviceIds: string[],
): Promise<SuperadminActionState> {
  const parsed = z
    .object({
      companyId: uuidSchema,
      serviceIds: z
        .array(uuidSchema)
        .refine((ids) => new Set(ids).size === ids.length),
    })
    .safeParse({ companyId, serviceIds });

  if (!parsed.success) {
    return { error: "A szolgáltatások sorrendje érvénytelen." };
  }

  const clients = await getSuperadminClients();
  if (!clients) {
    return { error: "A művelethez platform-admin jogosultság szükséges." };
  }
  const { error } = await clients.supabase.rpc("reorder_company_services", {
    p_company_id: parsed.data.companyId,
    p_service_ids: parsed.data.serviceIds,
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
  const parsed = signInSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return {
      error:
        "Adj meg érvényes e-mail-címet és legalább 8 karakteres jelszót.",
    };
  }

  const emailHash = hashIdentifier(parsed.data.email.toLowerCase());
  const rateLimit = checkRateLimit("login_email", emailHash, 5, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    return {
      error:
        "Túl sok bejelentkezési próbálkozás. Kérlek, próbáld újra néhány perc múlva.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: "A bejelentkezés nem sikerült. Ellenőrizd az adatokat." };
  }

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
  const parsed = blockoutSchema.safeParse({
    companyId: String(formData.get("companyId") ?? ""),
    startsAt: String(formData.get("startsAt") ?? ""),
    endsAt: String(formData.get("endsAt") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  if (!parsed.success) {
    return {
      error:
        "Adj meg érvényes jövőbeli kezdő és végidőpontot, valamint legfeljebb 200 karakteres megjegyzést.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const access = await verifyTenantCompanyAccess(
    supabase,
    parsed.data.companyId,
  );
  if (!access.ok) {
    return { error: access.error };
  }

  const startDate = new Date(parsed.data.startsAt);
  const endDate = new Date(parsed.data.endsAt);

  const { error } = await supabase.rpc("add_manual_blockout", {
    p_company_id: parsed.data.companyId,
    p_start: startDate.toISOString(),
    p_end: endDate.toISOString(),
    p_note: parsed.data.note || null,
  });

  if (error) {
    return {
      error: sanitizeDatabaseError("A blokkolás mentése nem sikerült", error),
    };
  }

  revalidatePath("/dashboard");
  return { success: "A blokkolást elmentettük." };
}

export async function saveBusinessHoursAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyIdResult = uuidSchema.safeParse(formData.get("companyId"));
  const scheduleText = String(formData.get("schedule") ?? "");
  let rawSchedule: unknown;

  try {
    rawSchedule = JSON.parse(scheduleText);
  } catch {
    return { error: "A nyitvatartás formátuma érvénytelen." };
  }

  const scheduleResult = businessHourScheduleSchema.safeParse(rawSchedule);
  if (!companyIdResult.success || !scheduleResult.success) {
    return { error: "Ellenőrizd a heti nyitvatartást." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await verifyTenantCompanyAccess(
    supabase,
    companyIdResult.data,
  );
  if (!access.ok) {
    return { error: access.error };
  }

  const { error } = await supabase.rpc("update_company_business_hours", {
    p_company_id: companyIdResult.data,
    p_schedule: scheduleResult.data,
  });
  if (error) {
    return {
      error: sanitizeDatabaseError(
        "A nyitvatartás mentése nem sikerült",
        error,
      ),
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A heti nyitvatartás elmentve." };
}

export async function createTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const companyIdResult = uuidSchema.safeParse(formData.get("companyId"));
  const serviceResult = serviceFieldsSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    duration: Number(formData.get("duration")),
    price: Number(formData.get("price")),
    description: String(formData.get("description") ?? ""),
  });

  if (!companyIdResult.success || !serviceResult.success) {
    return { error: "Adj meg érvényes szolgáltatásnevet, időtartamot és árat." };
  }

  const companyId = companyIdResult.data;
  const { name, duration, price, description } = serviceResult.data;

  const supabase = await createSupabaseServerClient();
  const access = await verifyTenantCompanyAccess(supabase, companyId, {
    requireAdvancedServices: true,
  });
  if (!access.ok) {
    return { error: access.error };
  }

  const { data: lastService, error: orderError } = await supabase
    .from("services")
    .select("display_order")
    .eq("cég_id", companyId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    return {
      error: sanitizeDatabaseError(
        "A szolgáltatások betöltése nem sikerült",
        orderError,
      ),
    };
  }

  const { error } = await supabase.from("services").insert({
    "cég_id": companyId,
    nev: name,
    idotartam_percben: duration,
    ar: price,
    leiras: description,
    display_order: (lastService?.display_order ?? -1) + 1,
  });
  if (error) {
    return {
      error: sanitizeDatabaseError(
        "A szolgáltatás mentése nem sikerült",
        error,
      ),
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás létrejött." };
}

export async function updateTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const idsResult = z
    .object({
      companyId: uuidSchema,
      serviceId: uuidSchema,
    })
    .safeParse({
      companyId: formData.get("companyId"),
      serviceId: formData.get("serviceId"),
    });

  if (!idsResult.success) {
    return {
      error: "A szolgáltató vagy szolgáltatás azonosítója érvénytelen.",
    };
  }

  const { companyId, serviceId } = idsResult.data;
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

  const wantsAdvancedEdit = formData.has("name") || formData.has("duration");
  const wantsPriceOrDescEdit =
    priceValue !== null || formData.has("description");

  if (formData.has("name")) {
    const duration = Number(durationValue);
    if (
      !name ||
      name.length > 100 ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 1440
    ) {
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
    if (description.length > 1000) {
      return { error: "A leírás legfeljebb 1000 karakter lehet." };
    }
    update.leiras = description;
  }
  if (!Object.keys(update).length) {
    return { error: "Nincs mentendő módosítás." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await verifyTenantCompanyAccess(supabase, companyId, {
    requireAdvancedServices: wantsAdvancedEdit,
    requireEditPrices: wantsPriceOrDescEdit,
  });
  if (!access.ok) {
    return { error: access.error };
  }

  const { data, error } = await supabase
    .from("services")
    .update(update)
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error: sanitizeDatabaseError(
        "A szolgáltatás módosítása nem sikerült",
        error,
      ),
    };
  }
  if (!data) {
    return {
      error:
        "A szolgáltatás nem található vagy nincs jogosultságod a módosításához.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás adatai frissültek." };
}

export async function deleteTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const idsResult = z
    .object({
      companyId: uuidSchema,
      serviceId: uuidSchema,
    })
    .safeParse({
      companyId: formData.get("companyId"),
      serviceId: formData.get("serviceId"),
    });

  if (!idsResult.success) {
    return {
      error: "A szolgáltató vagy szolgáltatás azonosítója érvénytelen.",
    };
  }

  const { companyId, serviceId } = idsResult.data;
  const supabase = await createSupabaseServerClient();
  const access = await verifyTenantCompanyAccess(supabase, companyId, {
    requireAdvancedServices: true,
  });
  if (!access.ok) {
    return { error: access.error };
  }

  const { data, error } = await supabase
    .from("services")
    .update({ is_active: false })
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error: sanitizeDatabaseError(
        "A szolgáltatás törlése nem sikerült",
        error,
      ),
    };
  }
  if (!data) {
    return {
      error:
        "A szolgáltatás nem található vagy nincs jogosultságod a törléséhez.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás elrejtve." };
}

export async function restoreTenantServiceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const idsResult = z
    .object({
      companyId: uuidSchema,
      serviceId: uuidSchema,
    })
    .safeParse({
      companyId: formData.get("companyId"),
      serviceId: formData.get("serviceId"),
    });

  if (!idsResult.success) {
    return {
      error: "A szolgáltató vagy szolgáltatás azonosítója érvénytelen.",
    };
  }

  const { companyId, serviceId } = idsResult.data;
  const supabase = await createSupabaseServerClient();
  const access = await verifyTenantCompanyAccess(supabase, companyId, {
    requireAdvancedServices: true,
  });
  if (!access.ok) {
    return { error: access.error };
  }

  const { data, error } = await supabase
    .from("services")
    .update({ is_active: true })
    .eq("id", serviceId)
    .eq("cég_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      error: sanitizeDatabaseError(
        "A szolgáltatás visszaállítása nem sikerült",
        error,
      ),
    };
  }
  if (!data) {
    return {
      error:
        "A szolgáltatás nem található vagy nincs jogosultságod a visszaállításához.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
  return { success: "A szolgáltatás ismét foglalható." };
}

export async function deleteBlockoutAction(formData: FormData) {
  const parsed = uuidSchema.safeParse(formData.get("blockoutId"));
  if (!parsed.success) throw new Error("Hiányzik a blokkolás azonosítója.");

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/dashboard/login");

  const { error } = await supabase.rpc("delete_manual_blockout", {
    p_blockout_id: parsed.data,
  });
  if (error) {
    throw new Error(`A blokkolás törlése nem sikerült: ${error.message}`);
  }

  revalidatePath("/dashboard");
}
