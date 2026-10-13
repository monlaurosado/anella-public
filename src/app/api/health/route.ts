import { NextResponse } from "next/server";

import { getDeploymentVersion } from "@/config/env";
import { prisma } from "@/lib/db";
import {
  databaseMeetsAnellaContract,
  identifyDatabaseEngine,
  type SupportedDatabaseEngine,
} from "@/lib/database-engine";

export const dynamic = "force-dynamic";

const REQUIRED_SCHEMA_MIGRATION =
  "20260717143000_safe_point_radius";
const SCHEMA_READINESS_CACHE_MS = 10_000;

let schemaReadyUntil = 0;
let schemaReadyEngine: SupportedDatabaseEngine | null = null;
let schemaReadinessInFlight: {
  engine: SupportedDatabaseEngine;
  promise: Promise<void>;
} | null = null;

type MigrationReadinessRow = {
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

type DatabaseProbeRow = {
  available: number | bigint | string;
  version: string;
  versionComment: string;
};

type MariaDbChecksRow = {
  globalCheckConstraintChecks: number | bigint | string;
  checkConstraintChecks: number | bigint | string;
};

type MySqlCheckEnforcementRow = {
  artifact: string;
  enforced: string;
};

type SchemaArtifactRow = {
  kind: "column" | "index" | "foreign-key" | "check";
  artifact: string;
  detail: string;
};

const REQUIRED_SCHEMA_ARTIFACTS = new Map<string, string>([
  ["column:Contribution.revision", "int|NO|1"],
  ["column:Contribution.incidentId", "varchar|NO|<null>"],
  ["column:Contribution.needId", "varchar|YES|<null>"],
  ["column:Contribution.safePointId", "varchar|NO|<null>"],
  ["column:Contribution.category", "enum|NO|OTHER"],
  ["column:Contribution.personalDataConsentAt", "datetime|YES|<null>"],
  ["column:Contribution.followUpConsentAt", "datetime|YES|<null>"],
  ["column:Contribution.piiExpiresAt", "datetime|YES|<null>"],
  ["column:SafePoint.pointStatus", "enum|NO|DRAFT"],
  ["column:SafePoint.pointType", "enum|NO|DROP_OFF"],
  ["column:SafePoint.publishedAt", "datetime|YES|<null>"],
  ["column:SafePoint.validatedAt", "datetime|YES|<null>"],
  ["column:SafePoint.validatedById", "varchar|YES|<null>"],
  ["column:SafePoint.radiusMeters", "int|NO|30"],
  ["column:Need.validatedAt", "datetime|YES|<null>"],
  ["column:Need.validatedById", "varchar|YES|<null>"],
  ["column:Incident.publicLocationApprovedAt", "datetime|YES|<null>"],
  ["column:Incident.publicLocationApprovedById", "varchar|YES|<null>"],
  ["column:Incident.publicRadiusMeters", "int|YES|<null>"],
  ["column:Incident.origin", "enum|NO|MANUAL"],
  ["column:Organization.verificationStatus", "enum|NO|UNVERIFIED"],
  ["column:Organization.notificationRadiusMeters", "int|NO|25000"],
  ["column:Organization.notificationCooldownMinutes", "int|NO|60"],
  ["column:OrganizationClaim.verificationTokenCiphertext", "text|YES|<null>"],
  ["column:NotificationOutbox.status", "enum|NO|PENDING"],
  ["column:NotificationOutbox.attempts", "int|NO|0"],
  ["column:NotificationOutbox.maxAttempts", "int|NO|5"],
  ["column:ExternalDetection.satellite", "varchar|YES|<null>"],
  ["column:ExternalDetection.instrument", "varchar|YES|<null>"],
  ["column:ExternalDetection.fireRadiativePowerMw", "decimal|YES|<null>"],
  ["column:ExternalDetection.footprintAreaHectares", "decimal|YES|<null>"],
  ["column:ExternalDetection.footprintJson", "json|YES|<null>"],
  ["column:ExternalDetection.provider", "varchar|YES|<null>"],
  ["column:ExternalDetection.providerStatus", "varchar|YES|<null>"],
  ["column:ExternalDetection.providerStatusChangedAt", "datetime|YES|<null>"],
  ["column:ExternalDetection.lastSeenAt", "datetime|YES|<null>"],
  ["column:ExternalSourceSync.lastAttemptAt", "datetime|NO|<null>"],
  [
    "index:ExternalDetection.ExternalDetection_status_detectedAt_idx.1",
    "status|A|1",
  ],
  [
    "index:ExternalDetection.ExternalDetection_status_detectedAt_idx.2",
    "detectedAt|A|1",
  ],
  [
    "index:ExternalDetection.ExternalDetection_provider_status_seen_idx.1",
    "provider|A|1",
  ],
  [
    "index:ExternalDetection.ExternalDetection_provider_status_seen_idx.2",
    "providerStatus|A|1",
  ],
  [
    "index:ExternalDetection.ExternalDetection_provider_status_seen_idx.3",
    "lastSeenAt|A|1",
  ],
  [
    "index:ExternalSourceSync.ExternalSourceSync_status_attempt_idx.1",
    "status|A|1",
  ],
  [
    "index:ExternalSourceSync.ExternalSourceSync_status_attempt_idx.2",
    "lastAttemptAt|A|1",
  ],
  ["index:SafePoint.SafePoint_public_idx.1", "incidentId|A|1"],
  ["index:SafePoint.SafePoint_public_idx.2", "isActive|A|1"],
  ["index:SafePoint.SafePoint_public_idx.3", "validatedAt|A|1"],
  ["index:SafePoint.SafePoint_dropoff_public_idx.1", "incidentId|A|1"],
  ["index:SafePoint.SafePoint_dropoff_public_idx.2", "pointStatus|A|1"],
  ["index:SafePoint.SafePoint_dropoff_public_idx.3", "publishedAt|A|1"],
  [
    "index:Contribution.Contribution_incident_status_updated_idx.1",
    "incidentId|A|1",
  ],
  [
    "index:Contribution.Contribution_incident_status_updated_idx.2",
    "status|A|1",
  ],
  [
    "index:Contribution.Contribution_incident_status_updated_idx.3",
    "updatedAt|A|1",
  ],
  [
    "index:Contribution.Contribution_queue_status_updated_created_idx.1",
    "status|A|1",
  ],
  [
    "index:Contribution.Contribution_queue_status_updated_created_idx.2",
    "updatedAt|A|1",
  ],
  [
    "index:Contribution.Contribution_queue_status_updated_created_idx.3",
    "createdAt|A|1",
  ],
  [
    "index:Incident.Incident_tenant_status_activity_idx.1",
    "municipalityId|A|1",
  ],
  ["index:Incident.Incident_tenant_status_activity_idx.2", "status|A|1"],
  [
    "index:Incident.Incident_tenant_status_activity_idx.3",
    "lastActivityAt|A|1",
  ],
  ["index:Incident.Incident_tenant_status_activity_idx.4", "createdAt|A|1"],
  ["index:Need.Need_incident_priority_created_id_idx.1", "incidentId|A|1"],
  ["index:Need.Need_incident_priority_created_id_idx.2", "priority|D|1"],
  ["index:Need.Need_incident_priority_created_id_idx.3", "createdAt|A|1"],
  ["index:Need.Need_incident_priority_created_id_idx.4", "id|A|1"],
  ["index:SafePoint.SafePoint_id_incidentId_key.1", "id|A|0"],
  ["index:SafePoint.SafePoint_id_incidentId_key.2", "incidentId|A|0"],
  ["index:Need.Need_id_safePointId_key.1", "id|A|0"],
  ["index:Need.Need_id_safePointId_key.2", "safePointId|A|0"],
  [
    "foreign-key:SafePoint.SafePoint_validatedById_fkey",
    "validatedById>User.id|SET NULL|CASCADE",
  ],
  [
    "foreign-key:Need.Need_validatedById_fkey",
    "validatedById>User.id|SET NULL|CASCADE",
  ],
  [
    "foreign-key:Need.Need_safePointId_incidentId_fkey.1",
    "safePointId>SafePoint.id|RESTRICT|CASCADE",
  ],
  [
    "foreign-key:Need.Need_safePointId_incidentId_fkey.2",
    "incidentId>SafePoint.incidentId|RESTRICT|CASCADE",
  ],
  [
    "foreign-key:Contribution.Contribution_needId_safePointId_fkey.1",
    "needId>Need.id|RESTRICT|CASCADE",
  ],
  [
    "foreign-key:Contribution.Contribution_needId_safePointId_fkey.2",
    "safePointId>Need.safePointId|RESTRICT|CASCADE",
  ],
  [
    "foreign-key:Contribution.Contribution_safePointId_incidentId_fkey.1",
    "safePointId>SafePoint.id|RESTRICT|CASCADE",
  ],
  [
    "foreign-key:Contribution.Contribution_safePointId_incidentId_fkey.2",
    "incidentId>SafePoint.incidentId|RESTRICT|CASCADE",
  ],
  [
    "foreign-key:Contribution.Contribution_incidentId_fkey",
    "incidentId>Incident.id|CASCADE|CASCADE",
  ],
]);

const REQUIRED_CHECK_FRAGMENTS = new Map<string, readonly string[]>([
  [
    "Need.Need_quantities_check",
    [
      "quantityneeded>0",
      "quantityreceived>=0",
      "quantityreceived<=quantityneeded",
    ],
  ],
  [
    "Contribution.Contribution_quantities_check",
    ["quantity>0", "deliveredquantity>=0", "deliveredquantity<=quantity"],
  ],
  [
    "Incident.Incident_publicRadiusMeters_floor_check",
    ["publicradiusmetersisnull", "publicradiusmetersbetween1500and100000"],
  ],
  [
    "Organization.Organization_notificationRadiusMeters_check",
    ["notificationradiusmetersbetween1000and200000"],
  ],
  [
    "Organization.Organization_notificationCooldownMinutes_check",
    ["notificationcooldownminutesbetween5and10080"],
  ],
]);

function normalizeCheckClause(value: string) {
  return value
    .replaceAll("`", "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/isnull\(([a-z0-9_.]+)\)/g, "$1isnull");
}

function normalizeSchemaArtifactDetail(
  row: SchemaArtifactRow,
  engine: SupportedDatabaseEngine,
) {
  if (engine !== "mariadb" || row.kind !== "column") return row.detail;

  const [dataType, nullable, ...defaultParts] = row.detail.split("|");
  const defaultValue = defaultParts.join("|");
  if (
    dataType &&
    nullable &&
    defaultValue.length >= 2 &&
    defaultValue.startsWith("'") &&
    defaultValue.endsWith("'")
  ) {
    return `${dataType}|${nullable}|${defaultValue.slice(1, -1)}`;
  }
  return row.detail;
}

function assertSchemaSignature(
  rows: SchemaArtifactRow[],
  engine: SupportedDatabaseEngine,
) {
  const artifacts = new Map(
    rows.map((row) => [
      `${row.kind}:${row.artifact}`,
      normalizeSchemaArtifactDetail(row, engine),
    ]),
  );
  const requiredArtifacts = new Map(REQUIRED_SCHEMA_ARTIFACTS);
  const requiredCheckFragments = new Map(REQUIRED_CHECK_FRAGMENTS);

  if (engine === "mariadb") {
    // MariaDB implements JSON as a LONGTEXT alias plus an enforced
    // JSON_VALID check. Require both halves of that contract explicitly.
    requiredArtifacts.set(
      "column:ExternalDetection.footprintJson",
      "longtext|YES|<null>",
    );
    requiredCheckFragments.set("ExternalDetection.footprintJson", [
      "json_valid(footprintjson)",
    ]);
  }
  const expectedArtifactCount =
    requiredArtifacts.size + requiredCheckFragments.size;

  // Exact cardinality also catches duplicate metadata and an index/FK that
  // retained the expected prefix but gained an unintended extra column.
  if (
    rows.length !== expectedArtifactCount ||
    artifacts.size !== expectedArtifactCount
  ) {
    throw new Error("DATABASE_SCHEMA_SIGNATURE_MISMATCH");
  }

  for (const [artifact, expectedDetail] of requiredArtifacts) {
    if (artifacts.get(artifact) !== expectedDetail) {
      throw new Error("DATABASE_SCHEMA_SIGNATURE_MISMATCH");
    }
  }

  for (const [artifact, requiredFragments] of requiredCheckFragments) {
    const clause = artifacts.get(`check:${artifact}`);
    if (!clause) {
      throw new Error("DATABASE_SCHEMA_SIGNATURE_MISMATCH");
    }
    const normalized = normalizeCheckClause(clause);
    if (!requiredFragments.every((fragment) => normalized.includes(fragment))) {
      throw new Error("DATABASE_SCHEMA_SIGNATURE_MISMATCH");
    }
  }
}

async function assertDatabaseAvailable(): Promise<SupportedDatabaseEngine> {
  const serverRows = await prisma.$queryRaw<DatabaseProbeRow[]>`
    SELECT
      1 AS available,
      VERSION() AS version,
      @@version_comment AS versionComment
  `;
  const server = serverRows[0];
  if (
    !server ||
    Number(server.available) !== 1 ||
    !databaseMeetsAnellaContract(server.version, server.versionComment)
  ) {
    throw new Error("DATABASE_ENGINE_UNSUPPORTED");
  }

  const engine = identifyDatabaseEngine(server.version, server.versionComment);
  if (engine === "unknown") {
    throw new Error("DATABASE_ENGINE_UNSUPPORTED");
  }

  if (engine === "mariadb") {
    const checkRows = await prisma.$queryRaw<MariaDbChecksRow[]>`
      SELECT
        @@SESSION.check_constraint_checks AS checkConstraintChecks,
        @@GLOBAL.check_constraint_checks AS globalCheckConstraintChecks
    `;
    if (
      Number(checkRows[0]?.checkConstraintChecks) !== 1 ||
      Number(checkRows[0]?.globalCheckConstraintChecks) !== 1
    ) {
      throw new Error("DATABASE_CHECKS_DISABLED");
    }
  }

  return engine;
}

async function assertSchemaReady(engine: SupportedDatabaseEngine) {
  const migrations = await prisma.$queryRaw<MigrationReadinessRow[]>`
    SELECT
      finished_at AS finishedAt,
      rolled_back_at AS rolledBackAt
    FROM _prisma_migrations
    WHERE migration_name = ${REQUIRED_SCHEMA_MIGRATION}
    LIMIT 1
  `;
  const migration = migrations[0];

  if (!migration?.finishedAt || migration.rolledBackAt) {
    throw new Error("DATABASE_SCHEMA_NOT_READY");
  }

  // One narrow metadata query checks a representative operational signature.
  // It reads no application rows and deliberately avoids running the full
  // deployment preflight on every readiness probe.
  const artifacts = await prisma.$queryRaw<SchemaArtifactRow[]>`
    SELECT
      'column' AS kind,
      CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS artifact,
      CONCAT(
        DATA_TYPE,
        '|',
        IS_NULLABLE,
        '|',
        CASE
          WHEN COLUMN_DEFAULT IS NULL
            OR UPPER(CAST(COLUMN_DEFAULT AS CHAR)) = 'NULL'
            THEN '<null>'
          ELSE CAST(COLUMN_DEFAULT AS CHAR)
        END
      ) AS detail
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (
          TABLE_NAME = 'Contribution'
          AND COLUMN_NAME IN (
            'revision',
            'incidentId',
            'needId',
            'safePointId',
            'category',
            'personalDataConsentAt',
            'followUpConsentAt',
            'piiExpiresAt'
          )
        )
        OR (
          TABLE_NAME = 'SafePoint'
          AND COLUMN_NAME IN (
            'pointStatus',
            'pointType',
            'publishedAt',
            'validatedAt',
            'validatedById',
            'radiusMeters'
          )
        )
        OR (TABLE_NAME = 'Need' AND COLUMN_NAME IN ('validatedAt', 'validatedById'))
        OR (
          TABLE_NAME = 'Incident'
          AND COLUMN_NAME IN (
            'publicLocationApprovedAt',
            'publicLocationApprovedById',
            'publicRadiusMeters',
            'origin'
          )
        )
        OR (
          TABLE_NAME = 'Organization'
          AND COLUMN_NAME IN (
            'verificationStatus',
            'notificationRadiusMeters',
            'notificationCooldownMinutes'
          )
        )
        OR (
          TABLE_NAME = 'OrganizationClaim'
          AND COLUMN_NAME = 'verificationTokenCiphertext'
        )
        OR (
          TABLE_NAME = 'NotificationOutbox'
          AND COLUMN_NAME IN ('status', 'attempts', 'maxAttempts')
        )
        OR (
          TABLE_NAME = 'ExternalDetection'
          AND COLUMN_NAME IN (
            'satellite',
            'instrument',
            'fireRadiativePowerMw',
            'footprintAreaHectares',
            'footprintJson',
            'provider',
            'providerStatus',
            'providerStatusChangedAt',
            'lastSeenAt'
          )
        )
        OR (
          TABLE_NAME = 'ExternalSourceSync'
          AND COLUMN_NAME = 'lastAttemptAt'
        )
      )

    UNION ALL

    SELECT
      'index' AS kind,
      CONCAT(TABLE_NAME, '.', INDEX_NAME, '.', SEQ_IN_INDEX) AS artifact,
      CONCAT(
        COLUMN_NAME,
        '|',
        COALESCE(COLLATION, '<null>'),
        '|',
        NON_UNIQUE
      ) AS detail
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'SafePoint' AND INDEX_NAME = 'SafePoint_public_idx')
        OR (
          TABLE_NAME = 'SafePoint'
          AND INDEX_NAME = 'SafePoint_dropoff_public_idx'
        )
        OR (
          TABLE_NAME = 'Contribution'
          AND INDEX_NAME = 'Contribution_incident_status_updated_idx'
        )
        OR (
          TABLE_NAME = 'Contribution'
          AND INDEX_NAME = 'Contribution_queue_status_updated_created_idx'
        )
        OR (
          TABLE_NAME = 'Incident'
          AND INDEX_NAME = 'Incident_tenant_status_activity_idx'
        )
        OR (
          TABLE_NAME = 'Need'
          AND INDEX_NAME = 'Need_incident_priority_created_id_idx'
        )
        OR (
          TABLE_NAME = 'SafePoint'
          AND INDEX_NAME = 'SafePoint_id_incidentId_key'
        )
        OR (
          TABLE_NAME = 'Need'
          AND INDEX_NAME = 'Need_id_safePointId_key'
        )
        OR (
          TABLE_NAME = 'ExternalDetection'
          AND INDEX_NAME = 'ExternalDetection_status_detectedAt_idx'
        )
        OR (
          TABLE_NAME = 'ExternalDetection'
          AND INDEX_NAME = 'ExternalDetection_provider_status_seen_idx'
        )
        OR (
          TABLE_NAME = 'ExternalSourceSync'
          AND INDEX_NAME = 'ExternalSourceSync_status_attempt_idx'
        )
      )

    UNION ALL

    SELECT
      'foreign-key' AS kind,
      CONCAT(
        kcu.TABLE_NAME,
        '.',
        kcu.CONSTRAINT_NAME,
        CASE
          WHEN kcu.CONSTRAINT_NAME IN (
            'Need_safePointId_incidentId_fkey',
            'Contribution_needId_safePointId_fkey',
            'Contribution_safePointId_incidentId_fkey'
          ) THEN CONCAT('.', kcu.ORDINAL_POSITION)
          ELSE ''
        END
      ) AS artifact,
      CONCAT(
        kcu.COLUMN_NAME,
        '>',
        kcu.REFERENCED_TABLE_NAME,
        '.',
        kcu.REFERENCED_COLUMN_NAME,
        '|',
        rc.DELETE_RULE,
        '|',
        rc.UPDATE_RULE
      ) AS detail
    FROM information_schema.KEY_COLUMN_USAGE AS kcu
    INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
      ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
      AND (
        (
          kcu.TABLE_NAME = 'SafePoint'
          AND kcu.CONSTRAINT_NAME = 'SafePoint_validatedById_fkey'
        )
        OR (
          kcu.TABLE_NAME = 'Need'
          AND kcu.CONSTRAINT_NAME = 'Need_validatedById_fkey'
        )
        OR (
          kcu.TABLE_NAME = 'Need'
          AND kcu.CONSTRAINT_NAME = 'Need_safePointId_incidentId_fkey'
        )
        OR (
          kcu.TABLE_NAME = 'Contribution'
          AND kcu.CONSTRAINT_NAME IN (
            'Contribution_needId_safePointId_fkey',
            'Contribution_safePointId_incidentId_fkey',
            'Contribution_incidentId_fkey'
          )
        )
      )

    UNION ALL

    SELECT
      'check' AS kind,
      CONCAT(tc.TABLE_NAME, '.', tc.CONSTRAINT_NAME) AS artifact,
      cc.CHECK_CLAUSE AS detail
    FROM information_schema.TABLE_CONSTRAINTS AS tc
    INNER JOIN information_schema.CHECK_CONSTRAINTS AS cc
      ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
      AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
      AND tc.CONSTRAINT_TYPE = 'CHECK'
      AND (
        (tc.TABLE_NAME = 'Need' AND tc.CONSTRAINT_NAME = 'Need_quantities_check')
        OR (
          tc.TABLE_NAME = 'Contribution'
          AND tc.CONSTRAINT_NAME = 'Contribution_quantities_check'
        )
        OR (
          tc.TABLE_NAME = 'Incident'
          AND tc.CONSTRAINT_NAME = 'Incident_publicRadiusMeters_floor_check'
        )
        OR (
          tc.TABLE_NAME = 'ExternalDetection'
          AND tc.CONSTRAINT_NAME = 'footprintJson'
        )
        OR (
          tc.TABLE_NAME = 'Organization'
          AND tc.CONSTRAINT_NAME IN (
            'Organization_notificationRadiusMeters_check',
            'Organization_notificationCooldownMinutes_check'
          )
        )
      )
  `;
  assertSchemaSignature(artifacts, engine);

  if (engine === "mysql") {
    const enforcement = await prisma.$queryRaw<MySqlCheckEnforcementRow[]>`
      SELECT
        CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) AS artifact,
        ENFORCED AS enforced
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_TYPE = 'CHECK'
        AND (
          (TABLE_NAME = 'Need' AND CONSTRAINT_NAME = 'Need_quantities_check')
          OR (
            TABLE_NAME = 'Contribution'
            AND CONSTRAINT_NAME = 'Contribution_quantities_check'
          )
          OR (
            TABLE_NAME = 'Incident'
            AND CONSTRAINT_NAME = 'Incident_publicRadiusMeters_floor_check'
          )
          OR (
            TABLE_NAME = 'Organization'
            AND CONSTRAINT_NAME IN (
              'Organization_notificationRadiusMeters_check',
              'Organization_notificationCooldownMinutes_check'
            )
          )
        )
    `;
    const expected = new Set(REQUIRED_CHECK_FRAGMENTS.keys());
    if (
      enforcement.length !== expected.size ||
      enforcement.some(
        (row) =>
          !expected.delete(row.artifact) ||
          row.enforced.toUpperCase() !== "YES",
      ) ||
      expected.size !== 0
    ) {
      throw new Error("DATABASE_CHECKS_NOT_ENFORCED");
    }
  }
}

async function assertCachedSchemaReady(
  engine: SupportedDatabaseEngine,
  now = Date.now(),
) {
  if (engine === schemaReadyEngine && now < schemaReadyUntil) return;
  if (!schemaReadinessInFlight) {
    const promise = assertSchemaReady(engine)
      .then(() => {
        schemaReadyEngine = engine;
        schemaReadyUntil = Date.now() + SCHEMA_READINESS_CACHE_MS;
      })
      .finally(() => {
        schemaReadinessInFlight = null;
      });
    schemaReadinessInFlight = { engine, promise };
  } else if (schemaReadinessInFlight.engine !== engine) {
    await schemaReadinessInFlight.promise;
    return assertCachedSchemaReady(engine, now);
  }
  await schemaReadinessInFlight.promise;
}

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    // Keep a live database probe on every request while caching only the
    // comparatively expensive information_schema signature for 10 seconds.
    const engine = await assertDatabaseAvailable();
    await assertCachedSchemaReady(engine);
    return NextResponse.json(
      {
        ok: true,
        service: "anella",
        database: "available",
        version: getDeploymentVersion(),
        timestamp,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json(
      {
        ok: false,
        service: "anella",
        database: "unavailable",
        timestamp,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
