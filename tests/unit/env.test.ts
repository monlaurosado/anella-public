import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertDeploymentConfiguration,
  assertDeploymentEnvironment,
  getAutomaticFireIngestionConfig,
  getDeploymentVersion,
  isHostedDeployment,
  isProductionDeployment,
  isStagingDeployment,
} from "@/config/env";

function validProductionEnvironment() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ANELLA_ENV", "production");
  vi.stubEnv(
    "DATABASE_URL",
    "mysql://anella_runtime:safe-db-credential@db.internal:3306/anella?sslaccept=strict",
  );
  vi.stubEnv("APP_URL", "https://anella.municipi.cat");
  vi.stubEnv("NEXTAUTH_URL", "https://anella.municipi.cat");
  vi.stubEnv(
    "NEXTAUTH_SECRET",
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_!",
  );
  vi.stubEnv(
    "IDEMPOTENCY_SECRET",
    "separate-idempotency-key-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789",
  );
  vi.stubEnv(
    "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
    Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
  );
  vi.stubEnv("SERVER_ACTION_ALLOWED_ORIGINS", "anella.municipi.cat");
  vi.stubEnv("TRUST_PROXY_HEADERS", "true");
  vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  vi.stubEnv("DEPLOYMENT_VERSION", "release-2026-07-13");
  vi.stubEnv("APP_TIME_ZONE", "Europe/Madrid");
  vi.stubEnv("PRIVACY_CONTROLLER_NAME", "Ajuntament de Vilabona");
  vi.stubEnv("PRIVACY_CONTACT_EMAIL", "privacitat@vilabona.cat");
  vi.stubEnv(
    "PRIVACY_LEGAL_BASIS",
    "Misión de interés público municipal y consentimiento de la aportación",
  );
  vi.stubEnv(
    "PRIVACY_PROCESSOR_NAME",
    "Servei TIC de l'Ajuntament de Vilabona",
  );
  vi.stubEnv("PRIVACY_RETENTION_DAYS", "90");
  vi.stubEnv("LEGAL_ENTITY_NAME", "Ajuntament de Vilabona");
  vi.stubEnv("LEGAL_IDENTIFIER", "P0800001A");
  vi.stubEnv("LEGAL_ADDRESS", "Plaça Major 1, Vilabona");
  vi.stubEnv("LEGAL_CONTACT_EMAIL", "juridic@vilabona.cat");
  vi.stubEnv("SEED_DEMO_DATA", "false");
  vi.stubEnv("SEED_RESET_ADMIN_PASSWORD", "false");
}

function validStagingEnvironment() {
  validProductionEnvironment();
  vi.stubEnv("ANELLA_ENV", "staging");
  for (const name of [
    "PRIVACY_CONTROLLER_NAME",
    "PRIVACY_CONTACT_EMAIL",
    "PRIVACY_LEGAL_BASIS",
    "PRIVACY_PROCESSOR_NAME",
    "LEGAL_ENTITY_NAME",
    "LEGAL_IDENTIFIER",
    "LEGAL_ADDRESS",
    "LEGAL_CONTACT_EMAIL",
  ]) {
    vi.stubEnv(name, "");
  }
}

describe("deployment environment fail-closed validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an omitted deployment marker under NODE_ENV=production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANELLA_ENV", "");

    expect(() => assertDeploymentEnvironment()).toThrow(/ANELLA_ENV/);
    expect(() => isProductionDeployment()).toThrow(/ANELLA_ENV/);
  });

  it("allows an explicit isolated test build without enabling production cookies", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANELLA_ENV", "test");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3100");
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://anella:test@127.0.0.1:3307/anella_test",
    );

    expect(assertDeploymentEnvironment()).toBe("test");
    expect(isProductionDeployment()).toBe(false);
  });

  it("rejects a public deployment disguised as a test build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANELLA_ENV", "test");
    vi.stubEnv("APP_URL", "https://anella.municipi.cat");
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://anella_runtime:safe-db-credential@db.internal:3306/anella",
    );

    expect(() => assertDeploymentEnvironment()).toThrow(/loopback/);
  });

  it("rejects the documented placeholder secret in production", () => {
    validProductionEnvironment();
    vi.stubEnv(
      "NEXTAUTH_SECRET",
      "VALOR_ALEATORIO_REAL_DE_32_O_MAS_CARACTERES",
    );

    expect(() => assertDeploymentConfiguration()).toThrow(/NEXTAUTH_SECRET/);
  });

  it("requires a separate stable idempotency secret in production", () => {
    validProductionEnvironment();
    vi.stubEnv("IDEMPOTENCY_SECRET", "");
    expect(() => assertDeploymentConfiguration()).toThrow(/IDEMPOTENCY_SECRET/);

    validProductionEnvironment();
    vi.stubEnv(
      "IDEMPOTENCY_SECRET",
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_!",
    );
    expect(() => assertDeploymentConfiguration()).toThrow(
      /distinto de NEXTAUTH_SECRET/,
    );
  });

  it.each([
    ["NEXTAUTH_URL", /APP_URL y NEXTAUTH_URL/],
    ["DEPLOYMENT_VERSION", /DEPLOYMENT_VERSION/],
    ["PRIVACY_RETENTION_DAYS", /PRIVACY_RETENTION_DAYS/],
    ["PRIVACY_LEGAL_BASIS", /PRIVACY_LEGAL_BASIS/],
    ["PRIVACY_PROCESSOR_NAME", /PRIVACY_PROCESSOR_NAME/],
    ["TRUSTED_PROXY_HOPS", /TRUST_PROXY_HEADERS y TRUSTED_PROXY_HOPS/],
    [
      "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
      /NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/,
    ],
  ] as const)("rejects a missing production %s", (name, message) => {
    validProductionEnvironment();
    vi.stubEnv(name, "");

    expect(() => assertDeploymentConfiguration()).toThrow(message);
  });

  it("requires strict TLS for a remote production database", () => {
    validProductionEnvironment();
    vi.stubEnv(
      "DATABASE_URL",
      "mysql://anella_runtime:safe-db-credential@db.internal:3306/anella",
    );

    expect(() => assertDeploymentConfiguration()).toThrow(/sslaccept=strict/);
  });

  it.each([
    "https://anella.municipi.cat/base",
    "https://anella.municipi.cat/?preview=1",
    "https://anella.municipi.cat/#preview",
    "https://user:secret@anella.municipi.cat/",
  ])("rejects a production URL that is not a root origin: %s", (url) => {
    validProductionEnvironment();
    vi.stubEnv("APP_URL", url);
    vi.stubEnv("NEXTAUTH_URL", url);

    expect(() => assertDeploymentConfiguration()).toThrow(/origen HTTPS raíz/);
  });

  it.each(["invalid", "test", "local"])(
    "rejects reserved .%s hosts and contact email domains",
    (suffix) => {
      validProductionEnvironment();
      vi.stubEnv("APP_URL", `https://anella.${suffix}`);
      vi.stubEnv("NEXTAUTH_URL", `https://anella.${suffix}`);

      expect(() => assertDeploymentConfiguration()).toThrow(
        /host público real/,
      );

      validProductionEnvironment();
      vi.stubEnv("PRIVACY_CONTACT_EMAIL", `privacy@anella.${suffix}`);

      expect(() => assertDeploymentConfiguration()).toThrow(
        /PRIVACY_CONTROLLER_NAME, PRIVACY_CONTACT_EMAIL/,
      );

      validProductionEnvironment();
      vi.stubEnv("LEGAL_CONTACT_EMAIL", `legal@anella.${suffix}`);

      expect(() => assertDeploymentConfiguration()).toThrow(
        /LEGAL_ENTITY_NAME, LEGAL_IDENTIFIER/,
      );
    },
  );

  it("rejects extra Server Action origins in production", () => {
    validProductionEnvironment();
    vi.stubEnv(
      "SERVER_ACTION_ALLOWED_ORIGINS",
      "anella.municipi.cat,admin.municipi.cat",
    );

    expect(() => assertDeploymentConfiguration()).toThrow(
      /exactamente el host público/,
    );
  });

  it("accepts a complete explicit production configuration", () => {
    validProductionEnvironment();

    expect(() => assertDeploymentConfiguration()).not.toThrow();
    expect(isProductionDeployment()).toBe(true);
    expect(isHostedDeployment()).toBe(true);
    expect(isStagingDeployment()).toBe(false);
  });

  it("reports the immutable build version instead of a stale configured label", () => {
    validProductionEnvironment();
    vi.stubEnv(
      "ANELLA_BUILD_VERSION",
      "0123456789abcdef0123456789abcdef01234567",
    );

    expect(getDeploymentVersion()).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("accepts hardened public staging without deferred legal values", () => {
    validStagingEnvironment();

    expect(() => assertDeploymentConfiguration()).not.toThrow();
    expect(isHostedDeployment()).toBe(true);
    expect(isStagingDeployment()).toBe(true);
    expect(isProductionDeployment()).toBe(false);
  });

  it("requires an independent high-entropy secret when automatic fire ingestion is enabled", () => {
    validStagingEnvironment();
    vi.stubEnv("FIRE_INGESTION_ENABLED", "true");
    vi.stubEnv("FIRE_INGESTION_SECRET", "");
    expect(() => assertDeploymentConfiguration()).toThrow(
      /FIRE_INGESTION_SECRET/,
    );

    vi.stubEnv(
      "FIRE_INGESTION_SECRET",
      "automatic-fire-ingestion-ABCDEFGHIJKLMNOPQRSTUVWXYZ-9876543210",
    );
    expect(() => assertDeploymentConfiguration()).not.toThrow();
    expect(getAutomaticFireIngestionConfig()).toMatchObject({
      enabled: true,
      maximumAgeHours: 24,
      assignmentRadiusKm: 50,
      intervalMinutes: 5,
    });
    expect(getAutomaticFireIngestionConfig().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ product: "MODIS_NRT" }),
      ]),
    );
    expect(getAutomaticFireIngestionConfig().officialSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKey: "BOMBERS_CATALUNYA" }),
        expect.objectContaining({ sourceKey: "JCYL" }),
        expect.objectContaining({ sourceKey: "INFOCA" }),
        expect.objectContaining({ sourceKey: "MITECO_CCINIF" }),
      ]),
    );
  });

  it("rejects unsupported automatic NASA products", () => {
    vi.stubEnv("NASA_FIRMS_AUTO_SOURCES", "MODIS_UNKNOWN");
    expect(() => getAutomaticFireIngestionConfig()).toThrow();
  });

  it("never lets automatic ingestion narrow coverage below all of Spain", () => {
    vi.stubEnv("NASA_FIRMS_BOUNDS", "-0.5,40.4,3.4,42.9");

    expect(getAutomaticFireIngestionConfig().bounds).toEqual({
      west: -18.5,
      south: 27.5,
      east: 4.5,
      north: 44.5,
    });
  });

  it("rejects unsupported official sources and unsafe polling intervals", () => {
    vi.stubEnv("FIRE_OFFICIAL_AUTO_SOURCES", "UNVERIFIED_FEED");
    expect(() => getAutomaticFireIngestionConfig()).toThrow();

    vi.stubEnv("FIRE_OFFICIAL_AUTO_SOURCES", "JCYL");
    vi.stubEnv("FIRE_INGESTION_INTERVAL_MINUTES", "1");
    expect(() => getAutomaticFireIngestionConfig()).toThrow();
  });

  it.each([
    [
      "remote database without strict TLS",
      "DATABASE_URL",
      "mysql://anella_runtime:safe-db-credential@db.internal:3306/anella",
      /sslaccept=strict/,
    ],
    ["insecure public URL", "APP_URL", "http://anella.municipi.cat", /HTTPS/],
    ["missing proxy hops", "TRUSTED_PROXY_HOPS", "", /TRUST_PROXY_HEADERS/],
    ["demo seed enabled", "SEED_DEMO_DATA", "true", /SEED_DEMO_DATA/],
  ] as const)("rejects staging with %s", (_case, name, value, message) => {
    validStagingEnvironment();
    vi.stubEnv(name, value);
    if (name === "APP_URL") vi.stubEnv("NEXTAUTH_URL", value);

    expect(() => assertDeploymentConfiguration()).toThrow(message);
  });
});
