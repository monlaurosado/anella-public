"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  submitContribution,
  type ContributionFormState,
} from "@/actions/contributions";
import {
  type ContributionDraftValues,
  useContributionDraftStore,
} from "@/components/incidents/contribution-draft-context";
import { calculateRemainingQuantity } from "@/lib/contribution-quantities";
import type { Incident, Need, SafePoint } from "@/types/domain";

const initialState: ContributionFormState = { ok: false, message: "" };

const categories = [
  ["water", "Agua"],
  ["food", "Alimentos"],
  ["hygiene", "Higiene"],
  ["medical_supplies", "Material sanitario"],
  ["tools", "Herramientas"],
  ["protective_equipment", "Protección"],
  ["transport", "Transporte"],
  ["accommodation", "Alojamiento"],
  ["animal_support", "Ayuda a animales"],
  ["other", "Otro"],
] as const;

const needCategory: Record<Need["type"], (typeof categories)[number][0]> = {
  water: "water",
  food: "food",
  ice: "other",
  medical_supplies: "medical_supplies",
  transport: "transport",
  power: "tools",
  tools: "tools",
  shelter: "accommodation",
  volunteers: "other",
  other: "other",
};

export function ContributionForm({
  incident,
  safePoint,
  need,
  idempotencyKey,
}: {
  incident: Pick<Incident, "id" | "timeZone">;
  safePoint: SafePoint;
  need?: Need;
  idempotencyKey: string;
}) {
  const draftKey = `${safePoint.id}:${need?.id ?? "direct"}`;
  const draftStore = useContributionDraftStore();
  const [restoredDraft] = useState(() => draftStore.getSnapshot(draftKey));
  const [state, action, pending] = useActionState(
    submitContribution,
    restoredDraft?.formState ?? initialState,
  );
  const previousStateRef = useRef(state);
  const submissionStartedRef = useRef(false);
  const pendingObservedRef = useRef(false);
  const [hasPersonalData, setHasPersonalData] = useState(() =>
    Boolean(
      restoredDraft?.values?.citizenName ||
      restoredDraft?.values?.citizenPhone ||
      restoredDraft?.values?.citizenEmail,
    ),
  );
  const remaining = need ? calculateRemainingQuantity(need) : undefined;

  useEffect(() => {
    const stateChanged = previousStateRef.current !== state;
    if (stateChanged) {
      draftStore.saveFormState(draftKey, state);
      previousStateRef.current = state;
    }
    if (pending) {
      pendingObservedRef.current = true;
      return;
    }
    if (
      submissionStartedRef.current &&
      (stateChanged || pendingObservedRef.current)
    ) {
      submissionStartedRef.current = false;
      pendingObservedRef.current = false;
      draftStore.setBusy(draftKey, false);
    }
  }, [draftKey, draftStore, pending, state]);

  function readDraft(form: HTMLFormElement): ContributionDraftValues {
    const data = new FormData(form);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === "string" ? entry : "";
    };
    const etaOccurrence = value("etaOccurrence");
    return {
      category: value("category"),
      description: value("description"),
      citizenEmail: value("citizenEmail"),
      citizenName: value("citizenName"),
      citizenPhone: value("citizenPhone"),
      eta: value("eta"),
      etaOccurrence:
        etaOccurrence === "earlier" || etaOccurrence === "later"
          ? etaOccurrence
          : "reject",
      notes: value("notes"),
      privacyConsent: data.has("privacyConsent"),
      followUpConsent: data.has("followUpConsent"),
      quantity: value("quantity"),
      unit: value("unit"),
    };
  }

  function persistDraft(form: HTMLFormElement) {
    const values = readDraft(form);
    setHasPersonalData(
      Boolean(values.citizenName || values.citizenPhone || values.citizenEmail),
    );
    draftStore.saveValues(draftKey, values);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    persistDraft(event.currentTarget);
    submissionStartedRef.current = true;
    draftStore.setBusy(draftKey, true);
  }

  return (
    <form
      action={action}
      onChange={(event) => persistDraft(event.currentTarget)}
      onSubmit={handleSubmit}
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
    >
      <input type="hidden" name="incidentId" value={incident.id} />
      <input type="hidden" name="safePointId" value={safePoint.id} />
      {need ? <input type="hidden" name="needId" value={need.id} /> : null}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <label
        className="pointer-events-none absolute -left-[10000px] h-px w-px overflow-hidden"
        aria-hidden="true"
      >
        Sitio web de empresa
        <input
          name="companyWebsite"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </label>

      <h3 className="text-base font-semibold">
        {need ? `Ofrecer: ${need.title}` : "¿Qué puedes aportar?"}
      </h3>
      <p className="mt-2 text-xs leading-5 text-black/60 dark:text-white/60">
        Se registrará para que la entidad responsable del punto pueda organizar
        la recepción. No necesitas crear una cuenta.
      </p>
      <p className="mt-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-xs leading-5">
        <strong>Punto de entrega:</strong> {safePoint.name}, {safePoint.address}
        . No acudas a la zona de la emergencia.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
          Categoría
          <select
            name="category"
            required
            defaultValue={
              restoredDraft?.values?.category ??
              (need ? needCategory[need.type] : "other")
            }
            className="h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm"
          >
            {categories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65 sm:col-span-2">
          Descripción breve
          <textarea
            name="description"
            required
            minLength={3}
            maxLength={500}
            defaultValue={restoredDraft?.values?.description ?? need?.title}
            className="min-h-20 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm"
            placeholder="Por ejemplo: cajas de agua cerradas o mantas nuevas"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
          Cantidad <span className="font-normal">(opcional)</span>
          <input
            name="quantity"
            type="number"
            min="1"
            max={remaining}
            defaultValue={restoredDraft?.values?.quantity}
            className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            placeholder="1"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
          Unidad <span className="font-normal">(opcional)</span>
          <input
            name="unit"
            maxLength={32}
            defaultValue={restoredDraft?.values?.unit ?? need?.unit}
            className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            placeholder="cajas, unidades, litros…"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
          Llegada estimada <span className="font-normal">(opcional)</span>
          <input
            name="eta"
            type="datetime-local"
            defaultValue={restoredDraft?.values?.eta}
            className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
          />
        </label>
        <input type="hidden" name="etaOccurrence" value="reject" />
      </div>

      <details className="mt-3 rounded-md border border-[color:var(--border)] p-3">
        <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold">
          Añadir contacto u observaciones (opcional)
        </summary>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
            Nombre
            <input
              name="citizenName"
              autoComplete="name"
              minLength={2}
              maxLength={120}
              defaultValue={restoredDraft?.values?.citizenName}
              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
            Teléfono
            <input
              name="citizenPhone"
              type="tel"
              autoComplete="tel"
              minLength={6}
              maxLength={30}
              defaultValue={restoredDraft?.values?.citizenPhone}
              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65">
            Email
            <input
              name="citizenEmail"
              type="email"
              autoComplete="email"
              defaultValue={restoredDraft?.values?.citizenEmail}
              className="h-11 rounded-md border border-[color:var(--border)] bg-transparent px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-black/65 dark:text-white/65 sm:col-span-2">
            Observaciones
            <textarea
              name="notes"
              maxLength={500}
              defaultValue={restoredDraft?.values?.notes}
              className="min-h-20 rounded-md border border-[color:var(--border)] bg-transparent p-3 text-sm"
              placeholder="Solo información útil para la recepción."
            />
          </label>
        </div>
      </details>

      <label className="mt-4 flex min-h-11 items-start gap-2 text-xs leading-5 text-black/65 dark:text-white/65">
        <input
          name="privacyConsent"
          type="checkbox"
          required={hasPersonalData}
          defaultChecked={restoredDraft?.values?.privacyConsent}
          className="mt-1 size-4 shrink-0 accent-[color:var(--foreground)]"
        />
        <span>
          {hasPersonalData
            ? "Acepto que mis datos de contacto se usen solo para coordinar esta aportación. "
            : "Si facilito datos de contacto, acepto su uso solo para coordinar esta aportación. "}
          <Link href="/privacidad" className="font-semibold underline">
            Política de privacidad
          </Link>
          .
        </span>
      </label>
      <label className="mt-2 flex min-h-11 items-start gap-2 text-xs leading-5 text-black/65 dark:text-white/65">
        <input
          name="followUpConsent"
          type="checkbox"
          defaultChecked={restoredDraft?.values?.followUpConsent}
          className="mt-1 size-4 shrink-0 accent-[color:var(--foreground)]"
        />
        <span>
          Quiero recibir un agradecimiento posterior por email. Es opcional y no
          autoriza comunicaciones comerciales.
        </span>
      </label>

      {state.message ? (
        <p className="mt-3 text-sm" role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] disabled:cursor-wait disabled:opacity-60"
      >
        <Send size={16} aria-hidden />
        {pending ? "Registrando…" : need ? "Lo ofrezco" : "Voy a aportar"}
      </button>
    </form>
  );
}
