"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n";
import {
  createServiceAction,
  createTenantAction,
  reorderServicesAction,
  setPlatformServiceActiveAction,
  updateTenantPlanAction,
  updateTenantStatusAction,
  updatePlatformServiceAction,
  updateTenantSettingsAction,
  type SuperadminActionState,
} from "../dashboard/actions";

export interface SuperadminCompany {
  id: string;
  status: "pending" | "active" | "suspended";
  nev: string;
  slug: string;
  owner_id: string;
  plan: "free" | "starter" | "pro";
  primary_color: string;
  subscription_started_at: string;
  nyitvatartas_kezdet: string;
  nyitvatartas_vege: string;
  can_manage_services: boolean;
  can_edit_prices: boolean;
  can_manage_services_advanced: boolean;
  custom_booking_fields: unknown;
  time_zone: string;
  slot_interval_minutes: number;
}

export interface SuperadminService {
  id: string;
  nev: string;
  idotartam_percben: number;
  ar: number | string;
  display_order: number;
  leiras: string;
  is_active: boolean;
}

const initialState: SuperadminActionState = {};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function bookingFieldsToLines(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .filter(
      (field): field is { label: string; required?: boolean } =>
        Boolean(field) &&
        typeof field === "object" &&
        typeof (field as { label?: unknown }).label === "string",
    )
    .map((field) => `${field.required ? "*" : ""}${field.label}`)
    .join("\n");
}

function Metric({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: number;
  detail: string;
  color: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </p>
      <p className={`mt-2 text-xs font-medium ${color}`}>{detail}</p>
    </article>
  );
}

function ActionMessage({ state }: { state: SuperadminActionState }) {
  if (state.error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

function TenantCreateForm() {
  const [state, action, pending] = useActionState(createTenantAction, initialState);
  const [name, setName] = useState("");
  const slug = slugify(name);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Új tenant
        </p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Szolgáltató hozzáadása
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          A kapcsolattartó e-mail-címére belépési meghívót küldünk.
        </p>
      </div>
      <form action={action} className="space-y-4">
        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
          Cég neve
          <input
            autoComplete="organization"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            maxLength={100}
            name="name"
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
          Foglalóoldal címe
          <span className="flex items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-sm font-normal text-slate-500 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100">
            <span className="pl-3">/</span>
            <input
              aria-label="Generált slug"
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-slate-800 outline-none"
              name="slug"
              readOnly
              required
              value={slug}
            />
          </span>
        </label>
        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
          Kapcsolattartó e-mail-címe
          <input
            autoComplete="email"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            maxLength={320}
            name="ownerEmail"
            required
            type="email"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Fő szín
            <span className="flex h-11 items-center gap-3 rounded-xl border border-slate-200 px-3">
              <input
                aria-label="Fő szín"
                className="size-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
                defaultValue="#1d4ed8"
                name="primaryColor"
                type="color"
              />
              <span className="text-xs font-normal text-slate-500">
                Foglalóoldal arculati színe
              </span>
            </span>
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Csomag
            <select
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              defaultValue="starter"
              name="plan"
            >
              <option value="starter">Alap (Starter)</option>
              <option value="pro">Prémium (Pro)</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            Nyitás
            <input
              className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              defaultValue="09:00"
              name="openingTime"
              required
              type="time"
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            Zárás
            <input
              className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              defaultValue="17:00"
              name="closingTime"
              required
              type="time"
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            Időzóna
            <input
              className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
              defaultValue="Europe/Budapest"
              maxLength={100}
              name="timeZone"
              required
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            Időpont-rács (perc)
            <input
              className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
              defaultValue={15}
              max={240}
              min={5}
              name="slotIntervalMinutes"
              required
              type="number"
            />
          </label>
        </div>
        <p className="text-xs leading-5 text-slate-500">
          Az új szolgáltató hétfőtől péntekig lesz nyitva. A heti rend később
          naponta módosítható a szolgáltatói dashboardon.
        </p>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
          <input
            className="mt-0.5 size-4 accent-blue-700"
            defaultChecked
            name="canEditPrices"
            type="checkbox"
          />
          <span>
            <span className="block font-semibold">
              Ár és leírás módosításának engedélyezése
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Alapértelmezetten engedélyezett az Alap és Prémium csomagban is (egyedileg felülbírálható).
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
          <input
            className="mt-0.5 size-4 accent-blue-700"
            defaultChecked
            name="canManageServicesAdvanced"
            type="checkbox"
          />
          <span>
            <span className="block font-semibold">
              Haladó szolgáltatáskezelés engedélyezése
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Új szolgáltatást adhat hozzá, módosíthatja az időtartamot és törölheti/elrejtheti a szolgáltatásokat.
            </span>
          </span>
        </label>
        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
          <span className="flex items-center justify-between gap-2">
            <span>Extra foglalási kérdések</span>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
              Prémium (Pro) funkció
            </span>
          </span>
          <textarea
            className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
            name="customBookingFields"
            placeholder={"Rendszám\n*Márka\nModell"}
            rows={3}
          />
          <span className="block text-xs font-normal text-slate-500">
            Egy mező soronként; a *-gal kezdődő mező kötelező. Csak Prémium (Pro) csomagban jelenik meg a publikus foglalóoldalon.
          </span>
        </label>
        <ActionMessage state={state} />
        <button
          className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          disabled={pending || !slug}
          type="submit"
        >
          {pending ? "Létrehozás..." : "Szolgáltató létrehozása"}
        </button>
      </form>
    </section>
  );
}

function TenantSettingsForm({ company }: { company: SuperadminCompany }) {
  const [state, action, pending] = useActionState(
    updateTenantSettingsAction,
    initialState,
  );

  return (
    <form
      action={action}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <input name="companyId" type="hidden" value={company.id} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Szolgáltató beállításai
        </p>
        <h3 className="mt-1 text-lg font-bold text-slate-950">
          {company.nev} szerkesztése
        </h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Cég neve
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
            defaultValue={company.nev}
            maxLength={100}
            name="name"
            required
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Foglalóoldal címe
          <span className="flex items-center rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-500">
            /
            <input
              className="min-w-0 flex-1 px-2 py-2.5 text-slate-800 outline-none"
              defaultValue={company.slug}
              name="slug"
              required
            />
          </span>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Fő szín
          <span className="flex h-11 items-center gap-3 rounded-xl border border-slate-200 px-3">
            <input
              aria-label={`${company.nev} fő színe`}
              className="size-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
              defaultValue={company.primary_color}
              name="primaryColor"
              type="color"
            />
            <span className="text-xs font-normal text-slate-500">
              Foglalóoldal arculati színe
            </span>
          </span>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Csomag
          <select
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"
            defaultValue={company.plan === "pro" ? "pro" : "starter"}
            name="plan"
          >
            <option value="starter">Alap (Starter)</option>
            <option value="pro">Prémium (Pro)</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Nyitás
          <input
            className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
            defaultValue={company.nyitvatartas_kezdet.slice(0, 5)}
            name="openingTime"
            required
            type="time"
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Zárás
          <input
            className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
            defaultValue={company.nyitvatartas_vege.slice(0, 5)}
            name="closingTime"
            required
            type="time"
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Időzóna
          <input
            className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
            defaultValue={company.time_zone}
            maxLength={100}
            name="timeZone"
            required
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-slate-700">
          Időpont-rács (perc)
          <input
            className="h-11 w-full rounded-xl border border-slate-200 px-3 font-normal"
            defaultValue={company.slot_interval_minutes}
            max={240}
            min={5}
            name="slotIntervalMinutes"
            required
            type="number"
          />
        </label>
      </div>
      <p className="text-xs leading-5 text-slate-500">
        A megadott időt hétfőtől péntekig állítjuk be; a hétvége zárva lesz.
        A részletes heti rendet a szolgáltató később naponta módosíthatja.
      </p>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
        <input
          className="mt-0.5 size-4 accent-blue-700"
          defaultChecked={company.can_edit_prices}
          name="canEditPrices"
          type="checkbox"
        />
        <span>
          <span className="block font-semibold">
            Ár és leírás módosításának engedélyezése
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            A szolgáltató meglévő szolgáltatások árát és leírását módosíthatja.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
        <input
          className="mt-0.5 size-4 accent-blue-700"
          defaultChecked={company.can_manage_services_advanced}
          name="canManageServicesAdvanced"
          type="checkbox"
        />
        <span>
          <span className="block font-semibold">
            Haladó szolgáltatáskezelés engedélyezése
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Új szolgáltatást adhat hozzá, módosíthatja az időtartamot és elrejtheti a szolgáltatásokat.
          </span>
        </span>
      </label>
      <label className="block space-y-1.5 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between gap-2">
          <span>Extra foglalási kérdések</span>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
            Prémium (Pro) funkció
          </span>
        </span>
        <textarea
          className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal"
          defaultValue={bookingFieldsToLines(company.custom_booking_fields)}
          name="customBookingFields"
          placeholder={"Rendszám\n*Márka\nModell"}
          rows={3}
        />
        <span className="block text-xs font-normal text-slate-500">
          Egy mező soronként; a *-gal kezdődő mező kötelező. Csak Prémium (Pro) csomagban aktív.
        </span>
      </label>
      <ActionMessage state={state} />
      <button
        className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Mentés..." : "Szolgáltató adatainak mentése"}
      </button>
    </form>
  );
}

function PlanForm({ company }: { company: SuperadminCompany }) {
  const [state, action, pending] = useActionState(
    updateTenantPlanAction,
    initialState,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="companyId" type="hidden" value={company.id} />
      <select
        aria-label={`${company.nev} csomagja`}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        defaultValue={company.plan === "pro" ? "pro" : "starter"}
        name="plan"
      >
        <option value="starter">Alap (Starter)</option>
        <option value="pro">Prémium (Pro)</option>
      </select>
      <button
        className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        disabled={pending}
        type="submit"
      >
        {pending ? "..." : "Mentés"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function TenantStatusForm({ company }: { company: SuperadminCompany }) {
  const [state, action, pending] = useActionState(
    updateTenantStatusAction,
    initialState,
  );
  return (
    <form action={action} className="space-y-2">
      <input name="companyId" type="hidden" value={company.id} />
      <label className="sr-only" htmlFor={`status-${company.id}`}>
        {company.nev} státusza
      </label>
      <select
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
        defaultValue={company.status}
        id={`status-${company.id}`}
        name="status"
      >
        <option value="pending">Jóváhagyásra vár</option>
        <option value="active">Aktív</option>
        <option value="suspended">Felfüggesztve</option>
      </select>
      <button
        className="w-full rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Mentés..." : "Státusz mentése"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function SortableService({
  companyId,
  service,
}: {
  companyId: string;
  service: SuperadminService;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: service.id });
  const [state, action, pending] = useActionState(
    updatePlatformServiceAction,
    initialState,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    setPlatformServiceActiveAction.bind(
      null,
      companyId,
      service.id,
      !service.is_active,
    ),
    initialState,
  );

  return (
    <li
      className={`rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm ${
        isDragging ? "z-10 opacity-70 shadow-lg" : ""
      }`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="flex items-center gap-3">
        <button
          aria-label={`${service.nev} áthúzása`}
          className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg bg-slate-50 text-slate-500 active:cursor-grabbing"
          type="button"
          {...attributes}
          {...listeners}
        >
          <svg
            aria-hidden="true"
            className="size-5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <circle cx="7" cy="5" r="1.5" />
            <circle cx="13" cy="5" r="1.5" />
            <circle cx="7" cy="10" r="1.5" />
            <circle cx="13" cy="10" r="1.5" />
            <circle cx="7" cy="15" r="1.5" />
            <circle cx="13" cy="15" r="1.5" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{service.nev}</p>
          <p className="mt-1 text-xs text-slate-500">
            {service.idotartam_percben} perc · {Number(service.ar).toLocaleString("hu-HU")} Ft
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          service.is_active
            ? "bg-emerald-50 text-emerald-700"
            : "bg-slate-100 text-slate-500"
        }`}>
          {service.is_active ? "Aktív" : "Rejtett"} · {service.display_order + 1}.
        </span>
      </div>
      <form action={action} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <input name="companyId" type="hidden" value={companyId} />
        <input name="serviceId" type="hidden" value={service.id} />
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Név
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
            defaultValue={service.nev}
            maxLength={100}
            name="name"
            required
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Időtartam (perc)
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
            defaultValue={service.idotartam_percben}
            max={1440}
            min={1}
            name="duration"
            required
            type="number"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Ár (Ft)
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
            defaultValue={Number(service.ar)}
            max={1_000_000_000}
            min={0}
            name="price"
            required
            type="number"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Leírás
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
            defaultValue={service.leiras}
            maxLength={1000}
            name="description"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
          <button
            className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Mentés..." : "Módosítás"}
          </button>
          <ActionMessage state={state} />
        </div>
      </form>
      <form action={toggleAction} className="mt-2">
        <button
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          disabled={toggling}
          type="submit"
        >
          {toggling
            ? "Mentés..."
            : service.is_active
              ? "Elrejtés"
              : "Újraaktiválás"}
        </button>
        <ActionMessage state={toggleState} />
      </form>
    </li>
  );
}

function ServiceManager({
  companyId,
  services: initialServices,
}: {
  companyId: string;
  services: SuperadminService[];
}) {
  const [services, setServices] = useState(initialServices);
  const [message, setMessage] = useState<SuperadminActionState>({});
  const [pending, startTransition] = useTransition();
  const [state, action, creating] = useActionState(createServiceAction, initialState);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = services.findIndex((service) => service.id === active.id);
    const newIndex = services.findIndex((service) => service.id === over.id);
    const previous = services;
    const reordered = arrayMove(services, oldIndex, newIndex).map(
      (service, index) => ({ ...service, display_order: index }),
    );
    setServices(reordered);
    setMessage({});
    startTransition(async () => {
      const result = await reorderServicesAction(
        companyId,
        reordered.map((service) => service.id),
      );
      if (result.error) {
        setServices(previous);
        setMessage(result);
      } else {
        setMessage(result);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Tenant szolgáltatásai
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            Szolgáltatáslista és sorrend
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Húzd a fogantyút a sorrend módosításához; a változás automatikusan mentődik.
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          {services.length} szolgáltatás
        </span>
      </div>

      <form action={action} className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_8rem_8rem_auto]">
        <input name="companyId" type="hidden" value={companyId} />
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Szolgáltatás neve
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            maxLength={100}
            name="name"
            placeholder="Például: Alap szerviz"
            required
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Időtartam (perc)
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            max="1440"
            min="1"
            name="duration"
            required
            type="number"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Ár (Ft)
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            max="1000000000"
            min="0"
            name="price"
            required
            step="1"
            type="number"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600 sm:col-span-2 xl:col-span-4">
          Leírás
          <textarea
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            maxLength={1000}
            name="description"
            rows={2}
          />
        </label>
        <button
          className="self-end rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-60 sm:col-span-2 xl:col-span-4"
          disabled={creating}
          type="submit"
        >
          {creating ? "Mentés..." : "Hozzáadás"}
        </button>
        <div className="sm:col-span-2 xl:col-span-4">
          <ActionMessage state={state} />
          <ActionMessage state={message} />
        </div>
      </form>

      {!services.length ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center">
          <p className="font-semibold text-slate-800">Még nincs szolgáltatás</p>
          <p className="mt-1 text-sm text-slate-500">
            A fenti űrlappal add hozzá az első szolgáltatást.
          </p>
        </div>
      ) : (
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext
            items={services.map((service) => service.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              aria-label="Rendezhető szolgáltatások"
              className={`mt-4 space-y-2 ${pending ? "pointer-events-none opacity-60" : ""}`}
            >
              {services.map((service) => (
                <SortableService
                  companyId={companyId}
                  key={service.id}
                  service={service}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function TenantTable({
  companies,
  ownerEmails,
}: {
  companies: SuperadminCompany[];
  ownerEmails: Record<string, string>;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <h2 className="text-lg font-bold text-slate-950">
          Szolgáltatók és előfizetők
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          A regisztráció kezdete és a manuálisan kezelt csomag.
        </p>
      </div>
      {!companies.length ? (
        <p className="p-8 text-center text-sm text-slate-500">
          Még nincs regisztrált szolgáltató.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {companies.map((company) => (
            <article
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:px-6"
              key={company.id}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full ring-4 ring-slate-100"
                  style={{ backgroundColor: company.primary_color }}
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{company.nev}</p>
                  <p className="truncate text-xs text-slate-500">
                    /{company.slug} · {ownerEmails[company.owner_id] ?? "Nincs kapcsolattartó"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                  Regisztráció
                </p>
                <p className="text-sm text-slate-700">
                  {company.subscription_started_at}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                  Csomag kezelése
                </p>
                <PlanForm company={company} key={`${company.id}:${company.plan}`} />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">
                  Státusz
                </p>
                <TenantStatusForm
                  company={company}
                  key={`${company.id}:${company.status}`}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function SuperadminConsole({
  companies,
  ownerEmails,
  selectedCompanyId,
  services,
  totalAuthUsers,
}: {
  companies: SuperadminCompany[];
  ownerEmails: Record<string, string>;
  selectedCompanyId: string;
  services: SuperadminService[];
  totalAuthUsers: number;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const selectedCompany = companies.find(
    (company) => company.id === selectedCompanyId,
  );
  const plans = {
    starter: companies.filter((company) => company.plan !== "pro").length,
    pro: companies.filter((company) => company.plan === "pro").length,
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-700">
              {t("Platform admin", "Platform Admin")}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              {t("SaaS áttekintő", "SaaS Overview")}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {t(
                "Tenantok, felhasználók és szolgáltatáscsomagok kezelése.",
                "Manage tenants, users, and subscription plans.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitcher />
            <Link
              className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              href="/dashboard"
            >
              {t("Szolgáltatói dashboard", "Provider Dashboard")}
            </Link>
          </div>
        </header>

        <section
          aria-label="SaaS statisztikák"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Metric
            color="text-blue-700"
            detail="Aktív és jóváhagyásra váró tenantok"
            label="Regisztrált előfizetők"
            value={companies.length}
          />
          <Metric
            color="text-violet-700"
            detail="Supabase Auth-fiókok"
            label="Regisztrált felhasználók"
            value={totalAuthUsers}
          />
          <Metric
            color="text-slate-700"
            detail="Alapszintű előfizetők"
            label="Alap (Starter) csomag"
            value={plans.starter}
          />
          <Metric
            color="text-emerald-700"
            detail="Minden prémium funkció aktív"
            label="Prémium (Pro) csomag"
            value={plans.pro}
          />
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.2fr)]">
          <TenantCreateForm />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Tenant kontextus
                </p>
                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  Szolgáltatások kezelése
                </h2>
              </div>
              <label className="w-full space-y-1.5 text-xs font-semibold text-slate-500 sm:w-auto">
                Kiválasztott szolgáltató
                <select
                  className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:min-w-64"
                  onChange={(event) =>
                    router.push(
                      event.target.value
                        ? `/superadmin?company=${encodeURIComponent(event.target.value)}`
                        : "/superadmin",
                    )
                  }
                  value={selectedCompanyId}
                >
                  <option value="">Válassz szolgáltatót...</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.nev}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedCompany ? (
              <div className="mt-5">
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: selectedCompany.primary_color }}
                  />
                  <p className="text-sm font-semibold text-slate-800">
                    {selectedCompany.nev}
                  </p>
                  <span className="ml-auto text-xs text-slate-500">
                    /{selectedCompany.slug}
                  </span>
                </div>
                <ServiceManager
                  companyId={selectedCompany.id}
                  key={`${selectedCompany.id}:${services.map((service) => `${service.id}-${service.display_order}-${service.nev}-${service.idotartam_percben}-${service.ar}-${service.leiras}-${service.is_active}`).join(",")}`}
                  services={services}
                />
                <div className="mt-5">
                  <TenantSettingsForm
                    company={selectedCompany}
                    key={`settings:${selectedCompany.id}:${selectedCompany.can_edit_prices}:${selectedCompany.can_manage_services_advanced}:${bookingFieldsToLines(selectedCompany.custom_booking_fields)}`}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 px-5 py-12 text-center">
                <p className="font-semibold text-slate-800">Még nincs szolgáltató</p>
                <p className="mt-1 text-sm text-slate-500">
                  Hozz létre egy tenantot a szolgáltatások kezeléséhez.
                </p>
              </div>
            )}
          </section>
        </div>

        <TenantTable companies={companies} ownerEmails={ownerEmails} />
      </div>
    </main>
  );
}
