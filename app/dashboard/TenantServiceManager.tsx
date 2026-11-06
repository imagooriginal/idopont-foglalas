"use client";

import { useActionState } from "react";
import {
  createTenantServiceAction,
  deleteTenantServiceAction,
  restoreTenantServiceAction,
  updateTenantServiceAction,
  type ActionState,
} from "./actions";

interface Service {
  id: string;
  nev: string;
  idotartam_percben: number;
  ar: number | string;
  leiras: string;
  is_active: boolean;
}

const initialState: ActionState = {};

function ActionMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="mt-2 text-sm text-red-700" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="mt-2 text-sm text-emerald-700" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

function ServiceEditor({
  companyId,
  service,
  canEditPrices,
  canManageServicesAdvanced,
}: {
  companyId: string;
  service: Service;
  canEditPrices: boolean;
  canManageServicesAdvanced: boolean;
}) {
  const [state, action, pending] = useActionState(
    updateTenantServiceAction,
    initialState,
  );
  const [hideState, hideAction, hiding] = useActionState(
    deleteTenantServiceAction,
    initialState,
  );
  const [restoreState, restoreAction, restoring] = useActionState(
    restoreTenantServiceAction,
    initialState,
  );

  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-semibold text-slate-900">{service.nev}</p>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            service.is_active
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {service.is_active ? "Aktív" : "Rejtett"}
        </span>
      </div>
      <form
        action={action}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <input name="companyId" type="hidden" value={companyId} />
        <input name="serviceId" type="hidden" value={service.id} />
        {canManageServicesAdvanced && (
          <>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Szolgáltatás neve
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-900"
                defaultValue={service.nev}
                maxLength={100}
                name="name"
                required
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Időtartam (perc)
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-900"
                defaultValue={service.idotartam_percben}
                max={1440}
                min={1}
                name="duration"
                required
                type="number"
              />
            </label>
          </>
        )}
        {canEditPrices ? (
          <>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Ár (Ft)
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-900"
                defaultValue={Number(service.ar)}
                max={1_000_000_000}
                min={0}
                name="price"
                required
                step="1"
                type="number"
              />
            </label>
            <label className="space-y-1 text-xs font-semibold text-slate-600">
              Leírás
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-900"
                defaultValue={service.leiras}
                maxLength={1000}
                name="description"
              />
            </label>
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4">
          <button
            className="rounded-lg border border-blue-200 px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? "Mentés..." : "Módosítás"}
          </button>
          <ActionMessage state={state} />
        </div>
      </form>

      {canManageServicesAdvanced && (
        <div className="mt-2">
          {service.is_active ? (
            <form action={hideAction}>
              <input name="companyId" type="hidden" value={companyId} />
              <input name="serviceId" type="hidden" value={service.id} />
              <button
                className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                disabled={hiding}
                type="submit"
              >
                {hiding ? "Elrejtés..." : "Szolgáltatás elrejtése"}
              </button>
            </form>
          ) : (
            <form action={restoreAction}>
              <input name="companyId" type="hidden" value={companyId} />
              <input name="serviceId" type="hidden" value={service.id} />
              <button
                className="rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                disabled={restoring}
                type="submit"
              >
                {restoring ? "Visszaállítás..." : "Újraaktiválás"}
              </button>
            </form>
          )}
          <ActionMessage state={hideState} />
          <ActionMessage state={restoreState} />
        </div>
      )}
    </li>
  );
}

export default function TenantServiceManager({
  companyId,
  services,
  canEditPrices,
  canManageServicesAdvanced,
}: {
  companyId: string;
  services: Service[];
  canEditPrices: boolean;
  canManageServicesAdvanced: boolean;
}) {
  const [state, action, pending] = useActionState(
    createTenantServiceAction,
    initialState,
  );

  return (
    <section
      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"
      id="services"
    >
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          Szolgáltatások
        </p>
        <h2 className="mt-1 text-lg font-bold text-slate-950">
          Szolgáltatások kezelése
        </h2>
        {!canManageServicesAdvanced && (
          <p className="mt-1 text-sm text-slate-500">
            Csak az árak és a leírások módosítása engedélyezett.
          </p>
        )}
      </div>

      {canManageServicesAdvanced && (
        <form
          action={action}
          className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <input name="companyId" type="hidden" value={companyId} />
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Szolgáltatás neve
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"
              maxLength={100}
              name="name"
              required
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Időtartam (perc)
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"
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
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"
              max={1_000_000_000}
              min={0}
              name="price"
              required
              step="1"
              type="number"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-slate-600">
            Leírás
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal"
              maxLength={1000}
              name="description"
            />
          </label>
          <button
            className="self-end rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 sm:col-span-2 xl:col-span-4"
            disabled={pending}
            type="submit"
          >
            {pending ? "Mentés..." : "Hozzáadás"}
          </button>
          <div className="sm:col-span-2 xl:col-span-4">
            <ActionMessage state={state} />
          </div>
        </form>
      )}

      {services.length ? (
        <ul className="mt-4 space-y-3">
          {services.map((service) => (
            <ServiceEditor
              canEditPrices={canEditPrices}
              canManageServicesAdvanced={canManageServicesAdvanced}
              companyId={companyId}
              key={service.id}
              service={service}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          Még nincs szolgáltatás.
        </p>
      )}
    </section>
  );
}
