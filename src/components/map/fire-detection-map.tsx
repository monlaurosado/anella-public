"use client";

import { Fragment, useEffect, useRef } from "react";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Pane,
  Polygon,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  WMSTileLayer,
} from "react-leaflet";

import { Badge } from "@/components/ui/badge";
import {
  FIRE_PROVIDER_STATUS_LABELS,
  fireProviderLabel,
  type FireProviderStatus,
} from "@/lib/fire-provider-status";
import {
  boundedTrackpadZoomChange,
  trackpadScaleZoomChange,
  trackpadWheelZoomStep,
} from "@/lib/map-zoom";
import type { FireDetectionMapFeature } from "@/types/domain";

const EFFIS_WMS_URL = "/api/map/effis";
const EFFIS_YEAR = new Date().getFullYear();
const EFFIS_WMS_PARAMS = {
  layers: "modis.ba.poly",
  styles: "",
  format: "image/png",
  transparent: true,
  version: "1.1.1",
  TIME: `${EFFIS_YEAR}-01-01/${EFFIS_YEAR}-12-31`,
} as L.WMSParams & { TIME: string };

export const FIRE_SIGNAL_TYPE_LABELS = {
  FOREST: "Vegetación forestal",
  AGRICULTURAL: "Vegetación agrícola",
  URBAN: "Vegetación urbana",
  THERMAL: "Foco térmico satelital",
} as const;

export function fireDetectionPoint(
  feature: FireDetectionMapFeature,
): [number, number] {
  if (feature.geometry.type === "Point") {
    return [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
  }
  const ring = feature.geometry.coordinates[0];
  const points = ring.slice(0, -1);
  if (points.length === 0) return [39.5, -3.7];
  const total = points.reduce(
    (sum, [longitude, latitude]) => ({
      latitude: sum.latitude + latitude,
      longitude: sum.longitude + longitude,
    }),
    { latitude: 0, longitude: 0 },
  );
  return [total.latitude / points.length, total.longitude / points.length];
}

export function extendFireDetectionBounds(
  bounds: L.LatLngBounds,
  features: FireDetectionMapFeature[],
) {
  for (const feature of features) {
    if (feature.geometry.type === "Polygon") {
      for (const [longitude, latitude] of feature.geometry.coordinates[0]) {
        bounds.extend([latitude, longitude]);
      }
    } else {
      const center = L.latLng(
        feature.geometry.coordinates[1],
        feature.geometry.coordinates[0],
      );
      bounds.extend(
        center.toBounds(feature.properties.footprintRadiusMeters * 2),
      );
    }
  }
}

function FitDetectionBounds({
  features,
}: {
  features: FireDetectionMapFeature[];
}) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    const bounds = L.latLngBounds([]);
    extendFireDetectionBounds(bounds, features);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 9, animate: false });
    } else {
      map.fitBounds(
        [
          [27.5, -18.2],
          [44.3, 4.5],
        ],
        { padding: [20, 20], animate: false },
      );
    }
  }, [features, map]);
  return null;
}

type WebKitGestureEvent = Event & {
  clientX: number;
  clientY: number;
  scale: number;
};

/**
 * Los navegadores de escritorio convierten el pellizco del trackpad en una
 * rueda con Ctrl (Chromium/Firefox) o en eventos gesture (Safari). Leaflet no
 * lo interpreta cuando la rueda normal está desactivada, así que lo tratamos
 * de forma explícita y limitamos cada gesto a 1,5 niveles de zoom.
 */
export function TrackpadPinchZoom() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let animationFrame: number | null = null;
    let wheelBaseZoom = map.getZoom();
    let wheelChange = 0;
    let lastWheelAt = 0;
    let wheelAnchor = map.getCenter();
    let gestureBaseZoom = map.getZoom();
    let gestureAnchor = map.getCenter();

    const anchorAt = (clientX: number, clientY: number) => {
      const bounds = container.getBoundingClientRect();
      return map.containerPointToLatLng([
        clientX - bounds.left,
        clientY - bounds.top,
      ]);
    };

    const applyWheelZoom = () => {
      animationFrame = null;
      map.setZoomAround(
        wheelAnchor,
        Math.max(
          map.getMinZoom(),
          Math.min(map.getMaxZoom(), wheelBaseZoom + wheelChange),
        ),
        { animate: false },
      );
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();

      const now = performance.now();
      if (now - lastWheelAt > 220) {
        wheelBaseZoom = map.getZoom();
        wheelChange = 0;
      }
      lastWheelAt = now;
      wheelAnchor = anchorAt(event.clientX, event.clientY);

      const normalizedDelta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * container.clientHeight
            : event.deltaY;
      wheelChange = boundedTrackpadZoomChange(
        wheelChange + trackpadWheelZoomStep(normalizedDelta),
      );

      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(applyWheelZoom);
      }
    };

    const handleGestureStart = (rawEvent: Event) => {
      const event = rawEvent as WebKitGestureEvent;
      event.preventDefault();
      event.stopPropagation();
      gestureBaseZoom = map.getZoom();
      gestureAnchor = anchorAt(event.clientX, event.clientY);
    };

    const handleGestureChange = (rawEvent: Event) => {
      const event = rawEvent as WebKitGestureEvent;
      event.preventDefault();
      event.stopPropagation();
      const zoomChange = trackpadScaleZoomChange(event.scale);
      map.setZoomAround(
        gestureAnchor,
        Math.max(
          map.getMinZoom(),
          Math.min(map.getMaxZoom(), gestureBaseZoom + zoomChange),
        ),
        { animate: false },
      );
    };

    const stopGesture = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    container.addEventListener("gesturestart", handleGestureStart, {
      capture: true,
      passive: false,
    });
    container.addEventListener("gesturechange", handleGestureChange, {
      capture: true,
      passive: false,
    });
    container.addEventListener("gestureend", stopGesture, {
      capture: true,
      passive: false,
    });

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      container.removeEventListener("wheel", handleWheel, true);
      container.removeEventListener("gesturestart", handleGestureStart, true);
      container.removeEventListener("gesturechange", handleGestureChange, true);
      container.removeEventListener("gestureend", stopGesture, true);
    };
  }, [map]);

  return null;
}

export function EffisBurnedAreaLayer({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Pane name="effis-burned-areas" style={{ zIndex: 330 }}>
      <WMSTileLayer
        attribution="&copy; Copernicus EMS · EFFIS"
        keepBuffer={0}
        opacity={0.42}
        params={EFFIS_WMS_PARAMS}
        updateWhenIdle
        updateWhenZooming={false}
        url={EFFIS_WMS_URL}
      />
    </Pane>
  );
}

function DetectionPopup({
  feature,
  audience,
}: {
  feature: FireDetectionMapFeature;
  audience: "public" | "coordination";
}) {
  const properties = feature.properties;
  const official = properties.source === "CIVIL_PROTECTION";
  const providerTone = (
    status: FireProviderStatus,
  ): "neutral" | "info" | "warning" | "success" | "danger" => {
    if (status === "ACTIVE" || status === "DECLARED") return "danger";
    if (status === "STABILIZED") return "warning";
    if (status === "CONTROLLED") return "success";
    if (status === "EXTINGUISHED") return "neutral";
    return "info";
  };
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat("es-ES", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Madrid",
    }).format(new Date(value));
  return (
    <div className="min-w-56 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {audience === "public" ? (
          <Badge tone="info">
            {official ? "Aviso oficial" : "Detección satelital"}
          </Badge>
        ) : (
          <Badge tone={properties.status === "LINKED" ? "success" : "warning"}>
            {properties.status === "LINKED" ? "Vinculada" : "Pendiente"}
          </Badge>
        )}
        {properties.providerStatus ? (
          <Badge tone={providerTone(properties.providerStatus)}>
            {FIRE_PROVIDER_STATUS_LABELS[properties.providerStatus]}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm font-semibold">
        {fireProviderLabel(properties.provider, properties.source)}
      </p>
      <p className="text-xs leading-5 text-black/65">
        Aviso {dateTime(properties.detectedAt)}
        {properties.satellite ? ` · ${properties.satellite}` : ""}
      </p>
      {properties.sourceUpdatedAt &&
      properties.sourceUpdatedAt !== properties.detectedAt ? (
        <p className="text-xs leading-5 text-black/65">
          Actualizado {dateTime(properties.sourceUpdatedAt)}
        </p>
      ) : null}
      {properties.municipalityName ? (
        <p className="text-xs">
          {audience === "public" ? "Municipio" : "Asignada a"}:{" "}
          {properties.municipalityName}
        </p>
      ) : null}
      {properties.fireType ? (
        <p className="text-xs">
          {FIRE_SIGNAL_TYPE_LABELS[properties.fireType]}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-black/65">
        {official
          ? audience === "public"
            ? "La zona sombreada sitúa el aviso de forma aproximada; no es un perímetro afectado. No se muestran medios ni ubicaciones de intervención."
            : "Aviso oficial importado para seguimiento y revisión de coordinación."
          : audience === "public"
            ? "La huella delimita el píxel observado por satélite; es aproximada y no representa un perímetro confirmado."
            : "Huella satelital aproximada; no representa el perímetro del incendio."}
        {!official && properties.footprintAreaHectares
          ? ` Área de píxel: ${properties.footprintAreaHectares.toFixed(1)} ha.`
          : ""}
        {!official && properties.fireRadiativePowerMw
          ? ` FRP: ${properties.fireRadiativePowerMw.toFixed(1)} MW.`
          : ""}
      </p>
    </div>
  );
}

function DetectionTooltip({ feature }: { feature: FireDetectionMapFeature }) {
  const status = feature.properties.providerStatus
    ? FIRE_PROVIDER_STATUS_LABELS[feature.properties.providerStatus]
    : "Detección térmica";
  return (
    <Tooltip direction="top" offset={[0, -6]} opacity={0.96}>
      <span className="font-semibold">
        {feature.properties.municipalityName ??
          fireProviderLabel(
            feature.properties.provider,
            feature.properties.source,
          )}
      </span>
      <br />
      <span>{status}</span>
    </Tooltip>
  );
}

function detectionPathOptions(
  feature: FireDetectionMapFeature,
  audience: "public" | "coordination",
) {
  const status = feature.properties.providerStatus;
  const colors =
    status === "ACTIVE" || status === "DECLARED"
      ? { color: "#b42318", fillColor: "#f04438" }
      : status === "STABILIZED"
        ? { color: "#b54708", fillColor: "#f79009" }
        : status === "CONTROLLED"
          ? { color: "#067647", fillColor: "#12b76a" }
          : status === "EXTINGUISHED"
            ? { color: "#667085", fillColor: "#98a2b3" }
            : audience === "coordination" &&
                feature.properties.status === "LINKED"
              ? { color: "#067647", fillColor: "#12b76a" }
              : { color: "#b54708", fillColor: "#f79009" };
  return {
    ...colors,
    fillOpacity: 0.24,
    weight:
      audience === "coordination" && feature.properties.status === "LINKED"
        ? 3
        : 2,
  };
}

function DetectionPointMarker({
  feature,
  audience,
  center,
  markerClassName,
  markerOptions,
}: {
  feature: FireDetectionMapFeature;
  audience: "public" | "coordination";
  center: [number, number];
  markerClassName: string;
  markerOptions: L.PathOptions;
}) {
  const content = (
    <>
      <Popup
        pane="popupPane"
        maxWidth={240}
        keepInView
        autoPanPaddingTopLeft={[24, 88]}
        autoPanPaddingBottomRight={[24, 24]}
      >
        <DetectionPopup feature={feature} audience={audience} />
      </Popup>
      <DetectionTooltip feature={feature} />
    </>
  );

  return (
    <CircleMarker
      center={center}
      radius={7}
      className={markerClassName}
      pathOptions={markerOptions}
    >
      {content}
    </CircleMarker>
  );
}

export function FireDetectionLayers({
  features,
  audience = "coordination",
}: {
  features: FireDetectionMapFeature[];
  audience?: "public" | "coordination";
}) {
  return features.map((feature) => {
    const pathOptions = detectionPathOptions(feature, audience);
    const official = feature.properties.source === "CIVIL_PROTECTION";
    const areaOptions = {
      ...pathOptions,
      dashArray: official ? "6 5" : undefined,
      fillOpacity: official ? 0.1 : 0.24,
    };
    const center = fireDetectionPoint(feature);
    const markerClassName =
      audience === "public"
        ? "public-fire-detection-marker"
        : "coordination-fire-detection-marker";
    const markerOptions = {
      color: pathOptions.color,
      fillColor: pathOptions.fillColor,
      fillOpacity: 0.86,
      opacity: 1,
      weight: 2,
    };
    if (feature.geometry.type === "Polygon") {
      const positions = feature.geometry.coordinates[0].map(
        ([longitude, latitude]) => [latitude, longitude] as [number, number],
      );
      return (
        <Fragment key={feature.id}>
          <Polygon
            positions={positions}
            pathOptions={areaOptions}
            interactive={false}
          />
          <DetectionPointMarker
            feature={feature}
            audience={audience}
            center={center}
            markerClassName={markerClassName}
            markerOptions={markerOptions}
          />
        </Fragment>
      );
    }
    return (
      <Fragment key={feature.id}>
        <Circle
          center={center}
          radius={feature.properties.footprintRadiusMeters}
          pathOptions={areaOptions}
          interactive={false}
        />
        <DetectionPointMarker
          feature={feature}
          audience={audience}
          center={center}
          markerClassName={markerClassName}
          markerOptions={markerOptions}
        />
      </Fragment>
    );
  });
}

export function FireDetectionMap({
  features,
}: {
  features: FireDetectionMapFeature[];
}) {
  const center: [number, number] = features[0]
    ? fireDetectionPoint(features[0])
    : [39.5, -3.7];
  return (
    <div className="h-[420px]">
      <MapContainer
        center={center}
        zoom={5}
        minZoom={3}
        maxZoom={14}
        zoomDelta={0.5}
        zoomSnap={0.25}
        touchZoom="center"
        bounceAtZoomLimits={false}
        preferCanvas={features.length > 250}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TrackpadPinchZoom />
        <FitDetectionBounds features={features} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FireDetectionLayers features={features} />
      </MapContainer>
    </div>
  );
}
