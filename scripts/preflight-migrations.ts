import { createConnection, type Connection } from "mariadb";

import {
  databaseEngineLabel,
  databaseMeetsAnellaContract,
  identifyDatabaseEngine,
} from "../src/lib/database-engine";

type FindingLevel = "ok" | "warning" | "blocker";

type Finding = {
  level: FindingLevel;
  message: string;
};

type CountRow = {
  count: number | bigint | string;
};

type ServerRow = {
  version: string;
  versionComment: string;
};

type MariaDbChecksRow = {
  globalCheckConstraintChecks: number | bigint | string;
  checkConstraintChecks: number | bigint | string;
};

type NameRow = {
  name: string;
};

type ConstraintRow = {
  name: string;
  clause: string;
  enforced: string;
};

const INITIAL_MIGRATION = "20260709230452_init";
const OPERATIONAL_SAFETY_MIGRATION = "20260713095737_operational_safety";
const SAFE_POINT_VALIDATION_MIGRATION = "20260713143000_safe_point_validation";
const QUEUE_INDEX_MIGRATION = "20260713125000_queue_indexes";
const PUBLIC_RADIUS_FLOOR_MIGRATION = "20260713150000_public_radius_floor";
const LEGACY_PUBLIC_RADIUS_CHECK = "Incident_publicRadiusMeters_check";
const PUBLIC_RADIUS_FLOOR_CHECK = "Incident_publicRadiusMeters_floor_check";
const QUEUE_SORT_INDEX_MIGRATION = "20260713153000_queue_sort_indexes";
const CONTRIBUTION_QUEUE_INDEX_MIGRATION =
  "20260713170000_contribution_queue_indexes";
const INCIDENT_DETAIL_INDEX_MIGRATION =
  "20260713183000_incident_detail_indexes";
const DESTINATION_INVARIANT_MIGRATION = "20260713203000_destination_invariants";
const AUTOMATIC_FIRE_INGESTION_MIGRATION =
  "20260714143000_automatic_fire_ingestion";
const EXTERNAL_FIRE_SOURCE_HEALTH_MIGRATION =
  "20260714180000_external_fire_source_health";
const EMERGENCY_COORDINATION_MIGRATION =
  "20260716130000_emergency_contribution_coordination";
const CLAIM_TOKEN_ENCRYPTION_MIGRATION =
  "20260716131500_claim_token_encryption";
const CONTRIBUTION_INCIDENT_CASCADE_MIGRATION =
  "20260716133000_contribution_incident_cascade";
const SAFE_POINT_RADIUS_MIGRATION = "20260717143000_safe_point_radius";

const BASE_TABLES = [
  "Municipality",
  "Organization",
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Incident",
  "SafePoint",
  "Need",
  "Contribution",
  "SubmissionThrottle",
  "ExternalDetection",
  "AuditLog",
] as const;

const OPERATIONAL_SAFETY_COLUMNS = [
  "AuditLog.municipalityId",
  "Contribution.cancelledAt",
  "Contribution.revision",
  "Contribution.statusReason",
  "ExternalDetection.municipalityId",
  "Incident.closedAt",
  "Incident.closedReason",
  "Incident.lastActivityAt",
  "Incident.publicLatitude",
  "Incident.publicLocationApprovedAt",
  "Incident.publicLocationApprovedById",
  "Incident.publicLocationLabel",
  "Incident.publicLocationMode",
  "Incident.publicLongitude",
  "Incident.publicRadiusMeters",
  "Incident.timeZone",
  "Need.cancellationReason",
  "Need.cancelledAt",
  "Need.publishedAt",
  "Need.requestedById",
  "Need.requestingOrganizationId",
  "Need.validatedAt",
  "Need.validatedById",
  "SafePoint.deactivatedAt",
  "SafePoint.deactivationReason",
  "User.credentialsChangedAt",
  "User.disabledAt",
  "User.mustChangePassword",
  "User.sessionVersion",
] as const;

const SAFE_POINT_VALIDATION_COLUMNS = [
  "SafePoint.validatedById",
  "SafePoint.validatedAt",
] as const;

const SAFE_POINT_RADIUS_COLUMNS = ["SafePoint.radiusMeters"] as const;

const OPERATIONAL_CHECKS = [
  "Incident_operationalLatitude_check",
  "Incident_operationalLongitude_check",
  "Incident_radiusMeters_check",
  "Incident_publicCoordinates_pair_check",
  "Incident_publicLatitude_check",
  "Incident_publicLongitude_check",
  LEGACY_PUBLIC_RADIUS_CHECK,
  "SafePoint_latitude_check",
  "SafePoint_longitude_check",
  "Need_quantities_check",
  "Contribution_quantities_check",
] as const;

const OPERATIONAL_SAFETY_INDEXES = [
  "AuditLog.AuditLog_incidentId_createdAt_idx",
  "AuditLog.AuditLog_municipalityId_createdAt_idx",
  "Contribution.Contribution_status_updatedAt_idx",
  "Contribution.Contribution_needId_status_eta_idx",
  "ExternalDetection.ExternalDetection_municipalityId_status_detectedAt_idx",
  "Incident.Incident_municipalityId_status_priority_lastActivityAt_idx",
  "Incident.Incident_municipalityId_lastActivityAt_idx",
  "Need.Need_incidentId_updatedAt_idx",
  "Need.Need_status_deadline_idx",
  "Need.Need_requestingOrganizationId_idx",
  "Need.Need_requestedById_idx",
  "Need.Need_validatedById_idx",
] as const;

const OPERATIONAL_SAFETY_FOREIGN_KEYS = [
  "Incident.Incident_publicLocationApprovedById_fkey",
  "Need.Need_requestingOrganizationId_fkey",
  "Need.Need_requestedById_fkey",
  "Need.Need_validatedById_fkey",
  "ExternalDetection.ExternalDetection_municipalityId_fkey",
] as const;

const QUEUE_INDEXES = [
  "Incident.Incident_public_queue_idx",
  "SafePoint.SafePoint_incident_active_idx",
  "Need.Need_incident_status_deadline_idx",
] as const;

const SAFE_POINT_VALIDATION_INDEXES = [
  "SafePoint.SafePoint_public_idx",
  "SafePoint.SafePoint_validatedById_idx",
] as const;

const SAFE_POINT_VALIDATION_FOREIGN_KEYS = [
  "SafePoint.SafePoint_validatedById_fkey",
] as const;

const QUEUE_SORT_INDEXES = [
  "Incident.Incident_tenant_status_activity_idx",
  "Incident.Incident_tenant_activity_idx",
  "Incident.Incident_tenant_created_idx",
  "Incident.Incident_tenant_priority_idx",
] as const;

const CONTRIBUTION_QUEUE_INDEXES = [
  "Contribution.Contribution_queue_status_updated_created_idx",
  "Contribution.Contribution_queue_updated_created_idx",
] as const;

const INCIDENT_DETAIL_INDEXES = [
  "Need.Need_incident_priority_created_id_idx",
] as const;

const DESTINATION_INVARIANT_INDEXES = [
  "SafePoint.SafePoint_id_incidentId_key",
  "Need.Need_id_safePointId_key",
] as const;

const DESTINATION_INVARIANT_FOREIGN_KEYS = [
  "Need.Need_safePointId_incidentId_fkey",
  "Contribution.Contribution_needId_safePointId_fkey",
] as const;

const AUTOMATIC_FIRE_INGESTION_COLUMNS = [
  "ExternalDetection.satellite",
  "ExternalDetection.instrument",
  "ExternalDetection.fireRadiativePowerMw",
  "ExternalDetection.footprintAreaHectares",
  "ExternalDetection.footprintJson",
] as const;

const AUTOMATIC_FIRE_INGESTION_INDEXES = [
  "ExternalDetection.ExternalDetection_status_detectedAt_idx",
] as const;

const EXTERNAL_FIRE_SOURCE_HEALTH_COLUMNS = [
  "ExternalDetection.provider",
  "ExternalDetection.providerStatus",
  "ExternalDetection.providerStatusChangedAt",
  "ExternalDetection.lastSeenAt",
  "ExternalSourceSync.sourceKey",
  "ExternalSourceSync.source",
  "ExternalSourceSync.label",
  "ExternalSourceSync.status",
  "ExternalSourceSync.lastAttemptAt",
  "ExternalSourceSync.lastSuccessAt",
  "ExternalSourceSync.lastFailureAt",
  "ExternalSourceSync.received",
  "ExternalSourceSync.rejected",
  "ExternalSourceSync.imported",
  "ExternalSourceSync.updated",
  "ExternalSourceSync.statusChanged",
  "ExternalSourceSync.durationMs",
  "ExternalSourceSync.error",
  "ExternalSourceSync.createdAt",
  "ExternalSourceSync.updatedAt",
] as const;

const EXTERNAL_FIRE_SOURCE_HEALTH_TABLES = ["ExternalSourceSync"] as const;

const EXTERNAL_FIRE_SOURCE_HEALTH_INDEXES = [
  "ExternalDetection.ExternalDetection_provider_status_seen_idx",
  "ExternalSourceSync.ExternalSourceSync_status_attempt_idx",
] as const;

const EMERGENCY_COORDINATION_COLUMNS = [
  "Organization.verificationStatus",
  "Organization.verifiedAt",
  "Organization.verifiedById",
  "Organization.notificationEnabled",
  "Organization.notificationRadiusMeters",
  "Organization.notificationCooldownMinutes",
  "Incident.origin",
  "SafePoint.organizationId",
  "SafePoint.pointType",
  "SafePoint.pointStatus",
  "SafePoint.publishedAt",
  "SafePoint.closedAt",
  "Contribution.incidentId",
  "Contribution.category",
  "Contribution.origin",
  "Contribution.description",
  "Contribution.unit",
  "Contribution.personalDataConsentAt",
  "Contribution.followUpConsentAt",
  "Contribution.piiExpiresAt",
] as const;

const CLAIM_TOKEN_ENCRYPTION_COLUMNS = [
  "OrganizationClaim.verificationTokenCiphertext",
] as const;

const EMERGENCY_COORDINATION_TABLES = [
  "IncidentMunicipality",
  "IncidentNotice",
  "OrganizationDomain",
  "OrganizationClaim",
  "NotificationOutbox",
] as const;

const EMERGENCY_COORDINATION_INDEXES = [
  "Organization.Organization_verificationStatus_municipalityId_idx",
  "Organization.Organization_verifiedById_idx",
  "SafePoint.SafePoint_organizationId_idx",
  "SafePoint.SafePoint_dropoff_public_idx",
  "Contribution.Contribution_incident_status_updated_idx",
  "Contribution.Contribution_dropoff_category_status_eta_idx",
  "Contribution.Contribution_pii_expiry_idx",
  "IncidentMunicipality.IncidentMunicipality_municipalityId_incidentId_idx",
  "IncidentNotice.IncidentNotice_incidentId_status_publishedAt_idx",
  "IncidentNotice.IncidentNotice_organizationId_createdAt_idx",
  "OrganizationDomain.OrganizationDomain_domain_key",
  "OrganizationDomain.OrganizationDomain_organizationId_isVerified_idx",
  "OrganizationClaim.OrganizationClaim_verificationTokenHash_key",
  "OrganizationClaim.OrganizationClaim_status_createdAt_idx",
  "OrganizationClaim.OrganizationClaim_organizationId_claimantEmail_status_idx",
  "OrganizationClaim.OrganizationClaim_municipalityId_status_idx",
  "OrganizationClaim.OrganizationClaim_piiExpiresAt_idx",
  "NotificationOutbox.NotificationOutbox_idempotencyKey_key",
  "NotificationOutbox.NotificationOutbox_status_notBefore_createdAt_idx",
  "NotificationOutbox.NotificationOutbox_organizationId_kind_createdAt_idx",
  "NotificationOutbox.NotificationOutbox_municipalityId_kind_createdAt_idx",
  "NotificationOutbox.NotificationOutbox_incidentId_kind_createdAt_idx",
] as const;

const EMERGENCY_COORDINATION_FOREIGN_KEYS = [
  "Organization.Organization_verifiedById_fkey",
  "SafePoint.SafePoint_organizationId_fkey",
  "Contribution.Contribution_incidentId_fkey",
  "Contribution.Contribution_safePointId_incidentId_fkey",
  "Contribution.Contribution_needId_safePointId_fkey",
  "IncidentMunicipality.IncidentMunicipality_incidentId_fkey",
  "IncidentMunicipality.IncidentMunicipality_municipalityId_fkey",
  "IncidentNotice.IncidentNotice_incidentId_fkey",
  "IncidentNotice.IncidentNotice_organizationId_fkey",
  "IncidentNotice.IncidentNotice_createdById_fkey",
  "OrganizationDomain.OrganizationDomain_organizationId_fkey",
  "OrganizationClaim.OrganizationClaim_organizationId_fkey",
  "OrganizationClaim.OrganizationClaim_municipalityId_fkey",
  "OrganizationClaim.OrganizationClaim_reviewedById_fkey",
  "NotificationOutbox.NotificationOutbox_incidentId_fkey",
  "NotificationOutbox.NotificationOutbox_municipalityId_fkey",
  "NotificationOutbox.NotificationOutbox_organizationId_fkey",
  "NotificationOutbox.NotificationOutbox_organizationClaimId_fkey",
] as const;

const EMERGENCY_COORDINATION_CHECKS = [
  "Organization_notificationRadiusMeters_check",
  "Organization_notificationCooldownMinutes_check",
  "NotificationOutbox_attempts_check",
] as const;

const CONTRIBUTION_INCIDENT_CASCADE_RULES = [
  "Contribution.Contribution_incidentId_fkey",
] as const;

function addFinding(findings: Finding[], level: FindingLevel, message: string) {
  findings.push({ level, message });
}

function asNumber(value: number | bigint | string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      "MySQL devolvió un recuento no representable de forma segura",
    );
  }
  return parsed;
}

async function count(connection: Connection, sql: string) {
  const rows = await connection.query<CountRow[]>(sql);
  const row = rows[0];
  if (!row) throw new Error("MySQL no devolvió el recuento esperado");
  return asNumber(row.count);
}

function connectionUri() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL no está configurada");

  const url = new URL(raw);
  if (url.protocol !== "mysql:") {
    throw new Error("DATABASE_URL debe usar el protocolo mysql://");
  }

  // El conector MariaDB usado por Prisma habla con MySQL, pero exige este
  // alias de protocolo. Se conserva el resto de la URL, incluidos parámetros
  // TLS, y nunca se imprime la credencial.
  url.protocol = "mariadb:";
  if (url.searchParams.get("sslaccept") === "strict") {
    url.searchParams.delete("sslaccept");
    url.searchParams.set("ssl", "true");
  }
  return url.toString();
}

async function loadNames(
  connection: Connection,
  sql: string,
): Promise<Set<string>> {
  const rows = await connection.query<NameRow[]>(sql);
  return new Set(rows.map((row) => row.name));
}

function validateMigrationArtifacts(
  findings: Finding[],
  appliedMigrations: Set<string>,
  columns: Set<string>,
  migration: string,
  expectedColumns: readonly string[],
) {
  const present = expectedColumns.filter((column) => columns.has(column));
  const isApplied = appliedMigrations.has(migration);

  if (isApplied && present.length !== expectedColumns.length) {
    const missing = expectedColumns.length - present.length;
    addFinding(
      findings,
      "blocker",
      `${migration} figura aplicada, pero faltan ${missing} columnas esperadas; hay deriva de esquema.`,
    );
    return;
  }

  if (!isApplied && present.length > 0) {
    addFinding(
      findings,
      "blocker",
      `${migration} no figura aplicada, pero ya existen ${present.length} de sus columnas; puede haber una migración parcial o cambios manuales.`,
    );
    return;
  }

  addFinding(
    findings,
    "ok",
    isApplied
      ? `${migration} conserva todas sus columnas esperadas.`
      : `${migration} está pendiente y no deja artefactos parciales.`,
  );
}

function validateNamedMigrationArtifacts(
  findings: Finding[],
  appliedMigrations: Set<string>,
  presentArtifacts: Set<string>,
  migration: string,
  expectedArtifacts: readonly string[],
  label: string,
) {
  const present = expectedArtifacts.filter((artifact) =>
    presentArtifacts.has(artifact),
  );
  const isApplied = appliedMigrations.has(migration);

  if (isApplied && present.length !== expectedArtifacts.length) {
    addFinding(
      findings,
      "blocker",
      `${migration} figura aplicada, pero faltan ${expectedArtifacts.length - present.length} ${label}; hay deriva de esquema.`,
    );
    return;
  }

  if (!isApplied && present.length > 0) {
    addFinding(
      findings,
      "blocker",
      `${migration} no figura aplicada, pero ya existen ${present.length} ${label}; puede haber una migración parcial o cambios manuales.`,
    );
    return;
  }

  addFinding(
    findings,
    "ok",
    isApplied
      ? `${migration} conserva todos sus ${label}.`
      : `${migration} está pendiente y no deja ${label} parciales.`,
  );
}

async function runDataChecks(
  connection: Connection,
  findings: Finding[],
  columns: Set<string>,
  appliedMigrations: Set<string>,
) {
  const checks = [
    {
      label: "coordenadas y radio operativos de incidentes",
      sql: `SELECT COUNT(*) AS count
            FROM \`Incident\`
            WHERE \`latitude\` IS NULL OR \`latitude\` NOT BETWEEN -90 AND 90
               OR \`longitude\` IS NULL OR \`longitude\` NOT BETWEEN -180 AND 180
               OR \`radiusMeters\` IS NULL OR \`radiusMeters\` NOT BETWEEN 100 AND 100000`,
    },
    {
      label: "coordenadas y radio de puntos seguros",
      sql: `SELECT COUNT(*) AS count
            FROM \`SafePoint\`
            WHERE \`latitude\` IS NULL OR \`latitude\` NOT BETWEEN -90 AND 90
               OR \`longitude\` IS NULL OR \`longitude\` NOT BETWEEN -180 AND 180${
                 columns.has("SafePoint.radiusMeters")
                   ? " OR `radiusMeters` IS NULL OR `radiusMeters` NOT BETWEEN 10 AND 200"
                   : ""
               }`,
    },
    {
      label: "cantidades de necesidades",
      sql: `SELECT COUNT(*) AS count
            FROM \`Need\`
            WHERE \`quantityNeeded\` IS NULL OR \`quantityNeeded\` <= 0
               OR \`quantityReceived\` IS NULL OR \`quantityReceived\` < 0
               OR \`quantityReceived\` > \`quantityNeeded\``,
    },
    {
      label: "cantidades de aportaciones",
      sql: `SELECT COUNT(*) AS count
            FROM \`Contribution\`
            WHERE \`quantity\` IS NULL OR \`quantity\` <= 0
               OR \`deliveredQuantity\` IS NULL OR \`deliveredQuantity\` < 0
               OR \`deliveredQuantity\` > \`quantity\``,
    },
  ] as const;

  for (const check of checks) {
    const invalid = await count(connection, check.sql);
    addFinding(
      findings,
      invalid === 0 ? "ok" : "blocker",
      invalid === 0
        ? `No hay valores incompatibles en ${check.label}.`
        : `${invalid} filas incumplen ${check.label}; corrígelas y vuelve a ejecutar el preflight.`,
    );
  }

  const crossIncidentNeeds = await count(
    connection,
    `SELECT COUNT(*) AS count
     FROM \`Need\` AS need
     INNER JOIN \`SafePoint\` AS point ON point.\`id\` = need.\`safePointId\`
     WHERE need.\`incidentId\` <> point.\`incidentId\``,
  );
  addFinding(
    findings,
    crossIncidentNeeds === 0 ? "ok" : "blocker",
    crossIncidentNeeds === 0
      ? "Cada necesidad pertenece al mismo incidente que su punto seguro."
      : `${crossIncidentNeeds} necesidades apuntan a un punto de otro incidente; revísalas antes de migrar.`,
  );

  const crossTenantPoints = await count(
    connection,
    `SELECT COUNT(*) AS count
     FROM \`SafePoint\` AS point
     INNER JOIN \`Incident\` AS incident ON incident.\`id\` = point.\`incidentId\`
     WHERE point.\`municipalityId\` IS NOT NULL
       AND incident.\`municipalityId\` IS NOT NULL
       AND point.\`municipalityId\` <> incident.\`municipalityId\``,
  );
  addFinding(
    findings,
    crossTenantPoints === 0 ? "ok" : "blocker",
    crossTenantPoints === 0
      ? "Los puntos seguros con municipio coinciden con el tenant de su incidente."
      : `${crossTenantPoints} puntos seguros tienen un municipio distinto al de su incidente.`,
  );

  const contributionDestinationMismatches = await count(
    connection,
    `SELECT COUNT(*) AS count
     FROM \`Contribution\` AS contribution
     INNER JOIN \`Need\` AS need ON need.\`id\` = contribution.\`needId\`
     WHERE contribution.\`safePointId\` IS NOT NULL
       AND contribution.\`safePointId\` <> need.\`safePointId\``,
  );
  addFinding(
    findings,
    contributionDestinationMismatches === 0 ? "ok" : "blocker",
    contributionDestinationMismatches === 0
      ? "Las aportaciones con destino coinciden con el punto de su necesidad."
      : `${contributionDestinationMismatches} aportaciones apuntan a un punto distinto al de su necesidad.`,
  );

  const contributionsWithoutDestination = await count(
    connection,
    `SELECT COUNT(*) AS count
     FROM \`Contribution\`
     WHERE \`safePointId\` IS NULL`,
  );
  const destinationInvariantApplied = appliedMigrations.has(
    DESTINATION_INVARIANT_MIGRATION,
  );
  addFinding(
    findings,
    contributionsWithoutDestination === 0
      ? "ok"
      : destinationInvariantApplied
        ? "blocker"
        : "warning",
    contributionsWithoutDestination === 0
      ? "Todas las aportaciones conservan un destino seguro explícito."
      : destinationInvariantApplied
        ? `${contributionsWithoutDestination} aportaciones no tienen destino aunque la invariante figura aplicada.`
        : `${contributionsWithoutDestination} aportaciones heredadas recuperarán el punto ya asignado a su necesidad y quedarán auditadas por la migración.`,
  );

  if (appliedMigrations.has(EMERGENCY_COORDINATION_MIGRATION)) {
    const directContributionMismatches = await count(
      connection,
      `SELECT COUNT(*) AS count
       FROM \`Contribution\` AS contribution
       LEFT JOIN \`SafePoint\` AS point
         ON point.\`id\` = contribution.\`safePointId\`
        AND point.\`incidentId\` = contribution.\`incidentId\`
       WHERE contribution.\`incidentId\` IS NULL
          OR point.\`id\` IS NULL`,
    );
    addFinding(
      findings,
      directContributionMismatches === 0 ? "ok" : "blocker",
      directContributionMismatches === 0
        ? "Cada aportación depende directamente de su emergencia y punto de entrega."
        : `${directContributionMismatches} aportaciones no coinciden con su emergencia o punto de entrega.`,
    );

    const invalidOrganizationNotificationPolicy = await count(
      connection,
      `SELECT COUNT(*) AS count
       FROM \`Organization\`
       WHERE \`notificationRadiusMeters\` NOT BETWEEN 1000 AND 200000
          OR \`notificationCooldownMinutes\` NOT BETWEEN 5 AND 10080`,
    );
    addFinding(
      findings,
      invalidOrganizationNotificationPolicy === 0 ? "ok" : "blocker",
      invalidOrganizationNotificationPolicy === 0
        ? "Los radios y cooldowns de notificación respetan los límites seguros."
        : `${invalidOrganizationNotificationPolicy} organizaciones tienen una política de avisos fuera de límites.`,
    );

    const invalidOutboxAttempts = await count(
      connection,
      `SELECT COUNT(*) AS count
       FROM \`NotificationOutbox\`
       WHERE \`attempts\` < 0
          OR \`maxAttempts\` NOT BETWEEN 1 AND 20
          OR \`attempts\` > \`maxAttempts\``,
    );
    addFinding(
      findings,
      invalidOutboxAttempts === 0 ? "ok" : "blocker",
      invalidOutboxAttempts === 0
        ? "La outbox conserva límites coherentes de reintentos."
        : `${invalidOutboxAttempts} notificaciones incumplen los límites de reintento.`,
    );
  }

  const publicColumns = [
    "Incident.publicLatitude",
    "Incident.publicLongitude",
    "Incident.publicRadiusMeters",
  ];
  if (publicColumns.every((column) => columns.has(column))) {
    const invalidPublicValues = await count(
      connection,
      `SELECT COUNT(*) AS count
       FROM \`Incident\`
       WHERE (\`publicLatitude\` IS NULL) <> (\`publicLongitude\` IS NULL)
          OR (\`publicLatitude\` IS NOT NULL AND \`publicLatitude\` NOT BETWEEN -90 AND 90)
          OR (\`publicLongitude\` IS NOT NULL AND \`publicLongitude\` NOT BETWEEN -180 AND 180)
          OR (\`publicRadiusMeters\` IS NOT NULL AND \`publicRadiusMeters\` NOT BETWEEN 1000 AND 100000)`,
    );
    addFinding(
      findings,
      invalidPublicValues === 0 ? "ok" : "blocker",
      invalidPublicValues === 0
        ? "Las áreas públicas cumplen el rango histórico y el par de coordenadas."
        : `${invalidPublicValues} incidentes tienen un área pública incompatible con las migraciones.`,
    );

    const radiiToGeneralize = await count(
      connection,
      `SELECT COUNT(*) AS count
       FROM \`Incident\`
       WHERE \`publicRadiusMeters\` >= 1000
         AND \`publicRadiusMeters\` < 1500`,
    );
    const floorApplied = appliedMigrations.has(PUBLIC_RADIUS_FLOOR_MIGRATION);

    addFinding(
      findings,
      radiiToGeneralize === 0 ? "ok" : floorApplied ? "blocker" : "warning",
      radiiToGeneralize === 0
        ? "Ningún radio público queda por debajo del mínimo de privacidad de 1.500 m."
        : floorApplied
          ? `${radiiToGeneralize} radios públicos siguen por debajo de 1.500 m aunque la corrección figura aplicada.`
          : `${radiiToGeneralize} radios públicos se generalizarán a 1.500 m; no se modifican coordenadas ni radios operativos.`,
    );
  }
}

async function inspectDatabase(connection: Connection) {
  const findings: Finding[] = [];
  const serverRows = await connection.query<ServerRow[]>(
    `SELECT
       VERSION() AS version,
       @@version_comment AS versionComment`,
  );
  const server = serverRows[0];
  if (!server)
    throw new Error("No se pudo identificar el motor de base de datos");

  const supported = databaseMeetsAnellaContract(
    server.version,
    server.versionComment,
  );
  const engine = identifyDatabaseEngine(server.version, server.versionComment);
  const engineLabel = databaseEngineLabel(
    server.version,
    server.versionComment,
  );
  addFinding(
    findings,
    supported ? "ok" : "blocker",
    supported
      ? `${engineLabel} ${server.version} cumple el contrato de base de datos certificado de Anella.`
      : `El servidor ${server.version} no pertenece al contrato certificado (MySQL 8.0.16+ o MariaDB 11.8+).`,
  );
  if (!supported) return findings;

  if (engine === "mariadb") {
    const checkRows = await connection.query<MariaDbChecksRow[]>(
      `SELECT
         @@SESSION.check_constraint_checks AS checkConstraintChecks,
         @@GLOBAL.check_constraint_checks AS globalCheckConstraintChecks`,
    );
    const sessionChecksEnabled =
      Number(checkRows[0]?.checkConstraintChecks) === 1;
    const globalChecksEnabled =
      Number(checkRows[0]?.globalCheckConstraintChecks) === 1;
    const checksEnabled = sessionChecksEnabled && globalChecksEnabled;
    addFinding(
      findings,
      checksEnabled ? "ok" : "blocker",
      checksEnabled
        ? "MariaDB aplica CHECK tanto globalmente como en la sesión de preflight."
        : "MariaDB debe mantener check_constraint_checks=ON globalmente y en la sesión; no es seguro migrar.",
    );
  }

  const tables = await loadNames(
    connection,
    `SELECT TABLE_NAME AS name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const presentBaseTables = BASE_TABLES.filter((table) => tables.has(table));

  if (presentBaseTables.length === 0) {
    addFinding(
      findings,
      "ok",
      "La base no contiene tablas de Anella: el despliegue inicial puede crear el esquema.",
    );
    return findings;
  }

  if (presentBaseTables.length !== BASE_TABLES.length) {
    addFinding(
      findings,
      "blocker",
      `Solo existen ${presentBaseTables.length} de ${BASE_TABLES.length} tablas base de Anella; el esquema está incompleto.`,
    );
    return findings;
  }
  addFinding(
    findings,
    "ok",
    "Están presentes todas las tablas base de Anella.",
  );

  const nonInnoDbTables = await count(
    connection,
    `SELECT COUNT(*) AS count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${BASE_TABLES.map((table) => connection.escape(table)).join(", ")})
       AND ENGINE <> 'InnoDB'`,
  );
  addFinding(
    findings,
    nonInnoDbTables === 0 ? "ok" : "blocker",
    nonInnoDbTables === 0
      ? "Las tablas de Anella usan InnoDB."
      : `${nonInnoDbTables} tablas de Anella no usan InnoDB; las claves foráneas y transacciones no son seguras.`,
  );

  if (!tables.has("_prisma_migrations")) {
    addFinding(
      findings,
      "blocker",
      "Hay tablas de Anella sin historial _prisma_migrations; no ejecutes migrate deploy sobre un esquema no administrado.",
    );
    return findings;
  }

  const unfinishedMigrations = await count(
    connection,
    `SELECT COUNT(*) AS count
     FROM \`_prisma_migrations\`
     WHERE \`finished_at\` IS NULL AND \`rolled_back_at\` IS NULL`,
  );
  addFinding(
    findings,
    unfinishedMigrations === 0 ? "ok" : "blocker",
    unfinishedMigrations === 0
      ? "No hay migraciones Prisma fallidas o incompletas registradas."
      : `${unfinishedMigrations} migraciones Prisma están fallidas o incompletas; resuélvelas antes de desplegar.`,
  );

  const appliedMigrations = await loadNames(
    connection,
    `SELECT \`migration_name\` AS name
     FROM \`_prisma_migrations\`
     WHERE \`finished_at\` IS NOT NULL AND \`rolled_back_at\` IS NULL`,
  );
  addFinding(
    findings,
    appliedMigrations.has(INITIAL_MIGRATION) ? "ok" : "blocker",
    appliedMigrations.has(INITIAL_MIGRATION)
      ? "La migración inicial figura aplicada."
      : "Las tablas base existen, pero la migración inicial no figura aplicada.",
  );

  const columnRows = await connection.query<
    Array<{ tableName: string; columnName: string }>
  >(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const columns = new Set(
    columnRows.map((row) => `${row.tableName}.${row.columnName}`),
  );

  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    OPERATIONAL_SAFETY_MIGRATION,
    OPERATIONAL_SAFETY_COLUMNS,
  );
  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    SAFE_POINT_VALIDATION_MIGRATION,
    SAFE_POINT_VALIDATION_COLUMNS,
  );
  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    AUTOMATIC_FIRE_INGESTION_MIGRATION,
    AUTOMATIC_FIRE_INGESTION_COLUMNS,
  );
  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    EXTERNAL_FIRE_SOURCE_HEALTH_MIGRATION,
    EXTERNAL_FIRE_SOURCE_HEALTH_COLUMNS,
  );
  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    EMERGENCY_COORDINATION_MIGRATION,
    EMERGENCY_COORDINATION_COLUMNS,
  );
  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    CLAIM_TOKEN_ENCRYPTION_MIGRATION,
    CLAIM_TOKEN_ENCRYPTION_COLUMNS,
  );
  validateMigrationArtifacts(
    findings,
    appliedMigrations,
    columns,
    SAFE_POINT_RADIUS_MIGRATION,
    SAFE_POINT_RADIUS_COLUMNS,
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    tables,
    EXTERNAL_FIRE_SOURCE_HEALTH_MIGRATION,
    EXTERNAL_FIRE_SOURCE_HEALTH_TABLES,
    "tablas de salud de fuentes externas",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    tables,
    EMERGENCY_COORDINATION_MIGRATION,
    EMERGENCY_COORDINATION_TABLES,
    "tablas de coordinación de emergencias",
  );

  const indexNames = await loadNames(
    connection,
    `SELECT DISTINCT CONCAT(TABLE_NAME, '.', INDEX_NAME) AS name
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()`,
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    OPERATIONAL_SAFETY_MIGRATION,
    OPERATIONAL_SAFETY_INDEXES,
    "índices operativos",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    QUEUE_INDEX_MIGRATION,
    QUEUE_INDEXES,
    "índices de consulta",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    SAFE_POINT_VALIDATION_MIGRATION,
    SAFE_POINT_VALIDATION_INDEXES,
    "índices de validación de puntos seguros",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    QUEUE_SORT_INDEX_MIGRATION,
    QUEUE_SORT_INDEXES,
    "índices de ordenación de cola",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    CONTRIBUTION_QUEUE_INDEX_MIGRATION,
    CONTRIBUTION_QUEUE_INDEXES,
    "índices de la cola global de aportaciones",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    INCIDENT_DETAIL_INDEX_MIGRATION,
    INCIDENT_DETAIL_INDEXES,
    "índices del detalle operativo",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    DESTINATION_INVARIANT_MIGRATION,
    DESTINATION_INVARIANT_INDEXES,
    "índices de integridad de destinos",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    AUTOMATIC_FIRE_INGESTION_MIGRATION,
    AUTOMATIC_FIRE_INGESTION_INDEXES,
    "índices de detección automática",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    EXTERNAL_FIRE_SOURCE_HEALTH_MIGRATION,
    EXTERNAL_FIRE_SOURCE_HEALTH_INDEXES,
    "índices de salud de fuentes externas",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    indexNames,
    EMERGENCY_COORDINATION_MIGRATION,
    EMERGENCY_COORDINATION_INDEXES,
    "índices de coordinación de emergencias",
  );

  const foreignKeyNames = await loadNames(
    connection,
    `SELECT CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) AS name
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    foreignKeyNames,
    OPERATIONAL_SAFETY_MIGRATION,
    OPERATIONAL_SAFETY_FOREIGN_KEYS,
    "vínculos de clave foránea operativos",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    foreignKeyNames,
    SAFE_POINT_VALIDATION_MIGRATION,
    SAFE_POINT_VALIDATION_FOREIGN_KEYS,
    "vínculos de clave foránea de validación de puntos seguros",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    foreignKeyNames,
    DESTINATION_INVARIANT_MIGRATION,
    DESTINATION_INVARIANT_FOREIGN_KEYS,
    "vínculos de integridad de destinos",
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    foreignKeyNames,
    EMERGENCY_COORDINATION_MIGRATION,
    EMERGENCY_COORDINATION_FOREIGN_KEYS,
    "vínculos de coordinación de emergencias",
  );

  const cascadeForeignKeyNames = await loadNames(
    connection,
    `SELECT CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) AS name
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND DELETE_RULE = 'CASCADE'`,
  );
  validateNamedMigrationArtifacts(
    findings,
    appliedMigrations,
    cascadeForeignKeyNames,
    CONTRIBUTION_INCIDENT_CASCADE_MIGRATION,
    CONTRIBUTION_INCIDENT_CASCADE_RULES,
    "reglas de borrado en cascada de aportaciones",
  );

  const constraintRows =
    engine === "mysql"
      ? await connection.query<ConstraintRow[]>(
          `SELECT
             tc.CONSTRAINT_NAME AS name,
             cc.CHECK_CLAUSE AS clause,
             tc.ENFORCED AS enforced
           FROM information_schema.TABLE_CONSTRAINTS AS tc
           INNER JOIN information_schema.CHECK_CONSTRAINTS AS cc
             ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
            AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
           WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
             AND tc.CONSTRAINT_TYPE = 'CHECK'`,
        )
      : await connection.query<ConstraintRow[]>(
          `SELECT
             tc.CONSTRAINT_NAME AS name,
             cc.CHECK_CLAUSE AS clause,
             'YES' AS enforced
           FROM information_schema.TABLE_CONSTRAINTS AS tc
           INNER JOIN information_schema.CHECK_CONSTRAINTS AS cc
             ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
            AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
           WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
             AND tc.CONSTRAINT_TYPE = 'CHECK'`,
        );
  const constraints = new Map(constraintRows.map((row) => [row.name, row]));
  const presentEmergencyChecks = EMERGENCY_COORDINATION_CHECKS.filter((name) =>
    constraints.has(name),
  );
  const disabledEmergencyChecks = presentEmergencyChecks.filter(
    (name) => constraints.get(name)?.enforced.toUpperCase() !== "YES",
  );
  const emergencyMigrationApplied = appliedMigrations.has(
    EMERGENCY_COORDINATION_MIGRATION,
  );
  const emergencyChecksReady =
    presentEmergencyChecks.length === EMERGENCY_COORDINATION_CHECKS.length &&
    disabledEmergencyChecks.length === 0;
  addFinding(
    findings,
    emergencyMigrationApplied && !emergencyChecksReady
      ? "blocker"
      : !emergencyMigrationApplied && presentEmergencyChecks.length > 0
        ? "blocker"
        : "ok",
    emergencyMigrationApplied
      ? emergencyChecksReady
        ? "Están presentes y activos los CHECK de organizaciones y notificaciones."
        : `Faltan o están desactivados ${EMERGENCY_COORDINATION_CHECKS.length - presentEmergencyChecks.length + disabledEmergencyChecks.length} CHECK de coordinación de emergencias.`
      : presentEmergencyChecks.length === 0
        ? "Los CHECK de coordinación de emergencias están pendientes sin restos parciales."
        : "Existen CHECK de coordinación de emergencias sin la migración aplicada.",
  );
  const floorApplied = appliedMigrations.has(PUBLIC_RADIUS_FLOOR_MIGRATION);
  const expectedOperationalChecks = OPERATIONAL_CHECKS.map((name) =>
    name === LEGACY_PUBLIC_RADIUS_CHECK && floorApplied
      ? PUBLIC_RADIUS_FLOOR_CHECK
      : name,
  );
  const presentOperationalChecks = expectedOperationalChecks.filter((name) =>
    constraints.has(name),
  );
  const disabledOperationalChecks = presentOperationalChecks.filter(
    (name) => constraints.get(name)?.enforced.toUpperCase() !== "YES",
  );
  const operationalApplied = appliedMigrations.has(
    OPERATIONAL_SAFETY_MIGRATION,
  );
  const allOperationalChecksReady =
    presentOperationalChecks.length === expectedOperationalChecks.length &&
    disabledOperationalChecks.length === 0;
  addFinding(
    findings,
    operationalApplied && !allOperationalChecksReady
      ? "blocker"
      : !operationalApplied && presentOperationalChecks.length > 0
        ? "blocker"
        : "ok",
    operationalApplied
      ? allOperationalChecksReady
        ? "Están presentes y activos todos los CHECK de seguridad operativa."
        : disabledOperationalChecks.length > 0
          ? `${disabledOperationalChecks.length} CHECK operativos están presentes pero no se aplican.`
          : `Faltan ${expectedOperationalChecks.length - presentOperationalChecks.length} CHECK de una migración que figura aplicada.`
      : presentOperationalChecks.length === 0
        ? "Los CHECK operativos están pendientes y no hay restos parciales."
        : `Existen ${presentOperationalChecks.length} CHECK operativos sin migración aplicada; puede haber deriva.`,
  );

  const retiredPublicRadiusCheck = floorApplied
    ? LEGACY_PUBLIC_RADIUS_CHECK
    : PUBLIC_RADIUS_FLOOR_CHECK;
  if (constraints.has(retiredPublicRadiusCheck)) {
    addFinding(
      findings,
      "blocker",
      `El CHECK ${retiredPublicRadiusCheck} no corresponde al estado registrado de la migración del radio público; puede haber una aplicación parcial.`,
    );
  }

  if (floorApplied) {
    const publicRadiusConstraint = constraints.get(PUBLIC_RADIUS_FLOOR_CHECK);
    const publicRadiusClause = publicRadiusConstraint?.clause;
    const hasCorrectFloor =
      publicRadiusClause !== undefined &&
      publicRadiusConstraint?.enforced.toUpperCase() === "YES" &&
      /between\s+1500\s+and\s+100000/i.test(
        publicRadiusClause.replaceAll("`", ""),
      );
    addFinding(
      findings,
      hasCorrectFloor ? "ok" : "blocker",
      hasCorrectFloor
        ? "El CHECK activo del radio público exige el mínimo de 1.500 m."
        : "La corrección del radio público figura aplicada, pero su CHECK activo no exige 1.500 m.",
    );
  }

  await runDataChecks(connection, findings, columns, appliedMigrations);
  return findings;
}

async function main() {
  const connection = await createConnection(connectionUri());
  let transactionStarted = false;

  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION READ ONLY");
    transactionStarted = true;

    const findings = await inspectDatabase(connection);
    const labels: Record<FindingLevel, string> = {
      ok: "OK",
      warning: "AVISO",
      blocker: "BLOQUEO",
    };

    console.log("Preflight de migraciones de Anella (transacción READ ONLY)");
    for (const finding of findings) {
      console.log(`[${labels[finding.level]}] ${finding.message}`);
    }

    const blockers = findings.filter(
      (finding) => finding.level === "blocker",
    ).length;
    const warnings = findings.filter(
      (finding) => finding.level === "warning",
    ).length;
    console.log(
      blockers === 0
        ? `Preflight superado${warnings > 0 ? ` con ${warnings} aviso(s)` : ""}.`
        : `Preflight bloqueado por ${blockers} comprobación(es).`,
    );

    if (blockers > 0) process.exitCode = 1;
  } finally {
    if (transactionStarted) await connection.rollback();
    await connection.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "error desconocido";
  console.error(`No se pudo completar el preflight: ${message}`);
  process.exitCode = 2;
});
