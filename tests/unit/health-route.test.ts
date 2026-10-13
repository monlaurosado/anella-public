import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

type SchemaArtifact = {
  kind: "column" | "index" | "foreign-key" | "check";
  artifact: string;
  detail: string;
};

function readyMigration() {
  return [{ finishedAt: new Date("2026-07-13T15:30:00Z"), rolledBackAt: null }];
}

function readyMySqlProbe() {
  return [
    {
      available: 1,
      version: "8.4.10",
      versionComment: "MySQL Community Server - GPL",
    },
  ];
}

function readyMySql8016Probe() {
  return [
    {
      available: 1,
      version: "8.0.16",
      versionComment: "MySQL Community Server - GPL",
    },
  ];
}

function readyMariaDbProbe() {
  return [
    {
      available: 1,
      version: "11.8.8-MariaDB-log",
      versionComment: "MariaDB Server",
    },
  ];
}

function readyMySqlCheckEnforcement() {
  return [
    { artifact: "Need.Need_quantities_check", enforced: "YES" },
    {
      artifact: "Contribution.Contribution_quantities_check",
      enforced: "YES",
    },
    {
      artifact: "Incident.Incident_publicRadiusMeters_floor_check",
      enforced: "YES",
    },
    {
      artifact: "Organization.Organization_notificationRadiusMeters_check",
      enforced: "YES",
    },
    {
      artifact: "Organization.Organization_notificationCooldownMinutes_check",
      enforced: "YES",
    },
  ];
}

function readySchemaArtifacts(): SchemaArtifact[] {
  return [
    { kind: "column", artifact: "Contribution.revision", detail: "int|NO|1" },
    {
      kind: "column",
      artifact: "Contribution.incidentId",
      detail: "varchar|NO|<null>",
    },
    {
      kind: "column",
      artifact: "Contribution.needId",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Contribution.safePointId",
      detail: "varchar|NO|<null>",
    },
    {
      kind: "column",
      artifact: "Contribution.category",
      detail: "enum|NO|OTHER",
    },
    {
      kind: "column",
      artifact: "Contribution.personalDataConsentAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Contribution.followUpConsentAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Contribution.piiExpiresAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "SafePoint.pointStatus",
      detail: "enum|NO|DRAFT",
    },
    {
      kind: "column",
      artifact: "SafePoint.pointType",
      detail: "enum|NO|DROP_OFF",
    },
    {
      kind: "column",
      artifact: "SafePoint.publishedAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "SafePoint.validatedAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "SafePoint.validatedById",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "SafePoint.radiusMeters",
      detail: "int|NO|30",
    },
    {
      kind: "column",
      artifact: "Need.validatedAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Need.validatedById",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Incident.publicLocationApprovedAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Incident.publicLocationApprovedById",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Incident.publicRadiusMeters",
      detail: "int|YES|<null>",
    },
    {
      kind: "column",
      artifact: "Incident.origin",
      detail: "enum|NO|MANUAL",
    },
    {
      kind: "column",
      artifact: "Organization.verificationStatus",
      detail: "enum|NO|UNVERIFIED",
    },
    {
      kind: "column",
      artifact: "Organization.notificationRadiusMeters",
      detail: "int|NO|25000",
    },
    {
      kind: "column",
      artifact: "Organization.notificationCooldownMinutes",
      detail: "int|NO|60",
    },
    {
      kind: "column",
      artifact: "OrganizationClaim.verificationTokenCiphertext",
      detail: "text|YES|<null>",
    },
    {
      kind: "column",
      artifact: "NotificationOutbox.status",
      detail: "enum|NO|PENDING",
    },
    {
      kind: "column",
      artifact: "NotificationOutbox.attempts",
      detail: "int|NO|0",
    },
    {
      kind: "column",
      artifact: "NotificationOutbox.maxAttempts",
      detail: "int|NO|5",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.satellite",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.instrument",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.fireRadiativePowerMw",
      detail: "decimal|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.footprintAreaHectares",
      detail: "decimal|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.footprintJson",
      detail: "json|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.provider",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.providerStatus",
      detail: "varchar|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.providerStatusChangedAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalDetection.lastSeenAt",
      detail: "datetime|YES|<null>",
    },
    {
      kind: "column",
      artifact: "ExternalSourceSync.lastAttemptAt",
      detail: "datetime|NO|<null>",
    },
    {
      kind: "index",
      artifact: "ExternalDetection.ExternalDetection_status_detectedAt_idx.1",
      detail: "status|A|1",
    },
    {
      kind: "index",
      artifact: "ExternalDetection.ExternalDetection_status_detectedAt_idx.2",
      detail: "detectedAt|A|1",
    },
    {
      kind: "index",
      artifact:
        "ExternalDetection.ExternalDetection_provider_status_seen_idx.1",
      detail: "provider|A|1",
    },
    {
      kind: "index",
      artifact:
        "ExternalDetection.ExternalDetection_provider_status_seen_idx.2",
      detail: "providerStatus|A|1",
    },
    {
      kind: "index",
      artifact:
        "ExternalDetection.ExternalDetection_provider_status_seen_idx.3",
      detail: "lastSeenAt|A|1",
    },
    {
      kind: "index",
      artifact: "ExternalSourceSync.ExternalSourceSync_status_attempt_idx.1",
      detail: "status|A|1",
    },
    {
      kind: "index",
      artifact: "ExternalSourceSync.ExternalSourceSync_status_attempt_idx.2",
      detail: "lastAttemptAt|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_public_idx.1",
      detail: "incidentId|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_public_idx.2",
      detail: "isActive|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_public_idx.3",
      detail: "validatedAt|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_dropoff_public_idx.1",
      detail: "incidentId|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_dropoff_public_idx.2",
      detail: "pointStatus|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_dropoff_public_idx.3",
      detail: "publishedAt|A|1",
    },
    {
      kind: "index",
      artifact: "Contribution.Contribution_incident_status_updated_idx.1",
      detail: "incidentId|A|1",
    },
    {
      kind: "index",
      artifact: "Contribution.Contribution_incident_status_updated_idx.2",
      detail: "status|A|1",
    },
    {
      kind: "index",
      artifact: "Contribution.Contribution_incident_status_updated_idx.3",
      detail: "updatedAt|A|1",
    },
    {
      kind: "index",
      artifact: "Contribution.Contribution_queue_status_updated_created_idx.1",
      detail: "status|A|1",
    },
    {
      kind: "index",
      artifact: "Contribution.Contribution_queue_status_updated_created_idx.2",
      detail: "updatedAt|A|1",
    },
    {
      kind: "index",
      artifact: "Contribution.Contribution_queue_status_updated_created_idx.3",
      detail: "createdAt|A|1",
    },
    {
      kind: "index",
      artifact: "Incident.Incident_tenant_status_activity_idx.1",
      detail: "municipalityId|A|1",
    },
    {
      kind: "index",
      artifact: "Incident.Incident_tenant_status_activity_idx.2",
      detail: "status|A|1",
    },
    {
      kind: "index",
      artifact: "Incident.Incident_tenant_status_activity_idx.3",
      detail: "lastActivityAt|A|1",
    },
    {
      kind: "index",
      artifact: "Incident.Incident_tenant_status_activity_idx.4",
      detail: "createdAt|A|1",
    },
    {
      kind: "index",
      artifact: "Need.Need_incident_priority_created_id_idx.1",
      detail: "incidentId|A|1",
    },
    {
      kind: "index",
      artifact: "Need.Need_incident_priority_created_id_idx.2",
      detail: "priority|D|1",
    },
    {
      kind: "index",
      artifact: "Need.Need_incident_priority_created_id_idx.3",
      detail: "createdAt|A|1",
    },
    {
      kind: "index",
      artifact: "Need.Need_incident_priority_created_id_idx.4",
      detail: "id|A|1",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_id_incidentId_key.1",
      detail: "id|A|0",
    },
    {
      kind: "index",
      artifact: "SafePoint.SafePoint_id_incidentId_key.2",
      detail: "incidentId|A|0",
    },
    {
      kind: "index",
      artifact: "Need.Need_id_safePointId_key.1",
      detail: "id|A|0",
    },
    {
      kind: "index",
      artifact: "Need.Need_id_safePointId_key.2",
      detail: "safePointId|A|0",
    },
    {
      kind: "foreign-key",
      artifact: "SafePoint.SafePoint_validatedById_fkey",
      detail: "validatedById>User.id|SET NULL|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Need.Need_validatedById_fkey",
      detail: "validatedById>User.id|SET NULL|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Need.Need_safePointId_incidentId_fkey.1",
      detail: "safePointId>SafePoint.id|RESTRICT|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Need.Need_safePointId_incidentId_fkey.2",
      detail: "incidentId>SafePoint.incidentId|RESTRICT|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Contribution.Contribution_needId_safePointId_fkey.1",
      detail: "needId>Need.id|RESTRICT|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Contribution.Contribution_needId_safePointId_fkey.2",
      detail: "safePointId>Need.safePointId|RESTRICT|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Contribution.Contribution_safePointId_incidentId_fkey.1",
      detail: "safePointId>SafePoint.id|RESTRICT|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Contribution.Contribution_safePointId_incidentId_fkey.2",
      detail: "incidentId>SafePoint.incidentId|RESTRICT|CASCADE",
    },
    {
      kind: "foreign-key",
      artifact: "Contribution.Contribution_incidentId_fkey",
      detail: "incidentId>Incident.id|CASCADE|CASCADE",
    },
    {
      kind: "check",
      artifact: "Need.Need_quantities_check",
      detail:
        "(`quantityNeeded` > 0 and `quantityReceived` >= 0 and `quantityReceived` <= `quantityNeeded`)",
    },
    {
      kind: "check",
      artifact: "Contribution.Contribution_quantities_check",
      detail:
        "(`quantity` > 0 and `deliveredQuantity` >= 0 and `deliveredQuantity` <= `quantity`)",
    },
    {
      kind: "check",
      artifact: "Incident.Incident_publicRadiusMeters_floor_check",
      detail:
        "(`publicRadiusMeters` is null or `publicRadiusMeters` between 1500 and 100000)",
    },
    {
      kind: "check",
      artifact: "Organization.Organization_notificationRadiusMeters_check",
      detail: "(`notificationRadiusMeters` between 1000 and 200000)",
    },
    {
      kind: "check",
      artifact: "Organization.Organization_notificationCooldownMinutes_check",
      detail: "(`notificationCooldownMinutes` between 5 and 10080)",
    },
  ];
}

function readyMariaDbSchemaArtifacts(): SchemaArtifact[] {
  return [
    ...readySchemaArtifacts().map((row) => {
      if (row.artifact === "ExternalDetection.footprintJson") {
        return { ...row, detail: "longtext|YES|<null>" };
      }
      if (row.kind === "column" && row.detail.startsWith("enum|NO|")) {
        const defaultValue = row.detail.slice("enum|NO|".length);
        return { ...row, detail: `enum|NO|'${defaultValue}'` };
      }
      return row;
    }),
    {
      kind: "check",
      artifact: "ExternalDetection.footprintJson",
      detail: "json_valid(`footprintJson`)",
    },
  ];
}

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

vi.mock("@/config/env", () => ({
  getDeploymentVersion: () => "test-release",
}));

describe("health readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.queryRaw.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 only when the required migration and schema signature exist", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(readySchemaArtifacts())
      .mockResolvedValueOnce(readyMySqlCheckEnforcement());

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      database: "available",
      version: "test-release",
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
    const schemaQuery = mocks.queryRaw.mock
      .calls[2]?.[0] as TemplateStringsArray;
    expect(schemaQuery.join(" ")).toContain("NON_UNIQUE");
    const enforcementQuery = mocks.queryRaw.mock
      .calls[3]?.[0] as TemplateStringsArray;
    expect(enforcementQuery.join(" ")).toContain("ENFORCED");
  });

  it("returns 200 for supported MariaDB with CHECK enforcement enabled", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(readyMariaDbProbe())
      .mockResolvedValueOnce([
        { checkConstraintChecks: 1, globalCheckConstraintChecks: 1 },
      ])
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(readyMariaDbSchemaArtifacts());

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
  });

  it("rejects MariaDB's LONGTEXT JSON alias without its JSON_VALID check", async () => {
    const artifacts = readyMariaDbSchemaArtifacts().filter(
      (row) =>
        row.kind !== "check" ||
        row.artifact !== "ExternalDetection.footprintJson",
    );
    mocks.queryRaw
      .mockResolvedValueOnce(readyMariaDbProbe())
      .mockResolvedValueOnce([
        { checkConstraintChecks: 1, globalCheckConstraintChecks: 1 },
      ])
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(artifacts);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
  });

  it("accepts MySQL 8.0.16's IS NULL metadata spelling", async () => {
    const artifacts = readySchemaArtifacts().map((row) =>
      row.artifact === "Incident.Incident_publicRadiusMeters_floor_check"
        ? {
            ...row,
            detail:
              "(isnull(`publicRadiusMeters`) or (`publicRadiusMeters` between 1500 and 100000))",
          }
        : row,
    );
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySql8016Probe())
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(artifacts)
      .mockResolvedValueOnce(readyMySqlCheckEnforcement());

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
  });

  it("returns 503 when MariaDB CHECK enforcement is disabled", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(readyMariaDbProbe())
      .mockResolvedValueOnce([
        { checkConstraintChecks: 0, globalCheckConstraintChecks: 1 },
      ]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when MariaDB CHECK enforcement is disabled globally", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(readyMariaDbProbe())
      .mockResolvedValueOnce([
        { checkConstraintChecks: 1, globalCheckConstraintChecks: 0 },
      ]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when a MySQL CHECK exists but is not enforced", async () => {
    const enforcement = readyMySqlCheckEnforcement().map((row) =>
      row.artifact === "Need.Need_quantities_check"
        ? { ...row, enforced: "NO" }
        : row,
    );
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(readySchemaArtifacts())
      .mockResolvedValueOnce(enforcement);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(4);
  });

  it("returns 503 for an uncertified database engine", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        available: 1,
        version: "8.0.36-28",
        versionComment: "Percona Server (GPL)",
      },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 503 for a MariaDB release outside the supported contract", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        available: 1,
        version: "11.7.2-MariaDB",
        versionComment: "MariaDB Server",
      },
    ]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", []],
    ["unfinished", [{ finishedAt: null, rolledBackAt: null }]],
    [
      "rolled back",
      [
        {
          finishedAt: new Date("2026-07-13T15:30:00Z"),
          rolledBackAt: new Date("2026-07-13T15:31:00Z"),
        },
      ],
    ],
  ])("returns 503 when the required migration is %s", async (_case, rows) => {
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(rows);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      database: "unavailable",
    });
  });

  it.each([
    ["SafePoint.validatedAt", "SafePoint.validatedAt"],
    ["SafePoint.validatedById", "SafePoint.validatedById"],
    ["a critical queue index", "SafePoint.SafePoint_public_idx.3"],
    ["a validation foreign key", "SafePoint.SafePoint_validatedById_fkey"],
    ["a destination invariant", "Need.Need_safePointId_incidentId_fkey.2"],
    ["an operational CHECK", "Need.Need_quantities_check"],
    ["an automatic fire footprint column", "ExternalDetection.footprintJson"],
    [
      "the automatic fire recency index",
      "ExternalDetection.ExternalDetection_status_detectedAt_idx.2",
    ],
    [
      "an upstream provider lifecycle column",
      "ExternalDetection.providerStatusChangedAt",
    ],
    ["the external source health table", "ExternalSourceSync.lastAttemptAt"],
    [
      "the provider lifecycle index",
      "ExternalDetection.ExternalDetection_provider_status_seen_idx.3",
    ],
    [
      "the external source health index",
      "ExternalSourceSync.ExternalSourceSync_status_attempt_idx.2",
    ],
  ])("returns 503 when %s drifts", async (_case, missingArtifact) => {
    const drifted = readySchemaArtifacts().filter(
      (row) => row.artifact !== missingArtifact,
    );
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(drifted);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      database: "unavailable",
    });
  });

  it("returns 503 when the public-radius constraint regresses", async () => {
    const drifted = readySchemaArtifacts().map((row) =>
      row.artifact === "Incident.Incident_publicRadiusMeters_floor_check"
        ? { ...row, detail: row.detail.replace("1500", "1000") }
        : row,
    );
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(drifted);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
  });

  it.each([
    "SafePoint.SafePoint_id_incidentId_key",
    "Need.Need_id_safePointId_key",
  ])(
    "returns 503 when integrity index %s stops being unique",
    async (index) => {
      const drifted = readySchemaArtifacts().map((row) =>
        row.kind === "index" && row.artifact.startsWith(`${index}.`)
          ? { ...row, detail: row.detail.replace(/\|0$/, "|1") }
          : row,
      );
      mocks.queryRaw
        .mockResolvedValueOnce(readyMySqlProbe())
        .mockResolvedValueOnce(readyMigration())
        .mockResolvedValueOnce(drifted);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const { GET } = await import("@/app/api/health/route");
      const response = await GET();

      expect(response.status).toBe(503);
    },
  );

  it("returns 503 when a critical index gains an unexpected column", async () => {
    const drifted = [
      ...readySchemaArtifacts(),
      {
        kind: "index" as const,
        artifact: "SafePoint.SafePoint_public_idx.4",
        detail: "updatedAt|A|1",
      },
    ];
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(readyMigration())
      .mockResolvedValueOnce(drifted);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
  });

  it("returns 503 when the metadata signature cannot be read", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(readyMySqlProbe())
      .mockResolvedValueOnce(readyMigration())
      .mockRejectedValueOnce(new Error("information_schema unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
  });

  it("returns 503 when the live database probe fails", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("database unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });
});
