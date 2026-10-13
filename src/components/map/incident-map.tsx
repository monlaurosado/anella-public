"use client";

import { Fragment, useEffect, useRef } from "react";
import L from "leaflet";
import {
  Circle,
  MapContainer,
  Marker,
  Pane,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import Link from "next/link";

import type { Incident } from "@/types/domain";
import { Badge } from "@/components/ui/badge";
import {
  extendFireDetectionBounds,
  EffisBurnedAreaLayer,
  fireDetectionPoint,
  FireDetectionLayers,
  TrackpadPinchZoom,
} from "@/components/map/fire-detection-map";
import type { FireDetectionMapFeature } from "@/types/domain";

const incidentIcon = L.divIcon({
  className: "",
  html: '<div class="incident-marker" aria-hidden="true"><span>E</span></div>',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

const safePointIcon = L.divIcon({
  className: "",
  html: '<div class="safe-marker" aria-hidden="true"><span>P</span></div>',
  iconSize: [44, 48],
  iconAnchor: [22, 44],
});

const SPAIN_BOUNDS = L.latLngBounds([
  [27.5, -18.5],
  [44.5, 4.5],
]);

// Leaflet's marker and popup panes use 600 and 700 respectively. Confirmed
// emergencies and official drop-off points must remain operable when a thermal
// signal lands on the same pixels; signals stay visible and clickable wherever
// they do not overlap those higher-trust destinations.
const PUBLIC_FIRE_SIGNALS_PANE_Z_INDEX = 590;

type MapFocusRequest = { featureId: string; sequence: number } | null;
type MapViewRequest = {
  mode: "spain" | "signals";
  sequence: number;
} | null;

function PublicMapNavigation({
  incidents,
  detections,
  focusRequest,
  viewRequest,
}: {
  incidents: Incident[];
  detections: FireDetectionMapFeature[];
  focusRequest: MapFocusRequest;
  viewRequest: MapViewRequest;
}) {
  const map = useMap();
  const initialized = useRef(false);
  const handledFocus = useRef(0);
  const handledView = useRef(0);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    map.fitBounds(SPAIN_BOUNDS, {
      padding: [16, 16],
      maxZoom: 5,
      animate: false,
    });
  }, [map]);

  useEffect(() => {
    if (!viewRequest || handledView.current === viewRequest.sequence) return;
    handledView.current = viewRequest.sequence;
    if (viewRequest.mode === "spain") {
      map.fitBounds(SPAIN_BOUNDS, {
        padding: [16, 16],
        maxZoom: 5,
        animate: false,
      });
      return;
    }

    const bounds = L.latLngBounds([]);
    for (const incident of incidents) {
      const coordinates = incident.publicArea.coordinates;
      if (coordinates) {
        const center = L.latLng(coordinates.lat, coordinates.lng);
        const radius = incident.publicArea.radiusMeters;
        if (radius) bounds.extend(center.toBounds(radius * 2));
        else bounds.extend(center);
      }
      for (const point of incident.safePoints) {
        bounds.extend([point.coordinates.lat, point.coordinates.lng]);
      }
    }
    extendFireDetectionBounds(bounds, detections);

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [36, 36],
        maxZoom: 7,
        animate: false,
      });
    }
  }, [detections, incidents, map, viewRequest]);

  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest.sequence) return;
    handledFocus.current = focusRequest.sequence;
    const feature = detections.find(
      (candidate) => candidate.id === focusRequest.featureId,
    );
    if (!feature) return;
    const center = fireDetectionPoint(feature);
    if (map.getZoom() < 7) {
      map.setView(center, 7, { animate: false });
    } else {
      map.panTo(center, { animate: false });
    }
  }, [detections, focusRequest, map]);

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function PopupAccessibility() {
  const map = useMap();

  useEffect(() => {
    const markerPane = map.getPane("markerPane");
    const overlayPane = map.getPane("overlayPane");
    const fireSignalsPane = map.getPane("public-fire-signals");
    let returnFocus: HTMLElement | SVGElement | null = null;

    const restoreMarkers = () => {
      markerPane?.removeAttribute("inert");
      markerPane?.removeAttribute("aria-hidden");
      overlayPane?.removeAttribute("inert");
      overlayPane?.removeAttribute("aria-hidden");
      fireSignalsPane?.removeAttribute("inert");
      fireSignalsPane?.removeAttribute("aria-hidden");
    };

    const handleOpen = (event: L.PopupEvent) => {
      const activeElement = document.activeElement;
      returnFocus =
        activeElement instanceof HTMLElement ||
        activeElement instanceof SVGElement
          ? activeElement
          : null;
      markerPane?.setAttribute("inert", "");
      markerPane?.setAttribute("aria-hidden", "true");
      overlayPane?.setAttribute("inert", "");
      overlayPane?.setAttribute("aria-hidden", "true");
      fireSignalsPane?.setAttribute("inert", "");
      fireSignalsPane?.setAttribute("aria-hidden", "true");

      const popup = event.popup.getElement();
      popup?.setAttribute("role", "dialog");
      popup?.setAttribute("aria-label", "Información del mapa");
      const closeButton = popup?.querySelector<HTMLElement>(
        ".leaflet-popup-close-button",
      );
      closeButton?.setAttribute("aria-label", "Cerrar información del mapa");
      window.requestAnimationFrame(() => closeButton?.focus());
    };

    const handleClose = () => {
      restoreMarkers();
      const focusTarget = returnFocus;
      returnFocus = null;
      if (focusTarget?.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    };

    map.on("popupopen", handleOpen);
    map.on("popupclose", handleClose);

    return () => {
      map.off("popupopen", handleOpen);
      map.off("popupclose", handleClose);
      restoreMarkers();
    };
  }, [map]);

  return null;
}

export function IncidentMap({
  incidents,
  detections,
  focusRequest,
  viewRequest,
  showBurnedAreas,
}: {
  incidents: Incident[];
  detections: FireDetectionMapFeature[];
  focusRequest: MapFocusRequest;
  viewRequest: MapViewRequest;
  showBurnedAreas: boolean;
}) {
  return (
    <div className="relative h-[58vh] min-h-[430px] md:h-[68vh] md:min-h-[560px] lg:h-[calc(100vh-220px)] lg:min-h-[620px] lg:max-h-[820px]">
      <MapContainer
        center={[40.2, -3.7]}
        zoom={5}
        minZoom={3}
        maxZoom={14}
        zoomDelta={0.5}
        zoomSnap={0.25}
        touchZoom="center"
        bounceAtZoomLimits={false}
        preferCanvas={detections.length > 250}
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
        doubleClickZoom={false}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TrackpadPinchZoom />
        <PublicMapNavigation
          incidents={incidents}
          detections={detections}
          focusRequest={focusRequest}
          viewRequest={viewRequest}
        />
        <PopupAccessibility />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <EffisBurnedAreaLayer visible={showBurnedAreas} />
        <Pane
          name="public-fire-signals"
          style={{ zIndex: PUBLIC_FIRE_SIGNALS_PANE_Z_INDEX }}
        >
          <FireDetectionLayers features={detections} audience="public" />
        </Pane>
        {incidents.map((incident) => (
          <Fragment key={incident.id}>
            {incident.publicArea.coordinates ? (
              <>
                {incident.publicArea.radiusMeters ? (
                  <Circle
                    center={[
                      incident.publicArea.coordinates.lat,
                      incident.publicArea.coordinates.lng,
                    ]}
                    radius={incident.publicArea.radiusMeters}
                    interactive={false}
                    pathOptions={{
                      color: "#b42318",
                      fillColor: "#b42318",
                      fillOpacity: 0.08,
                      weight: 2,
                    }}
                  />
                ) : null}
                <Marker
                  position={[
                    incident.publicArea.coordinates.lat,
                    incident.publicArea.coordinates.lng,
                  ]}
                  icon={incidentIcon}
                  zIndexOffset={1_000}
                  title={`Emergencia confirmada: ${incident.title}`}
                  alt={`Emergencia confirmada ${incident.title}`}
                >
                  <Popup
                    pane="popupPane"
                    maxWidth={240}
                    keepInView
                    autoPanPaddingTopLeft={[24, 88]}
                    autoPanPaddingBottomRight={[24, 24]}
                  >
                    <div className="min-w-56 space-y-2">
                      <Badge tone="danger">Emergencia confirmada</Badge>
                      <p className="text-sm font-semibold">{incident.title}</p>
                      <p className="text-xs leading-5 text-black/65">
                        {incident.publicArea.label}. {incident.publicSummary}
                      </p>
                      <Link
                        href={`/incidentes/${incident.id}`}
                        className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold text-red-700"
                      >
                        Ver emergencia
                      </Link>
                    </div>
                  </Popup>
                </Marker>
              </>
            ) : null}
            {incident.safePoints.map((point) => {
              return (
                <Fragment key={point.id}>
                  <Circle
                    center={[point.coordinates.lat, point.coordinates.lng]}
                    radius={point.radiusMeters}
                    interactive={false}
                    pathOptions={{
                      color: "#13795b",
                      fillColor: "#13795b",
                      fillOpacity: 0.14,
                      weight: 2,
                    }}
                  />
                  <Marker
                    position={[point.coordinates.lat, point.coordinates.lng]}
                    icon={safePointIcon}
                    zIndexOffset={1_200}
                    title={`Punto de entrega: ${point.name}`}
                    alt={`Punto de entrega ${point.name}`}
                  >
                    <Popup
                      pane="popupPane"
                      maxWidth={240}
                      keepInView
                      autoPanPaddingTopLeft={[24, 88]}
                      autoPanPaddingBottomRight={[24, 24]}
                    >
                      <div className="min-w-56 space-y-2">
                        <Badge tone="success">Punto de entrega oficial</Badge>
                        <p className="text-sm font-semibold">{point.name}</p>
                        <p className="text-xs leading-5 text-black/65">
                          {point.instructions}
                        </p>
                        <Link
                          href={`/incidentes/${incident.id}?punto=${encodeURIComponent(point.id)}#punto-${encodeURIComponent(point.id)}`}
                          className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold text-emerald-800"
                        >
                          Puedo llevar material
                        </Link>
                      </div>
                    </Popup>
                  </Marker>
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
