"use client";

import L from "leaflet";
import { Crosshair, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";

import type { CoordinateRadiusPickerShellProps } from "@/components/coordination/coordinate-radius-picker-shell";
import { cn } from "@/lib/utils";
import type { Coordinates } from "@/types/domain";

function formatRadius(radiusMeters: number) {
  if (radiusMeters < 1_000) return `${radiusMeters} m`;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(radiusMeters / 1_000)} km`;
}

function MapSelection({
  onSelect,
}: {
  onSelect: (coordinates: Coordinates) => void;
}) {
  useMapEvents({
    click(event) {
      onSelect({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function KeepInitialView({
  center,
  zoom,
}: {
  center: Coordinates;
  zoom: number;
}) {
  const map = useMap();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    map.setView([center.lat, center.lng], zoom, { animate: false });
  }, [center.lat, center.lng, map, zoom]);

  return null;
}

export function CoordinateRadiusPicker({
  initialCenter,
  initiallySelected = false,
  initialRadiusMeters,
  minimumRadiusMeters,
  maximumRadiusMeters,
  radiusStepMeters,
  latitudeName = "latitude",
  longitudeName = "longitude",
  radiusName = "radiusMeters",
  tone,
  title,
  description,
  className,
  controlsBottomClassName,
}: CoordinateRadiusPickerShellProps) {
  const [coordinates, setCoordinates] = useState<Coordinates>(initialCenter);
  const [selected, setSelected] = useState(initiallySelected);
  const [radiusMeters, setRadiusMeters] = useState(initialRadiusMeters);
  const mapRef = useRef<L.Map | null>(null);
  const isSafePoint = tone === "safe";
  const color = isSafePoint ? "#13795b" : "#b42318";
  const initialZoom = isSafePoint || initiallySelected ? 13 : 6;
  const selectionZoom = isSafePoint ? 17 : 11;

  const selectCoordinates = useCallback(
    (next: Coordinates) => {
      setCoordinates(next);
      setSelected(true);
      const map = mapRef.current;
      if (map && map.getZoom() < selectionZoom) {
        map.setView([next.lat, next.lng], selectionZoom, { animate: false });
      }
    },
    [selectionZoom],
  );

  function changeRadius(next: number) {
    setRadiusMeters(
      Math.min(maximumRadiusMeters, Math.max(minimumRadiusMeters, next)),
    );
  }

  function useVisibleCenter() {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    selectCoordinates({ lat: center.lat, lng: center.lng });
  }

  return (
    <section
      className={cn(
        "relative min-h-80 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)]",
        className,
      )}
      aria-label={title}
      data-coordinate-radius-picker={tone}
    >
      <input
        type="hidden"
        name={latitudeName}
        value={selected ? coordinates.lat.toFixed(6) : ""}
      />
      <input
        type="hidden"
        name={longitudeName}
        value={selected ? coordinates.lng.toFixed(6) : ""}
      />
      <input type="hidden" name={radiusName} value={radiusMeters} />

      <MapContainer
        ref={mapRef}
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={initialZoom}
        minZoom={4}
        maxZoom={18}
        zoomControl={false}
        scrollWheelZoom
        touchZoom="center"
        bounceAtZoomLimits={false}
        className="h-full min-h-80 w-full"
      >
        <KeepInitialView center={initialCenter} zoom={initialZoom} />
        <MapSelection onSelect={selectCoordinates} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="topright" />
        {selected ? (
          <>
            <Circle
              center={[coordinates.lat, coordinates.lng]}
              radius={radiusMeters}
              interactive={false}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: isSafePoint ? 0.16 : 0.1,
                weight: 2,
                dashArray: isSafePoint ? undefined : "7 6",
              }}
            />
            <CircleMarker
              center={[coordinates.lat, coordinates.lng]}
              radius={9}
              interactive={false}
              pathOptions={{
                color: "#ffffff",
                fillColor: color,
                fillOpacity: 1,
                weight: 3,
              }}
            />
          </>
        ) : null}
      </MapContainer>

      <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-[min(22rem,calc(100%-5rem))] rounded-lg border border-black/10 bg-white/95 p-3 text-[#171713] shadow-lg backdrop-blur sm:left-4 sm:top-4 sm:p-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-black/65">{description}</p>
        <p
          className={cn(
            "mt-2 text-xs font-semibold",
            selected ? "text-emerald-800" : "text-amber-800",
          )}
          role="status"
        >
          {selected ? "Punto seleccionado" : "Haz clic para seleccionar"}
        </p>
      </div>

      <button
        type="button"
        aria-label="Usar centro"
        onClick={useVisibleCenter}
        className="absolute right-3 top-[7.25rem] z-[500] inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-3 text-xs font-semibold text-[#171713] shadow-md sm:right-4"
      >
        <Crosshair size={16} aria-hidden />
        <span className="hidden sm:inline">Usar centro</span>
      </button>

      <div
        className={cn(
          "absolute bottom-7 left-1/2 z-[500] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-black/10 bg-white/96 p-2.5 text-[#171713] shadow-xl backdrop-blur sm:p-3",
          controlsBottomClassName,
        )}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label={`Reducir alcance de ${title.toLowerCase()}`}
            onClick={() => changeRadius(radiusMeters - radiusStepMeters)}
            disabled={radiusMeters <= minimumRadiusMeters}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-black/15 disabled:opacity-35"
          >
            <Minus size={17} aria-hidden />
          </button>
          <label className="min-w-0 flex-1 text-center text-xs font-medium">
            <span className="block font-semibold">
              Alcance · {formatRadius(radiusMeters)}
            </span>
            <input
              type="range"
              aria-label={`Alcance de ${title.toLowerCase()}`}
              min={minimumRadiusMeters}
              max={maximumRadiusMeters}
              step={radiusStepMeters}
              value={radiusMeters}
              onChange={(event) => changeRadius(Number(event.target.value))}
              className="mt-1 min-h-11 w-full accent-[color:var(--foreground)]"
            />
          </label>
          <button
            type="button"
            aria-label={`Ampliar alcance de ${title.toLowerCase()}`}
            onClick={() => changeRadius(radiusMeters + radiusStepMeters)}
            disabled={radiusMeters >= maximumRadiusMeters}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-black/15 disabled:opacity-35"
          >
            <Plus size={17} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
