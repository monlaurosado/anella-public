import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { DetectionSource } from "@/generated/prisma/enums";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import type { FireProviderStatus } from "@/lib/fire-provider-status";
import { extractPdfText, readBoundedPdfResponse } from "@/lib/pdf-text";
import { zonedDateTimeLocalToUtc } from "@/lib/time-zone";

const JCYL_API =
  "https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/incendios-forestales/records";
const JCYL_SOURCE_URL =
  "https://analisis.datosabiertos.jcyl.es/explore/dataset/incendios-forestales/";
const INFOCA_LAYER =
  "https://utility.arcgis.com/usrsvcs/servers/d6d1c0079ddd4c7f8876d58e13fcf1ac/rest/services/INFOCA/AN_INCIDENTES_PRO/FeatureServer/2/query";
const INFOCA_SOURCE_URL =
  "https://www.juntadeandalucia.es/organismos/ema/areas/incendios-forestales/situacion/incendios-activos.html";
const BOMBERS_CATALUNYA_LAYER =
  "https://services7.arcgis.com/ZCqVt1fRXwwK6GF4/arcgis/rest/services/ACTUACIONS_URGENTS_online_PRO_AMB_FASE_VIEW/FeatureServer/0/query";
const BOMBERS_CATALUNYA_SOURCE_URL =
  "https://interior.gencat.cat/ca/arees_dactuacio/bombers/actuacions-de-bombers/";
const MITECO_CCINIF_REPORT =
  "https://www.miteco.gob.es/content/dam/miteco/es/biodiversidad/temas/incendios-forestales/ActuacionesMITECO-provisional.pdf";
const MITECO_CCINIF_SOURCE_URL =
  "https://www.miteco.gob.es/es/biodiversidad/temas/incendios-forestales/estadisticas-actuaciones.html";
const MAX_JCYL_RECORDS = 500;
const JCYL_PAGE_SIZE = 100;
const MAX_INFOCA_RECORDS = 1_000;
const MAX_BOMBERS_CATALUNYA_RECORDS = 2_000;

export type OfficialFireSourceId =
  "BOMBERS_CATALUNYA" | "JCYL" | "INFOCA" | "MITECO_CCINIF";

export type OfficialFireMunicipality = {
  id: string;
  name: string;
  province: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
};

export type NormalizedFireSignal = {
  source: DetectionSource;
  provider: string;
  externalId: string;
  sourceUrl: string;
  latitude: number;
  longitude: number;
  detectedAt: Date;
  brightness?: number;
  confidence?: string;
  satellite?: string;
  instrument?: string;
  fireRadiativePowerMw?: number;
  footprintAreaHectares?: number;
  footprint?: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
  providerStatus?: FireProviderStatus;
  rawJson: Record<string, unknown>;
  mutable: boolean;
  municipalityIdHint?: string;
};

export type FireSourceResult = {
  sourceKey: string;
  label: string;
  source: DetectionSource;
  ok: boolean;
  received: number;
  rejected: number;
  detections: NormalizedFireSignal[];
  durationMs: number;
  error?: string;
};

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockSchema = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/);
const coordinatesSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

const jcylRecordSchema = z.object({
  fecha_del_parte: isoDateSchema,
  hora_del_parte: clockSchema,
  provincia: z.array(z.string().trim().min(1).max(100)).min(1).max(3),
  termino_municipal: z.string().trim().min(1).max(191),
  nivel: z.string().trim().max(20).nullable().optional(),
  nivel_maximo_alcanzado: z.string().trim().max(20).nullable().optional(),
  fecha_de_inicio: isoDateSchema,
  hora_de_inicio: clockSchema,
  situacion_actual: z.string().trim().min(1).max(50),
  fecha_extinguido: isoDateSchema.nullable().optional(),
  hora_extinguido: clockSchema.nullable().optional(),
  codigo_municipio_ine: z.string().trim().max(10).nullable().optional(),
  posicion: coordinatesSchema,
});

const jcylLatestSchema = z.object({
  results: z
    .array(
      z.object({
        latest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
      }),
    )
    .max(1),
});

const jcylPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  results: z.array(z.unknown()).max(JCYL_PAGE_SIZE),
});

const infocaFeatureSchema = z.object({
  attributes: z.object({
    OID_ENTERO: z.number().int().nonnegative(),
    ESRI_OID: z.number().finite().nullable().optional(),
    TERMINO_MUNICIPAL: z.string().trim().min(1).max(191),
    PROVINCIA: z.string().trim().min(1).max(100),
    TIPO_INCIDENTE: z.string().trim().min(1).max(100),
    ESTADO: z.string().trim().min(1).max(50),
    FECHA: z.number().int().nonnegative(),
    HORA: clockSchema,
  }),
  geometry: z.object({
    x: z.number().min(-180).max(180),
    y: z.number().min(-90).max(90),
  }),
});

const infocaPayloadSchema = z.object({
  features: z.array(z.unknown()).max(MAX_INFOCA_RECORDS),
  exceededTransferLimit: z.boolean().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const bombersCatalunyaFeatureSchema = z.object({
  attributes: z.object({
    ACT_DAT_ACTUACIO: z.number().int().nonnegative().nullable().optional(),
    TAL_COD_ALARMA2: z.string().trim().min(1).max(4),
    TAL_DESC_ALARMA2: z.string().trim().min(1).max(100),
    ACT_DAT_INICI: z.number().int().nonnegative().nullable().optional(),
    MUNICIPI_DPX: z.string().trim().min(1).max(191),
    DATA_ACT: z.number().int().nonnegative().nullable().optional(),
    GlobalID: z.string().trim().min(32).max(64),
    COM_FASE: z.string().trim().max(256).nullable().optional(),
  }),
  geometry: z.object({
    x: z.number().min(-180).max(180),
    y: z.number().min(-90).max(90),
  }),
});

const bombersCatalunyaPayloadSchema = z.object({
  features: z.array(z.unknown()).max(MAX_BOMBERS_CATALUNYA_RECORDS),
  exceededTransferLimit: z.boolean().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const MITECO_PROVINCE_HEADINGS = new Set(
  [
    "A Coruña",
    "La Coruña",
    "Álava",
    "Araba",
    "Albacete",
    "Alicante",
    "Alacant",
    "Almería",
    "Asturias",
    "Ávila",
    "Badajoz",
    "Baleares",
    "Illes Balears",
    "Barcelona",
    "Bizkaia",
    "Vizcaya",
    "Burgos",
    "Cáceres",
    "Cádiz",
    "Cantabria",
    "Castellón",
    "Castelló",
    "Ceuta",
    "Ciudad Real",
    "Córdoba",
    "Cuenca",
    "Gipuzkoa",
    "Guipúzcoa",
    "Girona",
    "Gerona",
    "Granada",
    "Guadalajara",
    "Huelva",
    "Huesca",
    "Jaén",
    "La Rioja",
    "Las Palmas",
    "León",
    "Lleida",
    "Lérida",
    "Lugo",
    "Madrid",
    "Málaga",
    "Melilla",
    "Murcia",
    "Navarra",
    "Ourense",
    "Orense",
    "Palencia",
    "Pontevedra",
    "Salamanca",
    "Santa Cruz de Tenerife",
    "Segovia",
    "Sevilla",
    "Soria",
    "Tarragona",
    "Teruel",
    "Toledo",
    "Valencia",
    "València",
    "Valladolid",
    "Zamora",
    "Zaragoza",
  ].flatMap((province) => provinceNameVariants(province)),
);

const PROVINCE_EQUIVALENTS: Record<string, string> = {
  ALACANT: "ALICANTE",
  ALAVA: "ALAVA",
  ARABA: "ALAVA",
  BALEARS: "BALEARES",
  BIZKAIA: "VIZCAYA",
  CASTELLO: "CASTELLON",
  GERONA: "GIRONA",
  GUIPUZCOA: "GIPUZKOA",
  LERIDA: "LLEIDA",
  ORENSE: "OURENSE",
  VIZCAYA: "VIZCAYA",
};

type MitecoReportRecord = {
  location: string;
  province: string | null;
  officialStatus: string | null;
};

export type ParsedMitecoReport = {
  reportDate: string;
  sourceUpdatedAt: Date;
  records: MitecoReportRecord[];
};

function normalizedGeographicName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function provinceNameVariants(value: string) {
  const normalized = normalizedGeographicName(value);
  const variants = new Set([normalized, ...normalized.split("/")]);
  for (const variant of [...variants]) {
    variants.add(variant.replace(/^(?:A|EL|LA|LAS|LOS|ILLES)\s+/, ""));
  }
  return [...variants].filter(Boolean);
}

function equivalentProvince(value: string) {
  return PROVINCE_EQUIVALENTS[value] ?? value;
}

function provinceMatches(reportProvince: string, catalogProvince: string) {
  const report = new Set(
    provinceNameVariants(reportProvince).map(equivalentProvince),
  );
  return provinceNameVariants(catalogProvince)
    .map(equivalentProvince)
    .some((variant) => report.has(variant));
}

function statusFromMitecoLines(lines: string[], start: number) {
  for (
    let offset = 0;
    offset < 5 && start + offset < lines.length;
    offset += 1
  ) {
    const candidate = lines[start + offset] ?? "";
    if (offset > 0 && /^Localizaci[oó]n:\s*/i.test(candidate)) break;
    const [, statusTail] = candidate.split(/Estado del Incendio:\s*/i, 2);
    if (!statusTail) continue;
    const status = statusTail
      .split(/\s+(?:S\.?\s*O\.?\s*:|Medios?\b|Nota:|Localizaci[oó]n:)/i, 1)[0]
      ?.trim();
    if (status && status.length <= 50 && /^[\p{L}\s-]+$/u.test(status)) {
      return status;
    }
  }
  return null;
}

export function parseMitecoReportText(text: string): ParsedMitecoReport {
  const updated = text.match(
    /[UÚ]ltima\s+actualizaci[oó]n:\s*(\d{2}:\d{2}(?::\d{2})?)\s+del\s+d[ií]a\s+(\d{2})\/(\d{2})\/(\d{4})/i,
  );
  if (!updated?.[1] || !updated[2] || !updated[3] || !updated[4]) {
    throw new Error("MITECO_REPORT_DATE_MISSING");
  }
  const reportDate = `${updated[4]}-${updated[3]}-${updated[2]}`;
  const sourceUpdatedAt = dateTimeInSpain(reportDate, updated[1]);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const records: MitecoReportRecord[] = [];
  let province: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = normalizedGeographicName(line);
    if (MITECO_PROVINCE_HEADINGS.has(heading)) province = line;
    if (!/^Localizaci[oó]n:\s*/i.test(line)) continue;
    const location = line
      .replace(/^Localizaci[oó]n:\s*/i, "")
      .split(/\s+(?:S\.?\s*O\.?\s*:|Estado del Incendio:)/i, 1)[0]
      ?.trim();
    records.push({
      location: location?.slice(0, 191) ?? "",
      province,
      officialStatus: statusFromMitecoLines(lines, index),
    });
  }

  return { reportDate, sourceUpdatedAt, records };
}

function resolveMitecoMunicipality(
  record: MitecoReportRecord,
  municipalities: OfficialFireMunicipality[],
) {
  if (!record.location) return null;
  const normalizedLocation = normalizedGeographicName(record.location);
  const candidates = municipalities.filter(
    (municipality) =>
      normalizedGeographicName(municipality.name) === normalizedLocation &&
      (!record.province ||
        !municipality.province ||
        provinceMatches(record.province, municipality.province)),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function digestId(provider: string, parts: Array<string | number | null>) {
  return `auto:${provider.toLowerCase()}:${createHash("sha256")
    .update(parts.join(":"))
    .digest("hex")}`;
}

function normalizeProviderStatus(value: string): FireProviderStatus {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (normalized.includes("EXTINGUID") || normalized.includes("EXTINGIT")) {
    return "EXTINGUISHED";
  }
  if (normalized.includes("CONTROLAD") || normalized.includes("CONTROLAT")) {
    return "CONTROLLED";
  }
  if (normalized.includes("ESTABILIZ") || normalized.includes("ESTABILITZ")) {
    return "STABILIZED";
  }
  if (normalized.includes("ACTIV") || normalized.includes("ACTIU")) {
    return "ACTIVE";
  }
  if (normalized.includes("DECLAR")) return "DECLARED";
  return "UNKNOWN";
}

function dateTimeInSpain(date: string, clock: string) {
  const match = /^(\d{2}):(\d{2})/.exec(clock);
  if (!match) throw new Error("INVALID_OFFICIAL_FIRE_TIME");
  return zonedDateTimeLocalToUtc(
    `${date}T${match[1]}:${match[2]}`,
    "Europe/Madrid",
    { disambiguation: "earlier" },
  );
}

function utcDate(ms: number) {
  const value = new Date(ms);
  if (Number.isNaN(value.getTime())) throw new Error("INVALID_INFOCA_DATE");
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchJson(url: URL) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Anella/1.0 emergency-coordination",
    },
  });
  if (!response.ok) {
    throw new Error(`UPSTREAM_HTTP_${response.status}`);
  }
  return readBoundedJsonResponse(response);
}

async function fetchPdfText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/pdf",
      "User-Agent": "Anella/1.0 emergency-coordination",
    },
  });
  if (!response.ok) throw new Error(`UPSTREAM_HTTP_${response.status}`);
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/pdf") {
    throw new Error("UPSTREAM_NOT_PDF");
  }
  return extractPdfText(await readBoundedPdfResponse(response));
}

function jcylLatestUrl() {
  const url = new URL(JCYL_API);
  url.searchParams.set("select", "max(fecha_del_parte) as latest_date");
  url.searchParams.set("limit", "1");
  return url;
}

function jcylPageUrl(latestDate: string, offset: number) {
  const url = new URL(JCYL_API);
  url.searchParams.set(
    "select",
    [
      "fecha_del_parte",
      "hora_del_parte",
      "provincia",
      "termino_municipal",
      "nivel",
      "nivel_maximo_alcanzado",
      "fecha_de_inicio",
      "hora_de_inicio",
      "situacion_actual",
      "fecha_extinguido",
      "hora_extinguido",
      "codigo_municipio_ine",
      "posicion",
    ].join(","),
  );
  url.searchParams.set(
    "where",
    `fecha_del_parte = date'${latestDate}' AND posicion is not null`,
  );
  url.searchParams.set("order_by", "fecha_del_parte desc,hora_del_parte desc");
  url.searchParams.set("limit", String(JCYL_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url;
}

function normalizeJcylRecord(
  record: z.infer<typeof jcylRecordSchema>,
): NormalizedFireSignal {
  const detectedAt = dateTimeInSpain(
    record.fecha_de_inicio,
    record.hora_de_inicio,
  );
  const reportAt = dateTimeInSpain(
    record.fecha_del_parte,
    record.hora_del_parte,
  );
  const endedAt =
    record.fecha_extinguido && record.hora_extinguido
      ? dateTimeInSpain(
          record.fecha_extinguido,
          record.hora_extinguido,
        ).toISOString()
      : null;
  const province = record.provincia.join(", ");

  return {
    source: DetectionSource.CIVIL_PROTECTION,
    provider: "JCYL",
    externalId: digestId("jcyl", [
      record.codigo_municipio_ine ?? province,
      record.fecha_de_inicio,
      record.hora_de_inicio,
      record.posicion.lat.toFixed(5),
      record.posicion.lon.toFixed(5),
    ]),
    sourceUrl: JCYL_SOURCE_URL,
    latitude: record.posicion.lat,
    longitude: record.posicion.lon,
    detectedAt,
    confidence: "official",
    instrument: "PARTE_OFICIAL",
    providerStatus: normalizeProviderStatus(record.situacion_actual),
    rawJson: {
      provider: "JCYL",
      municipality: record.termino_municipal,
      province,
      incidentType: "Incendio forestal",
      officialStatus: record.situacion_actual,
      currentLevel: record.nivel ?? null,
      maximumLevel: record.nivel_maximo_alcanzado ?? null,
      reportAt: reportAt.toISOString(),
      sourceUpdatedAt: reportAt.toISOString(),
      endedAt,
      ingestion: "official-jcyl-v1",
    },
    mutable: true,
  };
}

async function fetchJcyl(now: Date): Promise<FireSourceResult> {
  const startedAt = Date.now();
  try {
    const latestPayload = jcylLatestSchema.parse(
      await fetchJson(jcylLatestUrl()),
    );
    const latestDate = latestPayload.results[0]?.latest_date.slice(0, 10);
    if (!latestDate) {
      return {
        sourceKey: "JCYL",
        label: "Junta de Castilla y León",
        source: DetectionSource.CIVIL_PROTECTION,
        ok: true,
        received: 0,
        rejected: 0,
        detections: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // Reject a frozen or malformed catalogue date instead of presenting an old
    // daily report as a current official status.
    const latestInstant = new Date(`${latestDate}T23:59:59.999Z`);
    if (
      Number.isNaN(latestInstant.getTime()) ||
      latestInstant.getTime() < now.getTime() - 72 * 60 * 60 * 1_000 ||
      latestInstant.getTime() > now.getTime() + 24 * 60 * 60 * 1_000
    ) {
      throw new Error("JCYL_CATALOGUE_STALE");
    }

    const firstPage = jcylPageSchema.parse(
      await fetchJson(jcylPageUrl(latestDate, 0)),
    );
    const acceptedTotal = Math.min(firstPage.total_count, MAX_JCYL_RECORDS);
    const offsets: number[] = [];
    for (
      let offset = JCYL_PAGE_SIZE;
      offset < acceptedTotal;
      offset += JCYL_PAGE_SIZE
    ) {
      offsets.push(offset);
    }
    const extraPages = await Promise.all(
      offsets.map(async (offset) =>
        jcylPageSchema.parse(await fetchJson(jcylPageUrl(latestDate, offset))),
      ),
    );
    const records = [firstPage, ...extraPages].flatMap((page) => page.results);
    const detections = new Map<string, NormalizedFireSignal>();
    let rejected = Math.max(0, firstPage.total_count - MAX_JCYL_RECORDS);
    for (const value of records) {
      const parsed = jcylRecordSchema.safeParse(value);
      if (!parsed.success) {
        rejected += 1;
        continue;
      }
      try {
        const detection = normalizeJcylRecord(parsed.data);
        if (detections.has(detection.externalId)) rejected += 1;
        else detections.set(detection.externalId, detection);
      } catch {
        rejected += 1;
      }
    }

    return {
      sourceKey: "JCYL",
      label: "Junta de Castilla y León",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: true,
      received: records.length,
      rejected,
      detections: [...detections.values()],
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("Official fire source failed: JCYL", error);
    return {
      sourceKey: "JCYL",
      label: "Junta de Castilla y León",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: false,
      received: 0,
      rejected: 0,
      detections: [],
      durationMs: Date.now() - startedAt,
      error: "No se ha podido obtener o validar el parte oficial.",
    };
  }
}

function infocaUrl(now: Date) {
  const recent = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
  const cutoff = `${utcDate(recent.getTime())} 00:00:00`;
  const url = new URL(INFOCA_LAYER);
  url.searchParams.set("f", "json");
  url.searchParams.set(
    "where",
    `(ESTADO <> 'EXTINGUIDO') OR FECHA >= timestamp '${cutoff}'`,
  );
  url.searchParams.set(
    "outFields",
    [
      "OID_ENTERO",
      "ESRI_OID",
      "TERMINO_MUNICIPAL",
      "PROVINCIA",
      "TIPO_INCIDENTE",
      "ESTADO",
      "FECHA",
      "HORA",
    ].join(","),
  );
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("resultRecordCount", String(MAX_INFOCA_RECORDS));
  url.searchParams.set("outSR", "4326");
  return url;
}

function normalizeInfocaFeature(
  feature: z.infer<typeof infocaFeatureSchema>,
): NormalizedFireSignal {
  const date = utcDate(feature.attributes.FECHA);
  const detectedAt = dateTimeInSpain(date, feature.attributes.HORA);

  return {
    source: DetectionSource.CIVIL_PROTECTION,
    provider: "INFOCA",
    externalId: digestId("infoca", [
      date.slice(0, 4),
      feature.attributes.OID_ENTERO,
    ]),
    sourceUrl: INFOCA_SOURCE_URL,
    latitude: feature.geometry.y,
    longitude: feature.geometry.x,
    detectedAt,
    confidence: "official",
    instrument: "PARTE_OFICIAL",
    providerStatus: normalizeProviderStatus(feature.attributes.ESTADO),
    rawJson: {
      provider: "INFOCA",
      municipality: feature.attributes.TERMINO_MUNICIPAL,
      province: feature.attributes.PROVINCIA,
      incidentType: feature.attributes.TIPO_INCIDENTE,
      officialStatus: feature.attributes.ESTADO,
      sourceUpdatedAt: detectedAt.toISOString(),
      ingestion: "official-infoca-v1",
    },
    mutable: true,
  };
}

async function fetchInfoca(now: Date): Promise<FireSourceResult> {
  const startedAt = Date.now();
  try {
    const payload = infocaPayloadSchema.parse(await fetchJson(infocaUrl(now)));
    if (payload.error || payload.exceededTransferLimit) {
      throw new Error(
        payload.error ? "INFOCA_ARCGIS_ERROR" : "INFOCA_RESULT_LIMIT",
      );
    }

    const detections = new Map<string, NormalizedFireSignal>();
    let rejected = 0;
    for (const value of payload.features) {
      const parsed = infocaFeatureSchema.safeParse(value);
      if (
        !parsed.success ||
        !/INCENDIOS?\s+FORESTALES?/i.test(parsed.data.attributes.TIPO_INCIDENTE)
      ) {
        rejected += 1;
        continue;
      }
      try {
        const detection = normalizeInfocaFeature(parsed.data);
        if (detections.has(detection.externalId)) rejected += 1;
        else detections.set(detection.externalId, detection);
      } catch {
        rejected += 1;
      }
    }

    return {
      sourceKey: "INFOCA",
      label: "Plan INFOCA · Andalucía",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: true,
      received: payload.features.length,
      rejected,
      detections: [...detections.values()],
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("Official fire source failed: INFOCA", error);
    return {
      sourceKey: "INFOCA",
      label: "Plan INFOCA · Andalucía",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: false,
      received: 0,
      rejected: 0,
      detections: [],
      durationMs: Date.now() - startedAt,
      error: "No se ha podido obtener o validar el visor oficial.",
    };
  }
}

async function fetchMitecoCcinif(
  now: Date,
  municipalities: OfficialFireMunicipality[],
): Promise<FireSourceResult> {
  const startedAt = Date.now();
  try {
    const report = parseMitecoReportText(
      await fetchPdfText(MITECO_CCINIF_REPORT),
    );
    const reportTime = report.sourceUpdatedAt.getTime();
    if (
      reportTime < now.getTime() - 48 * 60 * 60 * 1_000 ||
      reportTime > now.getTime() + 24 * 60 * 60 * 1_000
    ) {
      throw new Error("MITECO_CCINIF_REPORT_STALE");
    }

    const detections = new Map<string, NormalizedFireSignal>();
    let rejected = 0;
    for (const record of report.records) {
      const municipality = resolveMitecoMunicipality(record, municipalities);
      if (!municipality || !record.officialStatus) {
        rejected += 1;
        continue;
      }
      const externalId = digestId("miteco-ccinif", [municipality.id]);
      if (detections.has(externalId)) {
        rejected += 1;
        continue;
      }
      detections.set(externalId, {
        source: DetectionSource.CIVIL_PROTECTION,
        provider: "MITECO_CCINIF",
        externalId,
        sourceUrl: MITECO_CCINIF_SOURCE_URL,
        latitude: municipality.latitude,
        longitude: municipality.longitude,
        detectedAt: report.sourceUpdatedAt,
        confidence: "official",
        instrument: "PARTE_OFICIAL",
        providerStatus: normalizeProviderStatus(record.officialStatus),
        rawJson: {
          provider: "MITECO_CCINIF",
          municipality: municipality.name,
          province: municipality.province,
          incidentType: "Incendio forestal",
          officialStatus: record.officialStatus,
          sourceUpdatedAt: report.sourceUpdatedAt.toISOString(),
          reportDate: report.reportDate,
          locationPrecision: "municipality-centroid",
          footprintRadiusMeters: 5_000,
          ingestion: "official-miteco-ccinif-v1",
        },
        mutable: true,
        municipalityIdHint: municipality.id,
      });
    }

    return {
      sourceKey: "MITECO_CCINIF",
      label: "CCINIF / MITECO · España",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: true,
      received: report.records.length,
      rejected,
      detections: [...detections.values()],
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("Official fire source failed: MITECO_CCINIF", error);
    return {
      sourceKey: "MITECO_CCINIF",
      label: "CCINIF / MITECO · España",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: false,
      received: 0,
      rejected: 0,
      detections: [],
      durationMs: Date.now() - startedAt,
      error: "No se ha podido obtener o validar el parte nacional en curso.",
    };
  }
}

function bombersCatalunyaUrl() {
  const url = new URL(BOMBERS_CATALUNYA_LAYER);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "TAL_COD_ALARMA2 IN ('VA','VF','VU')");
  url.searchParams.set(
    "outFields",
    [
      "ACT_DAT_ACTUACIO",
      "TAL_COD_ALARMA2",
      "TAL_DESC_ALARMA2",
      "ACT_DAT_INICI",
      "MUNICIPI_DPX",
      "DATA_ACT",
      "GlobalID",
      "COM_FASE",
    ].join(","),
  );
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set(
    "resultRecordCount",
    String(MAX_BOMBERS_CATALUNYA_RECORDS),
  );
  url.searchParams.set("outSR", "4326");
  return url;
}

function normalizeBombersCatalunyaFeature(
  feature: z.infer<typeof bombersCatalunyaFeatureSchema>,
): NormalizedFireSignal {
  const startedAtMs =
    feature.attributes.ACT_DAT_INICI ?? feature.attributes.ACT_DAT_ACTUACIO;
  if (startedAtMs === null || startedAtMs === undefined) {
    throw new Error("BOMBERS_CATALUNYA_START_MISSING");
  }
  const detectedAt = new Date(startedAtMs);
  if (Number.isNaN(detectedAt.getTime())) {
    throw new Error("BOMBERS_CATALUNYA_START_INVALID");
  }
  const phase = feature.attributes.COM_FASE?.trim() || null;
  const sourceUpdatedAt = feature.attributes.DATA_ACT
    ? new Date(feature.attributes.DATA_ACT)
    : null;
  if (sourceUpdatedAt && Number.isNaN(sourceUpdatedAt.getTime())) {
    throw new Error("BOMBERS_CATALUNYA_UPDATE_INVALID");
  }

  return {
    source: DetectionSource.CIVIL_PROTECTION,
    provider: "BOMBERS_CATALUNYA",
    externalId: digestId("bombers-catalunya", [
      feature.attributes.GlobalID.toLowerCase(),
    ]),
    sourceUrl: BOMBERS_CATALUNYA_SOURCE_URL,
    latitude: feature.geometry.y,
    longitude: feature.geometry.x,
    detectedAt,
    confidence: "official",
    instrument: "AVIS_OFICIAL",
    providerStatus: phase ? normalizeProviderStatus(phase) : "UNKNOWN",
    rawJson: {
      provider: "BOMBERS_CATALUNYA",
      municipality: feature.attributes.MUNICIPI_DPX,
      incidentType: feature.attributes.TAL_DESC_ALARMA2,
      officialStatus: phase,
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
      ingestion: "official-bombers-catalunya-v1",
    },
    mutable: true,
  };
}

async function fetchBombersCatalunya(): Promise<FireSourceResult> {
  const startedAt = Date.now();
  try {
    const payload = bombersCatalunyaPayloadSchema.parse(
      await fetchJson(bombersCatalunyaUrl()),
    );
    if (payload.error || payload.exceededTransferLimit) {
      throw new Error(
        payload.error
          ? "BOMBERS_CATALUNYA_ARCGIS_ERROR"
          : "BOMBERS_CATALUNYA_RESULT_LIMIT",
      );
    }

    const detections = new Map<string, NormalizedFireSignal>();
    let rejected = 0;
    for (const value of payload.features) {
      const parsed = bombersCatalunyaFeatureSchema.safeParse(value);
      if (
        !parsed.success ||
        !/^V[AFU]$/.test(parsed.data.attributes.TAL_COD_ALARMA2) ||
        !/^Incendi vegetaci(?:ó|o)/i.test(
          parsed.data.attributes.TAL_DESC_ALARMA2,
        )
      ) {
        rejected += 1;
        continue;
      }
      try {
        const detection = normalizeBombersCatalunyaFeature(parsed.data);
        if (detections.has(detection.externalId)) rejected += 1;
        else detections.set(detection.externalId, detection);
      } catch {
        rejected += 1;
      }
    }

    return {
      sourceKey: "BOMBERS_CATALUNYA",
      label: "Bombers de la Generalitat · Catalunya",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: true,
      received: payload.features.length,
      rejected,
      detections: [...detections.values()],
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("Official fire source failed: BOMBERS_CATALUNYA", error);
    return {
      sourceKey: "BOMBERS_CATALUNYA",
      label: "Bombers de la Generalitat · Catalunya",
      source: DetectionSource.CIVIL_PROTECTION,
      ok: false,
      received: 0,
      rejected: 0,
      detections: [],
      durationMs: Date.now() - startedAt,
      error: "No se ha podido obtener o validar el visor oficial de Catalunya.",
    };
  }
}

export async function fetchOfficialFireSource(
  source: OfficialFireSourceId,
  now: Date,
  municipalities: OfficialFireMunicipality[] = [],
) {
  if (source === "BOMBERS_CATALUNYA") return fetchBombersCatalunya();
  if (source === "JCYL") return fetchJcyl(now);
  if (source === "INFOCA") return fetchInfoca(now);
  return fetchMitecoCcinif(now, municipalities);
}
