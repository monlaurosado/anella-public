import { createHash, randomUUID } from "node:crypto";

import { hash } from "bcryptjs";
import mariadb, { type PoolConnection } from "mariadb";

const accountFixtureMunicipalityPrefix = "E2E ACCOUNT SECURITY ";
const accountFixtureEmailDomain = "accounts.e2e.anella.local";
const operationalFixtureMunicipalityPrefix = "E2E OPERATIONAL LIFECYCLE ";
const operationalFixtureEmailDomain = "operations.e2e.anella.local";
const operationalFixtureIncidentPrefix = "SIMULACRO E2E · Ciclo operativo ";
const e2eClientIdentity = "proxy-headers-disabled";

export type E2EAccountSecurityFixture = {
  municipalityA: { id: string; name: string };
  municipalityB: { id: string; name: string };
  organizationA: { id: string; name: string };
  admin: { email: string; name: string; password: string };
  coordinatorA: { email: string; name: string; password: string };
  coordinatorB: { email: string; name: string; password: string };
  createdAdmin: {
    email: string;
    name: string;
    temporaryPassword: string;
    permanentPassword: string;
    resetTemporaryPassword: string;
  };
};

export type E2EOperationalFixture = {
  municipality: { id: string; name: string };
  organization: { id: string; name: string };
  admin: { id: string; email: string; name: string; password: string };
  detection: { id: string; externalId: string };
  incident: {
    title: string;
    publicSummary: string;
    publicLocationLabel: string;
  };
  safePoint: { name: string; address: string };
  need: { title: string; quantity: number; unit: string };
  citizen: { name: string; email: string; phone: string };
};

export type E2EOperationalAuditSnapshot = {
  incidentId: string;
  publicCode: string;
  status: string;
  closedReason: string | null;
  actions: string[];
};

function databaseConfig() {
  const value = process.env.DATABASE_URL;

  if (process.env.ANELLA_ENV !== "test") {
    throw new Error("E2E database helpers require ANELLA_ENV=test");
  }
  if (!value) {
    throw new Error("DATABASE_URL is required for end-to-end database helpers");
  }

  const url = new URL(value);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (url.protocol !== "mysql:" || !loopbackHosts.has(url.hostname)) {
    throw new Error(
      "E2E database helpers require a loopback mysql:// DATABASE_URL",
    );
  }

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

function rateLimitKeyHash(identity: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for scoped E2E cleanup");
  }
  return createHash("sha256").update(`${secret}:${identity}`).digest("hex");
}

async function deleteScopedRateLimits(
  connection: PoolConnection,
  entries: Array<{ action: string; identities: Iterable<string> }>,
) {
  for (const entry of entries) {
    const keyHashes = [
      ...new Set([...entry.identities].filter(Boolean).map(rateLimitKeyHash)),
    ];
    if (keyHashes.length === 0) continue;
    await connection.query(
      `DELETE FROM SubmissionThrottle
       WHERE action = ?
         AND keyHash IN (${keyHashes.map(() => "?").join(",")})`,
      [entry.action, ...keyHashes],
    );
  }
}

export async function cleanupE2EContributions() {
  const pool = mariadb.createPool({
    ...databaseConfig(),
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const contributions = (await connection.query(
      `SELECT id, publicCode, needId, citizenPhone
       FROM Contribution
       WHERE citizenEmail LIKE ?`,
      ["%@e2e.anella.local"],
    )) as Array<{
      id: string;
      publicCode: string;
      needId: string;
      citizenPhone: string | null;
    }>;
    const contributionIds = contributions.map((row) => row.id);
    const privateCodes = [
      "SIM-AP-0002",
      ...contributions.map((row) => row.publicCode),
    ];
    await deleteScopedRateLimits(connection, [
      {
        action: "pledge-contribution-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "pledge-contribution-ip-need",
        identities: contributions.map(
          (row) => `${e2eClientIdentity}:${row.needId}`,
        ),
      },
      {
        action: "pledge-contribution-identity",
        identities: contributions
          .filter((row) => row.citizenPhone)
          .map((row) => `${e2eClientIdentity}:${row.citizenPhone}`),
      },
      {
        action: "contribution-access-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "contribution-access-ip-code",
        identities: privateCodes.map((code) => `${e2eClientIdentity}:${code}`),
      },
      {
        action: "contribution-private-link-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "contribution-private-link-ip-code",
        identities: privateCodes.map((code) => `${e2eClientIdentity}:${code}`),
      },
      {
        action: "contribution-cancel-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "contribution-cancel-ip-code",
        identities: privateCodes.map((code) => `${e2eClientIdentity}:${code}`),
      },
    ]);
    const rows = (await connection.query(
      `SELECT needId, SUM(deliveredQuantity) AS delivered
       FROM Contribution
       WHERE citizenEmail LIKE ?
       GROUP BY needId`,
      ["%@e2e.anella.local"],
    )) as Array<{ needId: string; delivered: number | string | bigint }>;

    if (contributionIds.length > 0) {
      const placeholders = contributionIds.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM AuditLog
         WHERE entityType = 'Contribution' AND entityId IN (${placeholders})`,
        contributionIds,
      );
    }

    await connection.query(
      "DELETE FROM Contribution WHERE citizenEmail LIKE ?",
      ["%@e2e.anella.local"],
    );

    for (const row of rows) {
      const delivered = Number(row.delivered);
      await connection.query(
        `UPDATE Need
         SET quantityReceived = GREATEST(0, quantityReceived - ?),
             status = CASE
               WHEN status = 'COVERED'
                 AND GREATEST(0, quantityReceived - ?) < quantityNeeded
               THEN 'ACTIVE'
               ELSE status
             END
         WHERE id = ?`,
        [delivered, delivered, row.needId],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

export async function cleanupE2EAccountSecurityFixtures() {
  const pool = mariadb.createPool({
    ...databaseConfig(),
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const municipalities = (await connection.query(
      "SELECT id FROM Municipality WHERE name LIKE ?",
      [`${accountFixtureMunicipalityPrefix}%`],
    )) as Array<{ id: string }>;
    const municipalityIds = municipalities.map((row) => row.id);
    const users = (await connection.query(
      `SELECT id, email FROM User
       WHERE email LIKE ?
          OR ${
            municipalityIds.length > 0
              ? `municipalityId IN (${municipalityIds.map(() => "?").join(",")})`
              : "1 = 0"
          }`,
      [`%@${accountFixtureEmailDomain}`, ...municipalityIds],
    )) as Array<{ id: string; email: string }>;
    const userIds = users.map((row) => row.id);
    const fixtureEmails = new Set(users.map((row) => row.email));
    for (const email of [...fixtureEmails]) {
      if (
        email.startsWith("admin-") &&
        email.endsWith(`@${accountFixtureEmailDomain}`)
      ) {
        fixtureEmails.add(`created-${email}`);
      }
    }
    await deleteScopedRateLimits(connection, [
      {
        action: "coordinator-login-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "coordinator-login-pair",
        identities: [...fixtureEmails].map(
          (email) => `${e2eClientIdentity}:${email}`,
        ),
      },
      {
        action: "coordinator-login-account",
        identities: fixtureEmails,
      },
      {
        action: "admin-sensitive-step-up-actor",
        identities: userIds,
      },
      {
        action: "admin-sensitive-step-up-target",
        identities: userIds.flatMap((userId) => [
          ...[...fixtureEmails].map((email) => `${userId}:${email}`),
          ...userIds.map((targetId) => `${userId}:${targetId}`),
        ]),
      },
      { action: "own-password-change", identities: userIds },
    ]);

    if (municipalityIds.length > 0 || userIds.length > 0) {
      const clauses: string[] = [];
      const values: string[] = [];
      if (municipalityIds.length > 0) {
        clauses.push(
          `municipalityId IN (${municipalityIds.map(() => "?").join(",")})`,
        );
        values.push(...municipalityIds);
      }
      if (userIds.length > 0) {
        const placeholders = userIds.map(() => "?").join(",");
        clauses.push(`actorId IN (${placeholders})`);
        values.push(...userIds);
        clauses.push(`(entityType = 'User' AND entityId IN (${placeholders}))`);
        values.push(...userIds);
      }
      await connection.query(
        `DELETE FROM AuditLog WHERE ${clauses.join(" OR ")}`,
        values,
      );
    }

    if (userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM Account WHERE userId IN (${placeholders})`,
        userIds,
      );
      await connection.query(
        `DELETE FROM Session WHERE userId IN (${placeholders})`,
        userIds,
      );
      await connection.query(
        `DELETE FROM User WHERE id IN (${placeholders})`,
        userIds,
      );
    }

    await connection.query(
      "DELETE FROM VerificationToken WHERE identifier LIKE ?",
      [`%@${accountFixtureEmailDomain}`],
    );
    if (municipalityIds.length > 0) {
      const placeholders = municipalityIds.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM Organization WHERE municipalityId IN (${placeholders})`,
        municipalityIds,
      );
      await connection.query(
        `DELETE FROM Municipality WHERE id IN (${placeholders})`,
        municipalityIds,
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

export async function createE2EAccountSecurityFixture(): Promise<E2EAccountSecurityFixture> {
  const pool = mariadb.createPool({
    ...databaseConfig(),
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();
  const token = randomUUID();
  const municipalityA = {
    id: `e2e-municipality-a-${token}`,
    name: `${accountFixtureMunicipalityPrefix}A ${token}`,
  };
  const municipalityB = {
    id: `e2e-municipality-b-${token}`,
    name: `${accountFixtureMunicipalityPrefix}B ${token}`,
  };
  const organizationA = {
    id: `e2e-organization-a-${token}`,
    name: `E2E Organización A ${token}`,
  };
  const organizationB = {
    id: `e2e-organization-b-${token}`,
    name: `E2E Organización B ${token}`,
  };
  const admin = {
    id: `e2e-admin-${token}`,
    email: `admin-${token}@${accountFixtureEmailDomain}`,
    name: `Administración E2E A ${token}`,
    password: "E2E-Admin-Current-2026!",
  };
  const coordinatorA = {
    id: `e2e-coordinator-a-${token}`,
    email: `coordinator-a-${token}@${accountFixtureEmailDomain}`,
    name: `Coordinación E2E A ${token}`,
    password: "E2E-Coordinator-Current-2026!",
  };
  const coordinatorB = {
    id: `e2e-coordinator-b-${token}`,
    email: `coordinator-b-${token}@${accountFixtureEmailDomain}`,
    name: `Coordinación E2E B ${token}`,
    password: "E2E-Coordinator-Current-2026!",
  };
  const createdAdmin = {
    email: `created-admin-${token}@${accountFixtureEmailDomain}`,
    name: `Administración creada E2E ${token}`,
    temporaryPassword: "E2E-Temporary-Account-2026!",
    permanentPassword: "E2E-Permanent-Account-2026!",
    resetTemporaryPassword: "E2E-Reset-Temporary-2026!",
  };

  try {
    const [adminHash, coordinatorHash] = await Promise.all([
      hash(admin.password, 4),
      hash(coordinatorA.password, 4),
    ]);
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO Municipality (id, name, country, updatedAt)
       VALUES (?, ?, 'ES', NOW()), (?, ?, 'ES', NOW())`,
      [
        municipalityA.id,
        municipalityA.name,
        municipalityB.id,
        municipalityB.name,
      ],
    );
    await connection.query(
      `INSERT INTO Organization (
         id, name, kind, verificationStatus, verifiedAt, municipalityId, updatedAt
       )
       VALUES
         (?, ?, 'MUNICIPALITY', 'VERIFIED', NOW(), ?, NOW()),
         (?, ?, 'MUNICIPALITY', 'VERIFIED', NOW(), ?, NOW())`,
      [
        organizationA.id,
        organizationA.name,
        municipalityA.id,
        organizationB.id,
        organizationB.name,
        municipalityB.id,
      ],
    );
    await connection.query(
      `INSERT INTO User (
         id, name, email, passwordHash, role, isActive, mustChangePassword,
         sessionVersion, municipalityId, organizationId, updatedAt
       ) VALUES
         (?, ?, ?, ?, 'MUNICIPAL_ADMIN', 1, 0, 1, ?, ?, NOW()),
         (?, ?, ?, ?, 'COORDINATOR', 1, 0, 1, ?, ?, NOW()),
         (?, ?, ?, ?, 'COORDINATOR', 1, 0, 1, ?, ?, NOW())`,
      [
        admin.id,
        admin.name,
        admin.email,
        adminHash,
        municipalityA.id,
        organizationA.id,
        coordinatorA.id,
        coordinatorA.name,
        coordinatorA.email,
        coordinatorHash,
        municipalityA.id,
        organizationA.id,
        coordinatorB.id,
        coordinatorB.name,
        coordinatorB.email,
        coordinatorHash,
        municipalityB.id,
        organizationB.id,
      ],
    );
    await connection.commit();

    return {
      municipalityA,
      municipalityB,
      organizationA,
      admin,
      coordinatorA,
      coordinatorB,
      createdAdmin,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

export async function cleanupE2EOperationalFixtures() {
  const pool = mariadb.createPool({
    ...databaseConfig(),
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const municipalities = (await connection.query(
      "SELECT id FROM Municipality WHERE name LIKE ?",
      [`${operationalFixtureMunicipalityPrefix}%`],
    )) as Array<{ id: string }>;
    const municipalityIds = municipalities.map((row) => row.id);
    const users = (await connection.query(
      `SELECT id, email FROM User
       WHERE email LIKE ?
          OR ${
            municipalityIds.length > 0
              ? `municipalityId IN (${municipalityIds.map(() => "?").join(",")})`
              : "1 = 0"
          }`,
      [`%@${operationalFixtureEmailDomain}`, ...municipalityIds],
    )) as Array<{ id: string; email: string }>;
    const userIds = users.map((row) => row.id);
    const incidents = (await connection.query(
      `SELECT id FROM Incident
       WHERE title LIKE ?
          OR ${
            municipalityIds.length > 0
              ? `municipalityId IN (${municipalityIds.map(() => "?").join(",")})`
              : "1 = 0"
          }`,
      [`${operationalFixtureIncidentPrefix}%`, ...municipalityIds],
    )) as Array<{ id: string }>;
    const incidentIds = incidents.map((row) => row.id);
    const needs = incidentIds.length
      ? ((await connection.query(
          `SELECT id FROM Need
           WHERE incidentId IN (${incidentIds.map(() => "?").join(",")})`,
          incidentIds,
        )) as Array<{ id: string }>)
      : [];
    const needIds = needs.map((row) => row.id);
    const contributions = incidentIds.length
      ? ((await connection.query(
          `SELECT id, needId, citizenPhone
           FROM Contribution
           WHERE incidentId IN (${incidentIds.map(() => "?").join(",")})`,
          incidentIds,
        )) as Array<{
          id: string;
          needId: string | null;
          citizenPhone: string | null;
        }>)
      : [];

    await deleteScopedRateLimits(connection, [
      {
        action: "coordinator-login-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "coordinator-login-pair",
        identities: users.map((user) => `${e2eClientIdentity}:${user.email}`),
      },
      {
        action: "coordinator-login-account",
        identities: users.map((user) => user.email),
      },
      {
        action: "pledge-contribution-ip",
        identities: [e2eClientIdentity],
      },
      {
        action: "pledge-contribution-ip-need",
        identities: contributions
          .filter((contribution) => contribution.needId)
          .map(
            (contribution) =>
              `${e2eClientIdentity}:${contribution.needId as string}`,
          ),
      },
      {
        action: "pledge-contribution-identity",
        identities: contributions
          .filter((contribution) => contribution.citizenPhone)
          .map(
            (contribution) =>
              `${e2eClientIdentity}:${contribution.citizenPhone}`,
          ),
      },
    ]);

    if (
      municipalityIds.length > 0 ||
      incidentIds.length > 0 ||
      userIds.length > 0
    ) {
      const clauses: string[] = [];
      const values: string[] = [];
      if (municipalityIds.length > 0) {
        clauses.push(
          `municipalityId IN (${municipalityIds.map(() => "?").join(",")})`,
        );
        values.push(...municipalityIds);
      }
      if (incidentIds.length > 0) {
        clauses.push(`incidentId IN (${incidentIds.map(() => "?").join(",")})`);
        values.push(...incidentIds);
      }
      if (userIds.length > 0) {
        clauses.push(`actorId IN (${userIds.map(() => "?").join(",")})`);
        values.push(...userIds);
      }
      await connection.query(
        `DELETE FROM AuditLog WHERE ${clauses.join(" OR ")}`,
        values,
      );
    }

    if (incidentIds.length > 0) {
      const placeholders = incidentIds.map(() => "?").join(",");
      await connection.query(
        `UPDATE ExternalDetection
         SET linkedIncidentId = NULL
         WHERE linkedIncidentId IN (${placeholders})`,
        incidentIds,
      );
    }
    if (contributions.length > 0) {
      await connection.query(
        `DELETE FROM Contribution
         WHERE id IN (${contributions.map(() => "?").join(",")})`,
        contributions.map((contribution) => contribution.id),
      );
    }
    if (needIds.length > 0) {
      await connection.query(
        `DELETE FROM Need WHERE id IN (${needIds.map(() => "?").join(",")})`,
        needIds,
      );
    }
    if (incidentIds.length > 0) {
      const placeholders = incidentIds.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM SafePoint WHERE incidentId IN (${placeholders})`,
        incidentIds,
      );
      await connection.query(
        `DELETE FROM Incident WHERE id IN (${placeholders})`,
        incidentIds,
      );
    }
    if (municipalityIds.length > 0) {
      await connection.query(
        `DELETE FROM ExternalDetection
         WHERE municipalityId IN (${municipalityIds.map(() => "?").join(",")})`,
        municipalityIds,
      );
    }
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM Account WHERE userId IN (${placeholders})`,
        userIds,
      );
      await connection.query(
        `DELETE FROM Session WHERE userId IN (${placeholders})`,
        userIds,
      );
      await connection.query(
        `DELETE FROM User WHERE id IN (${placeholders})`,
        userIds,
      );
    }
    await connection.query(
      "DELETE FROM VerificationToken WHERE identifier LIKE ?",
      [`%@${operationalFixtureEmailDomain}`],
    );
    if (municipalityIds.length > 0) {
      const placeholders = municipalityIds.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM Organization WHERE municipalityId IN (${placeholders})`,
        municipalityIds,
      );
      await connection.query(
        `DELETE FROM Municipality WHERE id IN (${placeholders})`,
        municipalityIds,
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

export async function createE2EOperationalFixture(): Promise<E2EOperationalFixture> {
  const pool = mariadb.createPool({
    ...databaseConfig(),
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();
  const token = randomUUID();
  const phoneDigits = token.replace(/\D/g, "").padEnd(8, "7").slice(0, 8);
  const municipality = {
    id: `e2e-operations-municipality-${token}`,
    name: `${operationalFixtureMunicipalityPrefix}${token}`,
  };
  const organization = {
    id: `e2e-operations-organization-${token}`,
    name: `E2E Operaciones ${token}`,
  };
  const admin = {
    id: `e2e-operations-admin-${token}`,
    email: `admin-${token}@${operationalFixtureEmailDomain}`,
    name: `Administración operativa E2E ${token}`,
    password: "E2E-Operational-Admin-2026!",
  };
  const detection = {
    id: `e2e-operations-detection-${token}`,
    externalId: `e2e-operations-alert-${token}`,
  };
  const fixture: E2EOperationalFixture = {
    municipality,
    organization,
    admin,
    detection,
    incident: {
      title: `${operationalFixtureIncidentPrefix}${token}`,
      publicSummary:
        "Simulacro verificado para coordinar una necesidad ciudadana segura.",
      publicLocationLabel: `Zona municipal segura E2E ${token}`,
    },
    safePoint: {
      name: `Punto seguro E2E ${token}`,
      address: `Avenida Segura 1, ${municipality.name}`,
    },
    need: {
      title: `Agua para simulacro E2E ${token}`,
      quantity: 4,
      unit: "cajas",
    },
    citizen: {
      name: `Ciudadanía operativa E2E ${token}`,
      email: `citizen-${token}@${operationalFixtureEmailDomain}`,
      phone: `+346${phoneDigits}`,
    },
  };

  try {
    const passwordHash = await hash(admin.password, 4);
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO Municipality (id, name, country, updatedAt)
       VALUES (?, ?, 'ES', NOW())`,
      [municipality.id, municipality.name],
    );
    await connection.query(
      `INSERT INTO Organization (
         id, name, kind, verificationStatus, verifiedAt, municipalityId, updatedAt
       ) VALUES (?, ?, 'MUNICIPALITY', 'VERIFIED', NOW(), ?, NOW())`,
      [organization.id, organization.name, municipality.id],
    );
    await connection.query(
      `INSERT INTO User (
         id, name, email, passwordHash, role, isActive, mustChangePassword,
         sessionVersion, municipalityId, organizationId, updatedAt
       ) VALUES (?, ?, ?, ?, 'MUNICIPAL_ADMIN', 1, 0, 1, ?, ?, NOW())`,
      [
        admin.id,
        admin.name,
        admin.email,
        passwordHash,
        municipality.id,
        organization.id,
      ],
    );
    await connection.query(
      `INSERT INTO ExternalDetection (
         id, source, provider, externalId, latitude, longitude, detectedAt,
         confidence, status, municipalityId, createdAt, updatedAt
       ) VALUES (
         ?, 'CIVIL_PROTECTION', 'Protección Civil E2E', ?, 41.620100,
         2.300100, NOW(), 'official', 'PENDING', ?, NOW(), NOW()
       )`,
      [detection.id, detection.externalId, municipality.id],
    );
    await connection.commit();
    return fixture;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

export async function getE2EOperationalAuditSnapshot(
  incidentTitle: string,
): Promise<E2EOperationalAuditSnapshot> {
  const pool = mariadb.createPool({
    ...databaseConfig(),
    connectionLimit: 1,
  });
  const connection = await pool.getConnection();

  try {
    const incidents = (await connection.query(
      `SELECT id, publicCode, status, closedReason
       FROM Incident
       WHERE title = ?`,
      [incidentTitle],
    )) as Array<{
      id: string;
      publicCode: string;
      status: string;
      closedReason: string | null;
    }>;
    if (incidents.length !== 1) {
      throw new Error(
        `Expected one E2E operational incident, found ${incidents.length}`,
      );
    }
    const incident = incidents[0];
    const auditRows = (await connection.query(
      `SELECT action
       FROM AuditLog
       WHERE incidentId = ?
       ORDER BY createdAt, id`,
      [incident.id],
    )) as Array<{ action: string }>;
    return {
      incidentId: incident.id,
      publicCode: incident.publicCode,
      status: incident.status,
      closedReason: incident.closedReason,
      actions: auditRows.map((row) => row.action),
    };
  } finally {
    connection.release();
    await pool.end();
  }
}
