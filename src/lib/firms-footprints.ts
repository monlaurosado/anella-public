import { unzipSync } from "fflate";
import { z } from "zod";

export const FIRMS_KMZ_LIMITS = Object.freeze({
  maxCompressedBytes: 8 * 1024 * 1024,
  maxKmlBytes: 32 * 1024 * 1024,
  maxDetections: 10_000,
});

export class FirmsKmzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirmsKmzError";
  }
}

export type FirmsBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type FirmsFootprintDetection = {
  latitude: number;
  longitude: number;
  detectedAt: Date;
  satellite: string;
  instrument: string;
  confidence: string;
  dayNight: string;
  scanKm: number;
  trackKm: number;
  fireRadiativePowerMw: number;
  brightness: number;
  footprint: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
  footprintAreaHectares: number;
  footprintRadiusMeters: number;
};

const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // The bounded error is more useful than a secondary transport error.
  }
}

export async function readFirmsKmzResponse(
  response: Pick<Response, "body" | "headers">,
  maximum = FIRMS_KMZ_LIMITS.maxCompressedBytes,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isSafeInteger(declaredLength) && declaredLength > maximum) {
    try {
      await response.body?.cancel();
    } catch {
      // The response has already exceeded the accepted contract.
    }
    throw new FirmsKmzError("NASA FIRMS ha devuelto un KMZ demasiado grande.");
  }
  if (!response.body) {
    throw new FirmsKmzError("NASA FIRMS ha devuelto un cuerpo vacío.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximum) {
        await cancelReader(reader);
        throw new FirmsKmzError(
          "NASA FIRMS ha devuelto un KMZ demasiado grande.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const payload = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return payload;
}

function extractKml(kmz: Uint8Array) {
  let oversized = false;
  let kmlEntries = 0;
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(kmz, {
      filter(file) {
        if (!file.name.toLowerCase().endsWith(".kml")) return false;
        kmlEntries += 1;
        if (kmlEntries > 1) return false;
        if (file.originalSize > FIRMS_KMZ_LIMITS.maxKmlBytes) {
          oversized = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new FirmsKmzError("NASA FIRMS ha devuelto un archivo KMZ no válido.");
  }
  if (oversized) {
    throw new FirmsKmzError("El KML de NASA FIRMS supera el límite seguro.");
  }
  if (kmlEntries !== 1) {
    throw new FirmsKmzError("El KMZ de NASA FIRMS no contiene un único KML.");
  }

  const entries = Object.entries(files).filter(([name]) =>
    name.toLowerCase().endsWith(".kml"),
  );
  if (entries.length !== 1 || !entries[0]) {
    throw new FirmsKmzError("El KMZ de NASA FIRMS no contiene un único KML.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(entries[0][1]);
  } catch {
    throw new FirmsKmzError("El KML de NASA FIRMS no usa UTF-8 válido.");
  }
}

function field(description: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = description.match(
    new RegExp(
      `<b>\\s*${escaped}(?:\\s*\\[[^<\\]\\r\\n]{1,80}\\])?:\\s*</b>\\s*([^<\\r\\n]+)(?:<br\\s*/?>|\\s*$)`,
      "i",
    ),
  );
  return match?.[1]?.trim() ?? null;
}

function numberField(description: string, label: string, suffix: string) {
  const value = field(description, label);
  if (!value) return null;
  const normalized = value.replace(new RegExp(`\\s*${suffix}\\s*$`, "i"), "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDetectionTime(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})\s+UTC$/i);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseRing(placemark: string) {
  const match = placemark.match(
    /<Polygon>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Polygon>/i,
  );
  if (!match?.[1]) return null;
  const coordinates = match[1]
    .trim()
    .split(/\s+/)
    .map((token) => token.split(",").slice(0, 2).map(Number))
    .map((pair) => coordinateSchema.safeParse(pair))
    .filter((result) => result.success)
    .map((result) => result.data);

  if (coordinates.length < 4 || coordinates.length > 64) return null;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    return null;
  }
  return coordinates;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadius = 6_371_008.8;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function polygonAreaHectares(
  ring: [number, number][],
  center: { latitude: number; longitude: number },
) {
  const earthRadius = 6_371_008.8;
  const cosine = Math.cos(toRadians(center.latitude));
  const projected = ring.map(([longitude, latitude]) => [
    toRadians(longitude - center.longitude) * earthRadius * cosine,
    toRadians(latitude - center.latitude) * earthRadius,
  ]);
  let twiceArea = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const current = projected[index];
    const next = projected[index + 1];
    if (!current || !next) continue;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2 / 10_000;
}

function parseFootprintPlacemark(placemark: string) {
  if (!/<name>\s*Fire Detection Footprint\s*<\/name>/i.test(placemark)) {
    return null;
  }
  const description = placemark.match(
    /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/i,
  )?.[1];
  const ring = parseRing(placemark);
  if (!description || !ring) return null;

  const latitude = numberField(description, "Latitude", "");
  const longitude = numberField(description, "Longitude", "");
  const detectedAt = parseDetectionTime(field(description, "Detection Time"));
  const sensor = field(description, "Sensor");
  const confidence = field(description, "Confidence");
  const dayNight = field(description, "Day/Night");
  const scanKm = numberField(description, "Scan", "km");
  const trackKm = numberField(description, "Track", "km");
  const fireRadiativePowerMw = numberField(description, "FRP", "MW");
  const brightness = numberField(description, "Brightness", "K");

  const core = z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      detectedAt: z.date(),
      sensor: z.string().trim().min(2).max(100),
      confidence: z.string().trim().min(1).max(50),
      dayNight: z.string().trim().min(1).max(20),
      scanKm: z.number().positive().max(20),
      trackKm: z.number().positive().max(20),
      fireRadiativePowerMw: z.number().nonnegative().max(1_000_000),
      brightness: z.number().positive().max(10_000),
    })
    .safeParse({
      latitude,
      longitude,
      detectedAt,
      sensor,
      confidence,
      dayNight,
      scanKm,
      trackKm,
      fireRadiativePowerMw,
      brightness,
    });
  if (!core.success) return null;

  const center = {
    latitude: core.data.latitude,
    longitude: core.data.longitude,
  };
  return {
    latitude: core.data.latitude,
    longitude: core.data.longitude,
    detectedAt: core.data.detectedAt,
    satellite: core.data.sensor.replace(/\s+(?:VIIRS|MODIS)$/i, "").trim(),
    instrument: /VIIRS/i.test(core.data.sensor)
      ? "VIIRS"
      : /MODIS/i.test(core.data.sensor)
        ? "MODIS"
        : core.data.sensor,
    confidence: core.data.confidence,
    dayNight: core.data.dayNight,
    scanKm: core.data.scanKm,
    trackKm: core.data.trackKm,
    fireRadiativePowerMw: core.data.fireRadiativePowerMw,
    brightness: core.data.brightness,
    footprint: { type: "Polygon" as const, coordinates: [ring] },
    footprintAreaHectares: polygonAreaHectares(ring, center),
    footprintRadiusMeters: Math.max(
      ...ring.map(([longitudeValue, latitudeValue]) =>
        distanceMeters(center, {
          latitude: latitudeValue,
          longitude: longitudeValue,
        }),
      ),
    ),
  } satisfies FirmsFootprintDetection;
}

export function parseFirmsFootprintsKmz(kmz: Uint8Array) {
  const kml = extractKml(kmz);
  const detections: FirmsFootprintDetection[] = [];
  let footprintPlacements = 0;
  for (const match of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/gi)) {
    const placemark = match[1];
    if (
      !placemark ||
      !/<name>\s*Fire Detection Footprint\s*<\/name>/i.test(placemark)
    ) {
      continue;
    }
    footprintPlacements += 1;
    if (footprintPlacements > FIRMS_KMZ_LIMITS.maxDetections) {
      throw new FirmsKmzError(
        "NASA FIRMS ha superado el límite de detecciones.",
      );
    }
    const detection = parseFootprintPlacemark(placemark);
    if (detection) detections.push(detection);
  }
  if (footprintPlacements > 0 && detections.length === 0) {
    throw new FirmsKmzError(
      "NASA FIRMS ha cambiado el formato de sus footprints.",
    );
  }
  return { detections, rejected: footprintPlacements - detections.length };
}

export function detectionWithinBounds(
  detection: Pick<FirmsFootprintDetection, "latitude" | "longitude">,
  bounds: FirmsBounds,
) {
  return (
    detection.longitude >= bounds.west &&
    detection.longitude <= bounds.east &&
    detection.latitude >= bounds.south &&
    detection.latitude <= bounds.north
  );
}

export function geographicDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  return distanceMeters(from, to);
}
