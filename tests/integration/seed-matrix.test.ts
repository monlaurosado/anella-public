import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compare } from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";

import {
  ContributionStatus,
  ExternalDetectionStatus,
  IncidentStatus,
  NeedStatus,
  UserRole,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

const execFileAsync = promisify(execFile);

async function demoCounts() {
  const [incidents, safePoints, needs, contributions, users, detections] =
    await Promise.all([
      prisma.incident.count({
        where: {
          OR: [
            { publicCode: "DEMO-001" },
            { publicCode: { startsWith: "SIM-" } },
          ],
        },
      }),
      prisma.safePoint.count({ where: { name: { startsWith: "SIMULACRO" } } }),
      prisma.need.count({ where: { title: { startsWith: "SIMULACRO" } } }),
      prisma.contribution.count({
        where: { citizenName: { startsWith: "SIMULACRO" } },
      }),
      prisma.user.count({ where: { email: { endsWith: "@anella.local" } } }),
      prisma.externalDetection.count({
        where: {
          rawJson: { path: "$.notice", string_contains: "SIMULACRO" },
        },
      }),
    ]);

  return { incidents, safePoints, needs, contributions, users, detections };
}

describe("idempotent simulation seed contract", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("runs the real demo seed twice without duplicating its matrix", async () => {
    const before = await demoCounts();

    for (let run = 0; run < 2; run += 1) {
      await execFileAsync("npm", ["run", "db:seed"], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 30_000,
      });
    }

    expect(await demoCounts()).toEqual(before);
  }, 45_000);

  it("keeps the exact local administrator contract outside production", async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@anella.local" },
    });

    expect(admin).toMatchObject({
      role: UserRole.MUNICIPAL_ADMIN,
      isActive: true,
      mustChangePassword: false,
    });
    expect(admin.passwordHash).toBeTruthy();
    await expect(
      compare("AnellaLocal-2026!", admin.passwordHash!),
    ).resolves.toBe(true);
  });

  it("contains the full visibly marked operational matrix without duplicates", async () => {
    const incidents = await prisma.incident.findMany({
      where: { publicCode: { startsWith: "SIM-" } },
      include: {
        safePoints: true,
        needs: { include: { contributions: true } },
      },
      orderBy: { publicCode: "asc" },
    });
    const activeIncident = await prisma.incident.findUniqueOrThrow({
      where: { publicCode: "DEMO-001" },
      include: {
        safePoints: true,
        needs: { include: { contributions: true } },
      },
    });
    const allIncidents = [...incidents, activeIncident];

    expect(allIncidents).toHaveLength(6);
    expect(
      new Set(allIncidents.map((incident) => incident.publicCode)).size,
    ).toBe(6);
    expect(
      allIncidents.every((incident) => incident.title.startsWith("SIMULACRO")),
    ).toBe(true);
    expect(new Set(allIncidents.map((incident) => incident.status))).toEqual(
      new Set([
        IncidentStatus.DRAFT,
        IncidentStatus.PENDING_VALIDATION,
        IncidentStatus.ACTIVE,
        IncidentStatus.MONITORING,
        IncidentStatus.RESOLVED,
        IncidentStatus.CANCELLED,
      ]),
    );

    expect(activeIncident.safePoints.length).toBeGreaterThanOrEqual(2);
    expect(
      activeIncident.safePoints.filter((point) => point.isActive),
    ).toHaveLength(2);
    expect(
      activeIncident.safePoints.every((point) =>
        point.name.startsWith("SIMULACRO"),
      ),
    ).toBe(true);

    const needs = activeIncident.needs;
    expect(new Set(needs.map((need) => need.status))).toEqual(
      new Set([
        NeedStatus.DRAFT,
        NeedStatus.ACTIVE,
        NeedStatus.COVERED,
        NeedStatus.EXPIRED,
        NeedStatus.CANCELLED,
      ]),
    );
    expect(needs.every((need) => need.title.startsWith("SIMULACRO"))).toBe(
      true,
    );

    const contributions = needs
      .flatMap((need) => need.contributions)
      .filter((contribution) => contribution.publicCode.startsWith("SIM-AP-"));
    expect(contributions).toHaveLength(6);
    expect(
      new Set(contributions.map((contribution) => contribution.publicCode))
        .size,
    ).toBe(6);
    expect(
      new Set(contributions.map((contribution) => contribution.status)),
    ).toEqual(
      new Set([
        ContributionStatus.PLEDGED,
        ContributionStatus.EN_ROUTE,
        ContributionStatus.PARTIALLY_DELIVERED,
        ContributionStatus.DELIVERED,
        ContributionStatus.CANCELLED,
        ContributionStatus.NO_SHOW,
      ]),
    );
    expect(
      contributions.every((contribution) =>
        contribution.citizenName.startsWith("SIMULACRO"),
      ),
    ).toBe(true);
  });

  it("has separate coordinator/admin accounts and a private pending signal", async () => {
    const [coordinators, pendingDetection] = await Promise.all([
      prisma.user.findMany({
        where: {
          email: { endsWith: "@anella.local" },
          role: { in: [UserRole.COORDINATOR, UserRole.MUNICIPAL_ADMIN] },
        },
        select: { role: true },
      }),
      prisma.externalDetection.findFirst({
        where: {
          status: ExternalDetectionStatus.PENDING,
          rawJson: { path: "$.notice", string_contains: "SIMULACRO" },
        },
        select: { id: true, linkedIncidentId: true },
      }),
    ]);

    expect(new Set(coordinators.map((user) => user.role))).toEqual(
      new Set([UserRole.COORDINATOR, UserRole.MUNICIPAL_ADMIN]),
    );
    expect(pendingDetection).toMatchObject({ linkedIncidentId: null });
  });
});
