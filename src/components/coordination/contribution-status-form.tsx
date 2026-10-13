"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import {
  reassignContribution,
  getContributionReassignmentTargets,
  type ContributionReassignmentTarget,
  updateContributionStatus,
  type ContributionReassignState,
  type ContributionUpdateState,
} from "@/actions/coordination";
import { formatQuantity } from "@/lib/format";

const initialUpdateState: ContributionUpdateState = {
  ok: false,
  message: "",
};
const initialReassignState: ContributionReassignState = {
  ok: false,
  message: "",
};

const statuses = [
  "PLEDGED",
  "EN_ROUTE",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "CANCELLED",
  "NO_SHOW",
] as const;

type ContributionStatusValue = (typeof statuses)[number];
type SelectableStatus = ContributionStatusValue | "";

const statusLabels: Record<ContributionStatusValue, string> = {
  PLEDGED: "Confirmada",
  EN_ROUTE: "En camino",
  PARTIALLY_DELIVERED: "Entrega parcial",
  DELIVERED: "Entregada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No presentada",
};

const allowedTransitions: Record<
  ContributionStatusValue,
  ContributionStatusValue[]
> = {
  PLEDGED: [
    "EN_ROUTE",
    "PARTIALLY_DELIVERED",
    "DELIVERED",
    "CANCELLED",
    "NO_SHOW",
  ],
  EN_ROUTE: ["PARTIALLY_DELIVERED", "DELIVERED", "CANCELLED", "NO_SHOW"],
  PARTIALLY_DELIVERED: [
    "PARTIALLY_DELIVERED",
    "DELIVERED",
    "CANCELLED",
    "NO_SHOW",
  ],
  DELIVERED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const inputClass =
  "min-h-11 min-w-0 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

export function ContributionStatusForm({
  incidentId,
  contributionId,
  contributionLabel,
  status,
  quantity,
  unit,
  deliveredQuantity,
  revision,
  destinationAvailable = true,
  buttonLabel = "Actualizar estado",
}: {
  incidentId: string;
  contributionId: string;
  contributionLabel: string;
  status: string;
  quantity: number;
  unit: string;
  deliveredQuantity: number;
  revision?: number;
  destinationAvailable?: boolean;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const normalizedStatus = statuses.includes(
    status.toUpperCase() as ContributionStatusValue,
  )
    ? (status.toUpperCase() as ContributionStatusValue)
    : "PLEDGED";
  const [selectedStatus, setSelectedStatus] = useState<SelectableStatus>("");
  const [delivered, setDelivered] = useState(deliveredQuantity);
  const [reassignmentTargets, setReassignmentTargets] = useState<
    ContributionReassignmentTarget[] | null
  >(null);
  const [reassignmentMessage, setReassignmentMessage] = useState("");
  const [loadingTargets, startLoadingTargets] = useTransition();
  const [updateState, updateAction, updatePending] = useActionState(
    updateContributionStatus,
    initialUpdateState,
  );
  const [reassignState, reassignAction, reassignPending] = useActionState(
    reassignContribution,
    initialReassignState,
  );

  useEffect(() => {
    if (updateState.ok && updateState.revision) {
      router.refresh();
    }
  }, [router, updateState.ok, updateState.revision]);

  useEffect(() => {
    if (reassignState.ok && reassignState.revision) {
      router.refresh();
    }
  }, [reassignState.ok, reassignState.revision, router]);

  const transitions = useMemo(
    () =>
      allowedTransitions[normalizedStatus].filter(
        (nextStatus) =>
          (destinationAvailable ||
            !["EN_ROUTE", "PARTIALLY_DELIVERED", "DELIVERED"].includes(
              nextStatus,
            )) &&
          (nextStatus !== "PARTIALLY_DELIVERED" ||
            deliveredQuantity + 1 < quantity),
      ),
    [deliveredQuantity, destinationAvailable, normalizedStatus, quantity],
  );
  const requiresReason =
    selectedStatus === "CANCELLED" || selectedStatus === "NO_SHOW";
  const canRequestReassignment =
    normalizedStatus === "PLEDGED" && deliveredQuantity === 0;

  function loadReassignmentTargets(open: boolean) {
    if (!open || reassignmentTargets !== null || loadingTargets) return;
    startLoadingTargets(async () => {
      const result = await getContributionReassignmentTargets(
        incidentId,
        contributionId,
      );
      setReassignmentTargets(result.targets);
      setReassignmentMessage(result.message);
    });
  }

  function changeStatus(nextStatus: SelectableStatus) {
    setSelectedStatus(nextStatus);
    if (nextStatus === "DELIVERED") {
      setDelivered(quantity);
      return;
    }
    if (nextStatus === "PARTIALLY_DELIVERED") {
      setDelivered(Math.min(quantity - 1, deliveredQuantity + 1));
      return;
    }
    setDelivered(deliveredQuantity);
  }

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs font-semibold text-black/65 dark:text-white/65">
        Estado actual: {statusLabels[normalizedStatus]}
      </p>

      {!destinationAvailable ? (
        <p
          className="rounded-md border border-red-500/25 bg-red-500/[0.06] p-3 text-sm text-[color:var(--danger)]"
          role="alert"
        >
          El destino ya no está activo y validado. No inicies trayectos ni
          registres recepciones; cancela o reasigna de forma segura.
        </p>
      ) : null}

      {transitions.length > 0 ? (
        <form action={updateAction} className="grid gap-3">
          <input type="hidden" name="incidentId" value={incidentId} />
          <input type="hidden" name="contributionId" value={contributionId} />
          {revision !== undefined ? (
            <input type="hidden" name="revision" value={revision} />
          ) : null}
          {selectedStatus !== "PARTIALLY_DELIVERED" ? (
            <input type="hidden" name="deliveredQuantity" value={delivered} />
          ) : null}

          <label className="grid gap-1.5 text-sm font-medium">
            <span>
              Nuevo estado
              <span className="sr-only"> para {contributionLabel}</span>
            </span>
            <select
              name="status"
              value={selectedStatus}
              required
              disabled={updatePending}
              onChange={(event) =>
                changeStatus(event.target.value as SelectableStatus)
              }
              className={inputClass}
            >
              <option value="" disabled>
                Selecciona un estado
              </option>
              {transitions.map((nextStatus) => (
                <option key={nextStatus} value={nextStatus}>
                  {statusLabels[nextStatus]}
                </option>
              ))}
            </select>
          </label>

          {selectedStatus === "PARTIALLY_DELIVERED" ? (
            <label className="grid gap-1.5 text-sm font-medium">
              Cantidad total recibida ({unit})
              <input
                name="deliveredQuantity"
                type="number"
                min={deliveredQuantity + 1}
                max={quantity - 1}
                required
                value={delivered}
                disabled={updatePending}
                onChange={(event) => setDelivered(Number(event.target.value))}
                className={inputClass}
              />
              <span className="text-xs font-normal text-black/65 dark:text-white/65">
                Ya constan {formatQuantity(deliveredQuantity, unit)}; el total
                de la entrega es {formatQuantity(quantity, unit)}.
              </span>
            </label>
          ) : null}

          {requiresReason ? (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                Motivo obligatorio
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  disabled={updatePending}
                  className="min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
                  placeholder="Explica la cancelación o la ausencia"
                />
              </label>
              <label className="flex min-h-11 items-start gap-3 rounded-md bg-red-500/[0.06] p-3 text-sm leading-5">
                <input
                  name="confirmContributionStatus"
                  type="checkbox"
                  required
                  disabled={updatePending}
                  className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                />
                Confirmo que he verificado este resultado y que no se descuenta
                material ya recepcionado.
              </label>
            </>
          ) : null}

          <button
            type="submit"
            aria-label={`${buttonLabel} para ${contributionLabel}`}
            disabled={updatePending || !selectedStatus}
            className="min-h-11 rounded-md bg-[color:var(--foreground)] px-4 text-sm font-semibold text-[color:var(--background)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {updatePending ? "Guardando…" : buttonLabel}
          </button>
        </form>
      ) : (
        <p className="rounded-md bg-[color:var(--surface-muted)] p-3 text-sm text-black/65 dark:text-white/65">
          Estado final; no admite más cambios.
        </p>
      )}

      {updateState.message ? (
        <p
          role={updateState.ok ? "status" : "alert"}
          className={`text-xs font-semibold ${
            updateState.ok
              ? "text-[color:var(--success)]"
              : "text-[color:var(--danger)]"
          }`}
        >
          {updateState.message}
        </p>
      ) : null}

      {canRequestReassignment ? (
        <details
          className="rounded-md border border-[color:var(--border)]"
          onToggle={(event) =>
            loadReassignmentTargets(event.currentTarget.open)
          }
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">
            Reasignar a otra necesidad
          </summary>
          {loadingTargets ? (
            <p
              className="border-t border-[color:var(--border)] p-3 text-sm"
              role="status"
            >
              Comprobando destinos seguros…
            </p>
          ) : null}
          {!loadingTargets && reassignmentTargets?.length ? (
            <form
              action={reassignAction}
              className="grid gap-3 border-t border-[color:var(--border)] p-3"
            >
              <input type="hidden" name="incidentId" value={incidentId} />
              <input
                type="hidden"
                name="contributionId"
                value={contributionId}
              />
              {revision !== undefined ? (
                <input type="hidden" name="revision" value={revision} />
              ) : null}
              <label className="grid gap-1.5 text-sm font-medium">
                <span>
                  Necesidad activa de destino
                  <span className="sr-only"> para {contributionLabel}</span>
                </span>
                <select
                  name="targetNeedId"
                  required
                  defaultValue=""
                  disabled={reassignPending}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Selecciona una necesidad
                  </option>
                  {reassignmentTargets.map((need) => (
                    <option key={need.id} value={need.id}>
                      {need.title} · {need.safePointName} · quedan{" "}
                      {need.remaining} {need.unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Motivo de reasignación
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  disabled={reassignPending}
                  className="min-h-24 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
                />
              </label>
              <label className="flex min-h-11 items-start gap-3 rounded-md bg-[color:var(--surface-muted)] p-3 text-sm leading-5">
                <input
                  name="confirmReassignment"
                  type="checkbox"
                  required
                  disabled={reassignPending}
                  className="mt-0.5 size-5 shrink-0 accent-[color:var(--foreground)]"
                />
                He comprobado el punto de entrega, la fecha límite cuando existe
                y la capacidad restante del destino.
              </label>
              <button
                type="submit"
                disabled={reassignPending}
                className="min-h-11 rounded-md border border-[color:var(--border)] px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              >
                {reassignPending ? "Reasignando…" : "Confirmar reasignación"}
              </button>
            </form>
          ) : null}
          {!loadingTargets && reassignmentTargets?.length === 0 ? (
            <p
              className={`border-t border-[color:var(--border)] p-3 text-sm ${
                reassignmentMessage && !reassignmentTargets.length
                  ? "text-black/65 dark:text-white/65"
                  : ""
              }`}
              role="status"
            >
              {reassignmentMessage}
            </p>
          ) : null}
          {reassignState.message ? (
            <p
              role={reassignState.ok ? "status" : "alert"}
              className={`px-3 pb-3 text-xs font-semibold ${
                reassignState.ok
                  ? "text-[color:var(--success)]"
                  : "text-[color:var(--danger)]"
              }`}
            >
              {reassignState.message}
            </p>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}
