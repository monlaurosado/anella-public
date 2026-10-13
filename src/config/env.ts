import { z } from "zod";

const NATIONAL_FIRE_BOUNDS = Object.freeze({
  west: -18.5,
  south: 27.5,
  east: 4.5,
  north: 44.5,
});

const mysqlUrlSchema = z
  .string()
  .min(1, "DATABASE_URL no esta configurada")
  .refine((value) => value.startsWith("mysql://"), {
    message: "DATABASE_URL debe empezar por mysql://",
  });

const boundsSchema = z
  .string()
  .default(
    `${NATIONAL_FIRE_BOUNDS.west},${NATIONAL_FIRE_BOUNDS.south},${NATIONAL_FIRE_BOUNDS.east},${NATIONAL_FIRE_BOUNDS.north}`,
  )
  .transform((value, context) => {
    const values = value.split(",").map(Number);

    if (
      values.length !== 4 ||
      values.some((coordinate) => !Number.isFinite(coordinate))
    ) {
      context.addIssue({
        code: "custom",
        message: "NASA_FIRMS_BOUNDS debe ser oeste,sur,este,norte",
      });
      return z.NEVER;
    }

    const [west, south, east, north] = values;

    if (
      west < -180 ||
      east > 180 ||
      south < -90 ||
      north > 90 ||
      west >= east ||
      south >= north
    ) {
      context.addIssue({
        code: "custom",
        message:
          "NASA_FIRMS_BOUNDS contiene coordenadas fuera de rango o limites invertidos",
      });
      return z.NEVER;
    }

    return { west, south, east, north };
  });

function withNationalFireCoverage(bounds: z.infer<typeof boundsSchema>) {
  return {
    west: Math.min(bounds.west, NATIONAL_FIRE_BOUNDS.west),
    south: Math.min(bounds.south, NATIONAL_FIRE_BOUNDS.south),
    east: Math.max(bounds.east, NATIONAL_FIRE_BOUNDS.east),
    north: Math.max(bounds.north, NATIONAL_FIRE_BOUNDS.north),
  };
}

const retentionDaysSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(3650)
  .default(90);

const booleanSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const automaticFireSourceIds = [
  "MODIS_NRT",
  "VIIRS_NOAA21_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_SNPP_NRT",
] as const;

const automaticFireSourceSchema = z.enum(automaticFireSourceIds);

export const AUTOMATIC_FIRE_SOURCES = Object.freeze({
  MODIS_NRT: {
    product: "MODIS_NRT",
    label: "NASA MODIS Terra/Aqua",
    footprintPath: "c6.1/FirespotArea_europe_c6.1_24h.kmz",
  },
  VIIRS_NOAA21_NRT: {
    product: "VIIRS_NOAA21_NRT",
    label: "NASA VIIRS NOAA-21",
    footprintPath: "noaa-21-viirs-c2",
  },
  VIIRS_NOAA20_NRT: {
    product: "VIIRS_NOAA20_NRT",
    label: "NASA VIIRS NOAA-20",
    footprintPath: "noaa-20-viirs-c2",
  },
  VIIRS_SNPP_NRT: {
    product: "VIIRS_SNPP_NRT",
    label: "NASA VIIRS Suomi-NPP",
    footprintPath: "suomi-npp-viirs-c2",
  },
} satisfies Record<
  (typeof automaticFireSourceIds)[number],
  {
    product: (typeof automaticFireSourceIds)[number];
    label: string;
    footprintPath: string;
  }
>);

const automaticOfficialFireSourceIds = [
  "BOMBERS_CATALUNYA",
  "JCYL",
  "INFOCA",
  "MITECO_CCINIF",
] as const;
const automaticOfficialFireSourceSchema = z.enum(
  automaticOfficialFireSourceIds,
);

export const AUTOMATIC_OFFICIAL_FIRE_SOURCES = Object.freeze({
  BOMBERS_CATALUNYA: {
    sourceKey: "BOMBERS_CATALUNYA",
    label: "Bombers de la Generalitat · Catalunya",
  },
  JCYL: {
    sourceKey: "JCYL",
    label: "Junta de Castilla y León",
  },
  INFOCA: {
    sourceKey: "INFOCA",
    label: "Plan INFOCA · Andalucía",
  },
  MITECO_CCINIF: {
    sourceKey: "MITECO_CCINIF",
    label: "CCINIF / MITECO · España",
  },
} satisfies Record<
  (typeof automaticOfficialFireSourceIds)[number],
  { sourceKey: (typeof automaticOfficialFireSourceIds)[number]; label: string }
>);

const proxyHopsSchema = z.coerce.number().int().min(1).max(5).default(1);

const deploymentVersionSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    "DEPLOYMENT_VERSION solo puede contener letras, números, punto, guion y guion bajo",
  );

const knownPlaceholderPattern =
  /replace|change-me|changeme|example|pending|pendiente|prueba|contrase(?:n|ñ)a|password|secreto-aleatorio|valor[_ -]aleatorio|usuario|clave[_ -]codificada|host_mysql|dominio-real|tu-dominio|responsable real|entidad titular real|identificador fiscal real|domicilio legal real|correo-real/i;

const reservedPublicHostnamePattern =
  /(?:^|\.)(?:example|invalid|local|localhost|test)$/i;

const deploymentEnvironmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);

function isLoopbackUrl(value: string | undefined) {
  if (!value) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isReservedPublicHostname(hostname: string) {
  return reservedPublicHostnamePattern.test(hostname);
}

function hasReservedEmailDomain(email: string) {
  const domain = email.split("@").at(-1);
  return !domain || isReservedPublicHostname(domain);
}

export function assertDeploymentEnvironment() {
  const marker = deploymentEnvironmentSchema.safeParse(process.env.ANELLA_ENV);

  if (process.env.NODE_ENV === "production" && !marker.success) {
    throw new Error(
      "ANELLA_ENV debe declararse explícitamente como development, test, staging o production al compilar y ejecutar con NODE_ENV=production",
    );
  }

  if (process.env.ANELLA_ENV && !marker.success) {
    throw new Error("ANELLA_ENV no contiene un entorno permitido");
  }

  if (
    process.env.NODE_ENV === "production" &&
    marker.success &&
    marker.data !== "staging" &&
    marker.data !== "production" &&
    (!isLoopbackUrl(process.env.APP_URL ?? process.env.NEXTAUTH_URL) ||
      !isLoopbackUrl(process.env.DATABASE_URL))
  ) {
    throw new Error(
      "Un build no productivo con NODE_ENV=production solo puede usar aplicación y base de datos loopback",
    );
  }

  return marker.success ? marker.data : "development";
}

export function isProductionDeployment() {
  return assertDeploymentEnvironment() === "production";
}

export function isStagingDeployment() {
  return assertDeploymentEnvironment() === "staging";
}

export function isHostedDeployment() {
  const environment = assertDeploymentEnvironment();
  return environment === "staging" || environment === "production";
}

export function getDatabaseUrl() {
  const value = mysqlUrlSchema.parse(process.env.DATABASE_URL);

  if (isHostedDeployment()) {
    const url = new URL(value);
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

    if (!isLoopback && url.searchParams.get("sslaccept") !== "strict") {
      throw new Error(
        "DATABASE_URL debe usar sslaccept=strict cuando MySQL no está en loopback",
      );
    }
  }

  return value;
}

export function getAuthSecret() {
  const secret = process.env.NEXTAUTH_SECRET;

  if (
    isHostedDeployment() &&
    (!secret ||
      secret.length < 32 ||
      new Set(secret).size < 16 ||
      knownPlaceholderPattern.test(secret))
  ) {
    throw new Error(
      "NEXTAUTH_SECRET debe contener al menos 32 caracteres en produccion",
    );
  }

  return secret ?? "anella-local-development-secret-change-me";
}

export function getIdempotencySecret() {
  const secret = process.env.IDEMPOTENCY_SECRET;

  if (
    isHostedDeployment() &&
    (!secret ||
      secret.length < 32 ||
      new Set(secret).size < 16 ||
      knownPlaceholderPattern.test(secret) ||
      secret === getAuthSecret())
  ) {
    throw new Error(
      "IDEMPOTENCY_SECRET debe ser aleatorio, estable, tener al menos 32 caracteres y ser distinto de NEXTAUTH_SECRET",
    );
  }

  return secret ?? "anella-local-idempotency-secret-stable-only";
}

export function getServerActionsEncryptionKey() {
  const value = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY?.trim();

  if (!isHostedDeployment()) return value;
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(
      "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY debe ser una clave AES de 32 bytes codificada en base64",
    );
  }

  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64");
  if (decoded.length !== 32 || canonical !== value) {
    throw new Error(
      "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY debe ser una clave AES de 32 bytes codificada en base64",
    );
  }
  return value;
}

export function getAppUrl() {
  const appUrlValue = process.env.APP_URL?.trim();
  const authUrlValue = process.env.NEXTAUTH_URL?.trim();
  const value = (
    appUrlValue ??
    authUrlValue ??
    "http://localhost:3000"
  ).replace(/\/$/, "");

  if (isHostedDeployment()) {
    if (!appUrlValue || !authUrlValue) {
      throw new Error("APP_URL y NEXTAUTH_URL son obligatorios en producción");
    }
    const urls = [appUrlValue, authUrlValue].map(
      (configuredUrl) => new URL(z.url().parse(configuredUrl)),
    );

    for (const url of urls) {
      if (url.protocol !== "https:") {
        throw new Error("APP_URL/NEXTAUTH_URL debe usar HTTPS en producción");
      }
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          "APP_URL/NEXTAUTH_URL debe contener únicamente el origen HTTPS raíz, sin credenciales, ruta, consulta ni fragmento",
        );
      }
      if (
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
        isReservedPublicHostname(url.hostname)
      ) {
        throw new Error(
          "APP_URL/NEXTAUTH_URL debe usar un host público real en producción",
        );
      }
    }

    if (urls[0].origin !== urls[1].origin) {
      throw new Error("APP_URL y NEXTAUTH_URL deben tener el mismo origen");
    }

    return urls[0].origin;
  }

  return value;
}

export function getDeploymentVersion() {
  const value =
    process.env.ANELLA_BUILD_VERSION?.trim() ||
    process.env.DEPLOYMENT_VERSION?.trim();

  if (isHostedDeployment()) {
    const version = deploymentVersionSchema.parse(value);
    if (knownPlaceholderPattern.test(version)) {
      throw new Error("DEPLOYMENT_VERSION contiene un marcador de posición");
    }
    return version;
  }

  return value || "development";
}

export function getServerActionAllowedOrigins() {
  const configured = process.env.SERVER_ACTION_ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const appHost = new URL(getAppUrl()).host;
  const values = configured?.length ? configured : [appHost];

  if (
    isHostedDeployment() &&
    (values.length !== 1 ||
      values[0] !== appHost ||
      values.some(
        (value) =>
          value === "*" ||
          value.includes("localhost") ||
          value.includes("://") ||
          value.includes("/"),
      ))
  ) {
    throw new Error(
      "SERVER_ACTION_ALLOWED_ORIGINS debe incluir exactamente el host público y no puede contener esquemas, rutas, comodines ni localhost",
    );
  }

  return [...new Set(values)];
}

export function getTrustedProxyConfig() {
  if (
    isHostedDeployment() &&
    (!process.env.TRUST_PROXY_HEADERS || !process.env.TRUSTED_PROXY_HOPS)
  ) {
    throw new Error(
      "TRUST_PROXY_HEADERS y TRUSTED_PROXY_HOPS son obligatorios en producción",
    );
  }

  return {
    trustHeaders: booleanSchema.parse(process.env.TRUST_PROXY_HEADERS),
    trustedHops: proxyHopsSchema.parse(process.env.TRUSTED_PROXY_HOPS),
  };
}

export function getOperationalTimeZone() {
  const timeZone = process.env.APP_TIME_ZONE?.trim() || "Europe/Madrid";
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone }).format(new Date());
  } catch {
    throw new Error(`APP_TIME_ZONE no es una zona IANA válida: ${timeZone}`);
  }
  return timeZone;
}

export function assertDeploymentConfiguration() {
  assertDeploymentEnvironment();
  getAutomaticFireIngestionConfig();
  getEmergencyAutomationConfig();
  getContributionAntiAutomationConfig();
  if (!isHostedDeployment()) return;

  getAuthSecret();
  getIdempotencySecret();
  getServerActionsEncryptionKey();
  getAppUrl();
  getDeploymentVersion();
  getServerActionAllowedOrigins();
  getOperationalTimeZone();

  if (isProductionDeployment()) {
    getPrivacyConfig();
    getLegalConfig();
  }

  if (!getTrustedProxyConfig().trustHeaders) {
    throw new Error(
      "TRUST_PROXY_HEADERS=true y TRUSTED_PROXY_HOPS deben configurarse detrás del proxy de producción",
    );
  }

  const databaseUrl = getDatabaseUrl();
  if (knownPlaceholderPattern.test(databaseUrl)) {
    throw new Error("DATABASE_URL contiene credenciales de ejemplo");
  }
  if (process.env.SEED_DEMO_DATA === "true") {
    throw new Error("SEED_DEMO_DATA debe ser false en producción");
  }
  if (process.env.SEED_RESET_ADMIN_PASSWORD === "true") {
    throw new Error("SEED_RESET_ADMIN_PASSWORD debe ser false en producción");
  }
  if (process.env.SEED_BOOTSTRAP_ADMIN === "true") {
    throw new Error(
      "SEED_BOOTSTRAP_ADMIN debe volver a false antes de compilar o arrancar la aplicación",
    );
  }
}

export function getFirmsConfig() {
  const apiKey = process.env.NASA_FIRMS_MAP_KEY?.trim();
  const source = process.env.NASA_FIRMS_SOURCE?.trim() || "VIIRS_SNPP_NRT";
  const bounds = boundsSchema.parse(process.env.NASA_FIRMS_BOUNDS);

  return { apiKey, source, bounds };
}

export function getAutomaticFireIngestionConfig() {
  const enabled = booleanSchema.parse(process.env.FIRE_INGESTION_ENABLED);
  const secret = process.env.FIRE_INGESTION_SECRET?.trim();
  const bounds = withNationalFireCoverage(
    boundsSchema.parse(process.env.NASA_FIRMS_BOUNDS),
  );
  const sourceValues = (
    process.env.NASA_FIRMS_AUTO_SOURCES ?? automaticFireSourceIds.join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const parsedSources = z
    .array(automaticFireSourceSchema)
    .min(1)
    .max(automaticFireSourceIds.length)
    .parse(sourceValues);
  const sources = [...new Set(parsedSources)].map(
    (source) => AUTOMATIC_FIRE_SOURCES[source],
  );
  const officialSourceValues = (
    process.env.FIRE_OFFICIAL_AUTO_SOURCES ??
    automaticOfficialFireSourceIds.join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const parsedOfficialSources = z
    .array(automaticOfficialFireSourceSchema)
    .max(automaticOfficialFireSourceIds.length)
    .parse(officialSourceValues);
  const officialSources = [...new Set(parsedOfficialSources)].map(
    (source) => AUTOMATIC_OFFICIAL_FIRE_SOURCES[source],
  );
  const maximumAgeHours = z.coerce
    .number()
    .int()
    .min(6)
    .max(72)
    .default(24)
    .parse(process.env.FIRE_DETECTION_MAX_AGE_HOURS);
  const assignmentRadiusKm = z.coerce
    .number()
    .min(1)
    .max(200)
    .default(50)
    .parse(process.env.FIRE_DETECTION_ASSIGNMENT_RADIUS_KM);
  const intervalMinutes = z.coerce
    .number()
    .int()
    .min(5)
    .max(60)
    .default(5)
    .parse(process.env.FIRE_INGESTION_INTERVAL_MINUTES);

  if (
    enabled &&
    (!secret ||
      secret.length < 32 ||
      new Set(secret).size < 16 ||
      knownPlaceholderPattern.test(secret) ||
      secret === getAuthSecret() ||
      secret === getIdempotencySecret())
  ) {
    throw new Error(
      "FIRE_INGESTION_SECRET debe ser aleatorio, tener al menos 32 caracteres y ser distinto de los demás secretos",
    );
  }

  return {
    enabled,
    secret: secret ?? null,
    bounds,
    sources,
    officialSources,
    maximumAgeHours,
    assignmentRadiusKm,
    intervalMinutes,
  };
}

export function getEmergencyAutomationConfig() {
  const candidateAutomationEnabled = booleanSchema.parse(
    process.env.DETECTION_CANDIDATE_AUTOMATION_ENABLED,
  );
  const notificationOutboxEnabled = booleanSchema.parse(
    process.env.DETECTION_NOTIFICATION_OUTBOX_ENABLED,
  );
  const deliveryEnabled = booleanSchema.parse(
    process.env.NOTIFICATION_DELIVERY_ENABLED,
  );
  const drillMode = z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
    .parse(process.env.NOTIFICATION_DRILL_MODE);
  const candidateRadiusMeters = z.coerce
    .number()
    .int()
    .min(500)
    .max(25_000)
    .default(5_000)
    .parse(process.env.DETECTION_CANDIDATE_RADIUS_METERS);
  const candidateWindowMinutes = z.coerce
    .number()
    .int()
    .min(15)
    .max(360)
    .default(120)
    .parse(process.env.DETECTION_CANDIDATE_WINDOW_MINUTES);
  const minimumThermalSignals = z.coerce
    .number()
    .int()
    .min(2)
    .max(20)
    .default(3)
    .parse(process.env.DETECTION_CANDIDATE_MIN_THERMAL_SIGNALS);
  const maximumBatchSize = z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000)
    .default(250)
    .parse(process.env.NOTIFICATION_OUTBOX_BATCH_SIZE);

  return {
    candidateAutomationEnabled,
    notificationOutboxEnabled,
    deliveryEnabled,
    drillMode,
    candidateRadiusMeters,
    candidateWindowMinutes,
    minimumThermalSignals,
    maximumBatchSize,
  };
}

export function getContributionAntiAutomationConfig() {
  const mode = z
    .enum(["honeypot", "disabled"])
    .default("honeypot")
    .parse(process.env.CONTRIBUTION_ANTI_AUTOMATION_MODE);
  if (isProductionDeployment() && mode === "disabled") {
    throw new Error(
      "CONTRIBUTION_ANTI_AUTOMATION_MODE no puede desactivarse en producción",
    );
  }
  return { mode };
}

export function getPrivacyConfig() {
  const controllerName = process.env.PRIVACY_CONTROLLER_NAME?.trim();
  const legalBasis = process.env.PRIVACY_LEGAL_BASIS?.trim();
  const processorName = process.env.PRIVACY_PROCESSOR_NAME?.trim();
  const contactEmail = z
    .email()
    .safeParse(process.env.PRIVACY_CONTACT_EMAIL?.trim());
  const production = isProductionDeployment();
  if (production && !process.env.PRIVACY_RETENTION_DAYS?.trim()) {
    throw new Error("PRIVACY_RETENTION_DAYS es obligatorio en producción");
  }
  const retentionDays = retentionDaysSchema.parse(
    process.env.PRIVACY_RETENTION_DAYS,
  );

  if (
    production &&
    (!controllerName ||
      !contactEmail.success ||
      !legalBasis ||
      !processorName ||
      knownPlaceholderPattern.test(controllerName) ||
      knownPlaceholderPattern.test(contactEmail.data) ||
      knownPlaceholderPattern.test(legalBasis) ||
      knownPlaceholderPattern.test(processorName) ||
      hasReservedEmailDomain(contactEmail.data))
  ) {
    throw new Error(
      "PRIVACY_CONTROLLER_NAME, PRIVACY_CONTACT_EMAIL, PRIVACY_LEGAL_BASIS y PRIVACY_PROCESSOR_NAME deben identificar la política real en producción",
    );
  }

  return {
    controllerName: controllerName || "Responsable de Anella",
    contactEmail: contactEmail.success
      ? contactEmail.data
      : "privacidad@anella.local",
    legalBasis:
      legalBasis ||
      "Consentimiento para coordinar la aportación y misión de interés público que deberá validar la entidad responsable.",
    processorName:
      processorName || "Proveedor de infraestructura pendiente de designación",
    retentionDays,
  };
}

export function getLegalConfig() {
  const entityName = process.env.LEGAL_ENTITY_NAME?.trim();
  const identifier = process.env.LEGAL_IDENTIFIER?.trim();
  const address = process.env.LEGAL_ADDRESS?.trim();
  const contactEmail = z
    .email()
    .safeParse(process.env.LEGAL_CONTACT_EMAIL?.trim());

  if (
    isProductionDeployment() &&
    (!entityName ||
      !identifier ||
      !address ||
      !contactEmail.success ||
      [entityName, identifier, address, contactEmail.data].some((value) =>
        knownPlaceholderPattern.test(value),
      ) ||
      hasReservedEmailDomain(contactEmail.data))
  ) {
    throw new Error(
      "LEGAL_ENTITY_NAME, LEGAL_IDENTIFIER, LEGAL_ADDRESS y LEGAL_CONTACT_EMAIL son obligatorios en producción",
    );
  }

  return {
    entityName: entityName || "Responsable de Anella",
    identifier: identifier || "Identificación pendiente fuera de producción",
    address: address || "Domicilio pendiente fuera de producción",
    contactEmail: contactEmail.success
      ? contactEmail.data
      : "legal@anella.local",
  };
}
