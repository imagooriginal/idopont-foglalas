"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
  success?: string;
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
