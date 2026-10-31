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
import {
  createServiceAction,
  createTenantAction,
  reorderServicesAction,
  updateTenantPlanAction,
  type SuperadminActionState,
} from "../dashboard/actions";

export interface SuperadminCompany {
  id: string;
  nev: string;
  slug: string;
  owner_id: string;
  plan: "free" | "starter" | "pro";
  primary_color: string;
  subscription_started_at: string;
}

export interface SuperadminService {
  id: string;
  nev: string;
  idotartam_percben: number;
  ar: number | string;
  display_order: number;
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
              defaultValue="free"
              name="plan"
            >
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
            </select>
          </label>
        </div>
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
        defaultValue={company.plan}
        name="plan"
      >
        <option value="free">Free</option>
        <option value="starter">Starter</option>
        <option value="pro">Pro</option>
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

function SortableService({
  service,
}: {
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

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm ${
        isDragging ? "z-10 opacity-70 shadow-lg" : ""
      }`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
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
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        {service.display_order + 1}.
      </span>
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
        <button
          className="self-end rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-60"
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
                <SortableService key={service.id} service={service} />
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
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:px-6"
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
  const selectedCompany = companies.find(
    (company) => company.id === selectedCompanyId,
  );
  const plans = {
    free: companies.filter((company) => company.plan === "free").length,
    starter: companies.filter((company) => company.plan === "starter").length,
    pro: companies.filter((company) => company.plan === "pro").length,
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-blue-700">
              Platform admin
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              SaaS áttekintő
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Tenantok, felhasználók és szolgáltatáscsomagok kezelése.
            </p>
          </div>
          <Link
            className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            href="/dashboard"
          >
            Szolgáltatói dashboard
          </Link>
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
            color="text-slate-600"
            detail="Csomagdíj-hozzárendelés nélkül"
            label="Free csomag"
            value={plans.free}
          />
          <Metric
            color="text-emerald-700"
            detail={`Starter: ${plans.starter} · Pro: ${plans.pro}`}
            label="Fizetős csomagcímke"
            value={plans.starter + plans.pro}
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
                  key={`${selectedCompany.id}:${services.map((service) => `${service.id}-${service.display_order}`).join(",")}`}
                  services={services}
                />
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
