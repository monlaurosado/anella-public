"use client";

import { useId, useState } from "react";

type PublicLocationModeValue =
  "MUNICIPALITY_ONLY" | "GENERALIZED_AREA" | "SAFE_POINTS_ONLY";

export function PublicLocationFields({
  initialMode,
  initialLabel,
  initialLatitude,
  initialLongitude,
  initialRadiusMeters,
  inputClass,
}: {
  initialMode: PublicLocationModeValue;
  initialLabel: string;
  initialLatitude?: number;
  initialLongitude?: number;
  initialRadiusMeters?: number;
  inputClass: string;
}) {
  const [mode, setMode] = useState<PublicLocationModeValue>(initialMode);
  const generalized = mode === "GENERALIZED_AREA";
  const idPrefix = useId();
  const helpId = `${idPrefix}-public-location-measures-help`;
  const latitudeId = `${idPrefix}-public-location-latitude`;
  const longitudeId = `${idPrefix}-public-location-longitude`;
  const radiusId = `${idPrefix}-public-location-radius`;
  const disabledClass = "disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Modo de ubicación pública
          <select
            name="mode"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as PublicLocationModeValue)
            }
            aria-controls={`${latitudeId} ${longitudeId} ${radiusId} ${helpId}`}
            aria-describedby={helpId}
            className={inputClass}
          >
            <option value="MUNICIPALITY_ONLY">Solo nombre del municipio</option>
            <option value="GENERALIZED_AREA">Área generalizada aprobada</option>
            <option value="SAFE_POINTS_ONLY">Solo puntos de entrega</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Etiqueta pública
          <input
            name="label"
            required
            defaultValue={initialLabel}
            className={inputClass}
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium">
          Latitud generalizada
          <input
            id={latitudeId}
            name="latitude"
            type="number"
            step="any"
            required={generalized}
            disabled={!generalized}
            aria-describedby={helpId}
            defaultValue={initialLatitude}
            className={`${inputClass} ${disabledClass}`}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Longitud generalizada
          <input
            id={longitudeId}
            name="longitude"
            type="number"
            step="any"
            required={generalized}
            disabled={!generalized}
            aria-describedby={helpId}
            defaultValue={initialLongitude}
            className={`${inputClass} ${disabledClass}`}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Radio público (mín. 1.500 m)
          <input
            id={radiusId}
            name="radiusMeters"
            type="number"
            min="1500"
            max="100000"
            required={generalized}
            disabled={!generalized}
            aria-describedby={helpId}
            defaultValue={initialRadiusMeters}
            className={`${inputClass} ${disabledClass}`}
          />
        </label>
      </div>
      <p
        id={helpId}
        className="text-xs leading-5 text-black/65 dark:text-white/65"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {generalized
          ? "Las tres medidas son obligatorias y deben representar solo una zona pública generalizada aprobada."
          : "Las medidas están desactivadas y se eliminan de la proyección pública en este modo."}
      </p>
    </>
  );
}
