import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createConnection, type Connection } from "mariadb";
import { describe, expect, it } from "vitest";

import { parseDrillConfiguration } from "../../scripts/backup-restore-drill";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "../..");
const prismaCli = join(projectRoot, "node_modules/prisma/build/index.js");
const currentPrismaConfig = join(projectRoot, "prisma.config.ts");
const currentSchema = join(projectRoot, "prisma/schema.prisma");
const migrationRoot = join(projectRoot, "prisma/migrations");
const legacyMigrations = [
  "20260709230452_init",
  "20260713095737_operational_safety",
  "20260713125000_queue_indexes",
  "20260713143000_safe_point_validation",
] as const;

type DatabaseConnection = ReturnType<
  typeof parseDrillConfiguration
>["administrator"];

function databaseUrl(connection: DatabaseConnection, database: string) {
  const url = new URL("mysql://localhost");
  url.hostname = connection.host === "::1" ? "[::1]" : connection.host;
  url.port = String(connection.port);
  url.username = connection.user;
  url.password = connection.password;
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(
  connection: DatabaseConnection,
  database = connection.database,
) {
  return createConnection({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database,
    allowPublicKeyRetrieval: true,
    connectTimeout: 5_000,
    socketTimeout: 30_000,
  });
}

async function withConnection<T>(
  connection: DatabaseConnection,
  database: string,
  callback: (client: Connection) => Promise<T>,
) {
  const client = await connect(connection, database);
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function deployMigrations(database: string, config: string) {
  try {
    await execFileAsync(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--config", config],
      {
        cwd: projectRoot,
        env: { ...process.env, DATABASE_URL: database },
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      },
    );
  } catch (error) {
    throw new Error("Prisma no pudo aplicar el tramo de migraciones aislado", {
      cause: error,
    });
  }
}

async function prepareLegacyConfig(temporaryDirectory: string) {
  const baselineMigrations = join(temporaryDirectory, "migrations");
  await mkdir(baselineMigrations);
  await Promise.all(
    legacyMigrations.map((migration) =>
      cp(join(migrationRoot, migration), join(baselineMigrations, migration), {
        recursive: true,
      }),
    ),
  );

  const config = join(temporaryDirectory, "prisma.config.ts");
  await writeFile(
    config,
    [
      'import { defineConfig } from "prisma/config";',
      "",
      "export default defineConfig({",
      `  schema: ${JSON.stringify(currentSchema)},`,
      "  migrations: {",
      `    path: ${JSON.stringify(baselineMigrations)},`,
      "  },",
      "  datasource: {",
      '    url: process.env["DATABASE_URL"],',
      "  },",
      "});",
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  return config;
}

async function insertLegacyFixture(
  administrator: DatabaseConnection,
  database: string,
) {
  await withConnection(administrator, database, async (connection) => {
    const now = "2026-07-13 12:00:00.000";
    await connection.query(
      `INSERT INTO \`Municipality\`
        (\`id\`, \`name\`, \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, ?, ?)`,
      ["legacy-municipality", "Municipio legacy", now, now],
    );
    await connection.query(
      `INSERT INTO \`Incident\`
        (\`id\`, \`publicCode\`, \`title\`, \`type\`, \`status\`, \`priority\`,
         \`latitude\`, \`longitude\`, \`radiusMeters\`, \`municipalityId\`,
         \`publicLatitude\`, \`publicLongitude\`, \`publicRadiusMeters\`,
         \`createdAt\`, \`updatedAt\`)
       VALUES
        (?, ?, ?, 'WILDFIRE', 'ACTIVE', 'HIGH', ?, ?, ?, ?, ?, ?, ?, ?, ?),
        (?, ?, ?, 'FLOOD', 'ACTIVE', 'MEDIUM', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "legacy-incident",
        "LEGACY-RADIUS",
        "Incidente legacy",
        41.123456,
        2.123456,
        4321,
        "legacy-municipality",
        41.12,
        2.12,
        1200,
        now,
        now,
        "other-incident",
        "OTHER-INCIDENT",
        "Otro incidente",
        41.5,
        2.5,
        2500,
        "legacy-municipality",
        41.49,
        2.49,
        1500,
        now,
        now,
      ],
    );
    await connection.query(
      `INSERT INTO \`SafePoint\`
        (\`id\`, \`incidentId\`, \`municipalityId\`, \`name\`, \`latitude\`,
         \`longitude\`, \`qrToken\`, \`isActive\`, \`createdAt\`, \`updatedAt\`)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?),
        (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
      [
        "legacy-safe-point",
        "legacy-incident",
        "legacy-municipality",
        "Punto seguro legacy",
        41.2,
        2.2,
        "legacy-safe-token",
        now,
        now,
        "other-safe-point",
        "other-incident",
        "legacy-municipality",
        "Punto de otro incidente",
        41.6,
        2.6,
        "other-safe-token",
        now,
        now,
      ],
    );
    await connection.query(
      `INSERT INTO \`Need\`
        (\`id\`, \`incidentId\`, \`safePointId\`, \`type\`, \`title\`,
         \`quantityNeeded\`, \`quantityReceived\`, \`unit\`, \`status\`,
         \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, ?, 'WATER', ?, 100, 10, 'litros', 'ACTIVE', ?, ?)`,
      [
        "legacy-need",
        "legacy-incident",
        "legacy-safe-point",
        "Agua legacy",
        now,
        now,
      ],
    );
    await connection.query(
      `INSERT INTO \`Contribution\`
        (\`id\`, \`publicCode\`, \`needId\`, \`safePointId\`, \`citizenName\`,
         \`quantity\`, \`deliveredQuantity\`, \`status\`, \`consentAt\`,
         \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, ?, NULL, ?, 25, 0, 'PLEDGED', ?, ?, ?)`,
      [
        "legacy-contribution",
        "LEGACY-CONTRIB",
        "legacy-need",
        "Persona legacy",
        now,
        now,
        now,
      ],
    );
  });
}

const hasLocalAdministrator = Boolean(
  process.env.ANELLA_DRILL_ADMIN_DATABASE_URL?.trim(),
);

if (process.env.CI === "true" && !hasLocalAdministrator) {
  throw new Error(
    "CI debe configurar ANELLA_DRILL_ADMIN_DATABASE_URL para probar upgrades legacy",
  );
}

const legacyDescribe = hasLocalAdministrator ? describe : describe.skip;

legacyDescribe("legacy migration upgrade", () => {
  it("preserves operational data, repairs legacy rows, and enforces the new invariants", async () => {
    const configuration = parseDrillConfiguration(process.env);
    const administrator = configuration.administrator;
    const temporaryDatabase = `anella_legacy_upgrade_${process.pid}_${randomBytes(6).toString("hex")}`;
    const cacheDirectory = join(projectRoot, ".cache");
    await mkdir(cacheDirectory, { recursive: true });
    const temporaryDirectory = await mkdtemp(
      join(cacheDirectory, "anella-legacy-upgrade-"),
    );
    let databaseCreated = false;

    try {
      await withConnection(
        administrator,
        administrator.database,
        async (connection) => {
          await connection.query(
            `CREATE DATABASE \`${temporaryDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
          );
          databaseCreated = true;
        },
      );

      const temporaryUrl = databaseUrl(administrator, temporaryDatabase);
      const legacyConfig = await prepareLegacyConfig(temporaryDirectory);
      await deployMigrations(temporaryUrl, legacyConfig);
      await insertLegacyFixture(administrator, temporaryDatabase);
      await deployMigrations(temporaryUrl, currentPrismaConfig);

      await withConnection(
        administrator,
        temporaryDatabase,
        async (connection) => {
          const incidents = await connection.query<
            Array<{
              latitude: number | string;
              longitude: number | string;
              radiusMeters: number | string;
              publicLatitude: number | string;
              publicLongitude: number | string;
              publicRadiusMeters: number | string;
            }>
          >(
            `SELECT \`latitude\`, \`longitude\`, \`radiusMeters\`,
                      \`publicLatitude\`, \`publicLongitude\`, \`publicRadiusMeters\`
                 FROM \`Incident\` WHERE \`id\` = 'legacy-incident'`,
          );
          expect(incidents).toHaveLength(1);
          expect(Number(incidents[0]?.latitude)).toBe(41.123456);
          expect(Number(incidents[0]?.longitude)).toBe(2.123456);
          expect(Number(incidents[0]?.radiusMeters)).toBe(4321);
          expect(Number(incidents[0]?.publicLatitude)).toBe(41.12);
          expect(Number(incidents[0]?.publicLongitude)).toBe(2.12);
          expect(Number(incidents[0]?.publicRadiusMeters)).toBe(1500);

          const contributions = await connection.query<
            Array<{
              incidentId: string;
              needId: string | null;
              safePointId: string;
              category: string;
              origin: string;
              unit: string | null;
              quantity: number | string;
            }>
          >(
            `SELECT \`incidentId\`, \`needId\`, \`safePointId\`, \`category\`,
                    \`origin\`, \`unit\`, \`quantity\`
                 FROM \`Contribution\` WHERE \`id\` = 'legacy-contribution'`,
          );
          expect(contributions).toEqual([
            expect.objectContaining({
              incidentId: "legacy-incident",
              needId: "legacy-need",
              safePointId: "legacy-safe-point",
              category: "WATER",
              origin: "LEGACY_NEED",
              unit: "litros",
              quantity: 25,
            }),
          ]);

          const emergencyBackfill = await connection.query<
            Array<{
              incidentOrigin: string;
              pointStatus: string;
              pointType: string;
            }>
          >(
            `SELECT incident.\`origin\` AS incidentOrigin,
                    point.\`pointStatus\` AS pointStatus,
                    point.\`pointType\` AS pointType
               FROM \`Incident\` AS incident
               INNER JOIN \`SafePoint\` AS point
                 ON point.\`incidentId\` = incident.\`id\`
              WHERE incident.\`id\` = 'legacy-incident'
                AND point.\`id\` = 'legacy-safe-point'`,
          );
          expect(emergencyBackfill).toEqual([
            expect.objectContaining({
              incidentOrigin: "MANUAL",
              pointStatus: "DRAFT",
              pointType: "DROP_OFF",
            }),
          ]);

          await expect(
            connection.query(
              `INSERT INTO \`Contribution\` (
                 \`id\`, \`publicCode\`, \`incidentId\`, \`needId\`,
                 \`safePointId\`, \`category\`, \`origin\`, \`description\`,
                 \`citizenName\`, \`quantity\`, \`deliveredQuantity\`,
                 \`status\`, \`consentAt\`, \`createdAt\`, \`updatedAt\`
               ) VALUES (
                 'direct-contribution', 'DIRECT-LEGACY', 'legacy-incident', NULL,
                 'legacy-safe-point', 'FOOD', 'PUBLIC_ANONYMOUS',
                 'Aportación directa tras la migración', 'Anónimo', 1, 0,
                 'PLEDGED', '2026-07-13 12:00:00.000',
                 '2026-07-13 12:00:00.000', '2026-07-13 12:00:00.000'
               )`,
            ),
          ).resolves.toBeDefined();

          const auditRows = await connection.query<
            Array<{ action: string; entityId: string; metadata: unknown }>
          >(
            `SELECT \`action\`, \`entityId\`, \`metadata\`
                 FROM \`AuditLog\`
                WHERE \`entityId\` = 'legacy-contribution'
                  AND \`action\` = 'migration.contribution_destination_backfilled'`,
          );
          expect(auditRows).toHaveLength(1);
          const rawMetadata = auditRows[0]?.metadata;
          const metadata =
            typeof rawMetadata === "string"
              ? (JSON.parse(rawMetadata) as Record<string, unknown>)
              : (rawMetadata as Record<string, unknown>);
          expect(metadata).toMatchObject({
            migration: "20260713203000_destination_invariants",
            safePointId: "legacy-safe-point",
          });

          const migrations = await connection.query<Array<{ name: string }>>(
            `SELECT \`migration_name\` AS name
                 FROM \`_prisma_migrations\`
                WHERE \`migration_name\` IN (
                  '20260713150000_public_radius_floor',
                  '20260713203000_destination_invariants',
                  '20260716130000_emergency_contribution_coordination',
                  '20260716131500_claim_token_encryption',
                  '20260716133000_contribution_incident_cascade',
                  '20260717143000_safe_point_radius'
                )
                  AND \`finished_at\` IS NOT NULL
                  AND \`rolled_back_at\` IS NULL`,
          );
          expect(migrations.map(({ name }) => name).sort()).toEqual([
            "20260713150000_public_radius_floor",
            "20260713203000_destination_invariants",
            "20260716130000_emergency_contribution_coordination",
            "20260716131500_claim_token_encryption",
            "20260716133000_contribution_incident_cascade",
            "20260717143000_safe_point_radius",
          ]);

          const cascadeRule = await connection.query<
            Array<{ deleteRule: string }>
          >(
            `SELECT \`DELETE_RULE\` AS deleteRule
               FROM information_schema.REFERENTIAL_CONSTRAINTS
              WHERE \`CONSTRAINT_SCHEMA\` = DATABASE()
                AND \`TABLE_NAME\` = 'Contribution'
                AND \`CONSTRAINT_NAME\` = 'Contribution_incidentId_fkey'`,
          );
          expect(cascadeRule).toEqual([{ deleteRule: "CASCADE" }]);

          await expect(
            connection.query(
              `UPDATE \`Incident\` SET \`publicRadiusMeters\` = 1499
                  WHERE \`id\` = 'legacy-incident'`,
            ),
          ).rejects.toThrow();
          await expect(
            connection.query(
              `UPDATE \`Need\` SET \`safePointId\` = 'other-safe-point'
                  WHERE \`id\` = 'legacy-need'`,
            ),
          ).rejects.toThrow();
          await expect(
            connection.query(
              `UPDATE \`Contribution\` SET \`safePointId\` = 'other-safe-point'
                  WHERE \`id\` = 'legacy-contribution'`,
            ),
          ).rejects.toThrow();
          await expect(
            connection.query(
              `UPDATE \`Contribution\` SET \`safePointId\` = NULL
                  WHERE \`id\` = 'legacy-contribution'`,
            ),
          ).rejects.toThrow();
        },
      );
    } finally {
      if (databaseCreated) {
        await withConnection(
          administrator,
          administrator.database,
          async (connection) => {
            await connection.query(
              `DROP DATABASE IF EXISTS \`${temporaryDatabase}\``,
            );
          },
        );
      }
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 180_000);
});
