import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => Promise<unknown>) => loader,
}));

import { GET as getIncidentApi } from "@/app/api/incidents/route";
import {
  ContributionStatus,
  DetectionSource,
  ExternalDetectionStatus,
  IncidentStatus,
  IncidentType,
  NeedStatus,
  NeedType,
  Priority,
  PublicLocationMode,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

describe("anonymous incident projection", () => {
  const suffix = String(Date.now());
  const incidentCode = `PROJECTION-${suffix}`;
  const incompleteProvenanceCodes = [
    `PROV-VA-${suffix}`,
    `PROV-VB-${suffix}`,
    `PROV-LA-${suffix}`,
    `PROV-LB-${suffix}`,
  ];
  const detectionExternalId = `PROJECTION-DETECTION-${suffix}`;

  afterAll(async () => {
    await prisma.externalDetection.deleteMany({
      where: { externalId: detectionExternalId },
    });
    await prisma.incident.deleteMany({
      where: {
        publicCode: { in: [incidentCode, ...incompleteProvenanceCodes] },
      },
    });
    await prisma.$disconnect();
  });

  it("returns an explicit allowlist and never serializes operational or personal fields", async () => {
    const municipality = await prisma.municipality.findFirstOrThrow();
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    const now = new Date();
    const incident = await prisma.incident.create({
      data: {
        publicCode: incidentCode,
        title: "SIMULACRO de contrato público",
        type: IncidentType.WILDFIRE,
        status: IncidentStatus.ACTIVE,
        priority: Priority.CRITICAL,
        publicSummary: "Resumen verificado para probar el contrato público.",
        safetyNotice:
          "No acudir a la zona operativa bajo ninguna circunstancia.",
        operationalLatitude: 41.123456,
        operationalLongitude: 2.654321,
        radiusMeters: 321,
        publicLocationMode: PublicLocationMode.GENERALIZED_AREA,
        publicLatitude: 40.12,
        publicLongitude: 1.23,
        publicRadiusMeters: 2500,
        publicLocationLabel: "Área municipal generalizada",
        publicLocationApprovedAt: now,
        publicLocationApprovedById: user.id,
        verifiedAt: now,
        verifiedById: user.id,
        municipalityId: municipality.id,
      },
    });
    const missingProvenanceFields = [
      "verifiedAt",
      "verifiedById",
      "publicLocationApprovedAt",
      "publicLocationApprovedById",
    ] as const;
    await prisma.incident.createMany({
      data: missingProvenanceFields.map((missingField, index) => ({
        publicCode: incompleteProvenanceCodes[index]!,
        title: `Incidente sin procedencia ${missingField} — no publicar`,
        type: IncidentType.OTHER,
        status: IncidentStatus.ACTIVE,
        priority: Priority.HIGH,
        publicSummary: "Este incidente incompleto nunca debe ser público.",
        safetyNotice: "No acudir a la zona operativa.",
        operationalLatitude: 40.2 + index / 100,
        operationalLongitude: 1.3 + index / 100,
        publicLocationMode: PublicLocationMode.MUNICIPALITY_ONLY,
        publicLocationLabel: "Municipio de prueba",
        verifiedAt: missingField === "verifiedAt" ? null : now,
        verifiedById: missingField === "verifiedById" ? null : user.id,
        publicLocationApprovedAt:
          missingField === "publicLocationApprovedAt" ? null : now,
        publicLocationApprovedById:
          missingField === "publicLocationApprovedById" ? null : user.id,
        municipalityId: municipality.id,
      })),
    });
    const point = await prisma.safePoint.create({
      data: {
        incidentId: incident.id,
        municipalityId: municipality.id,
        name: "Punto seguro de simulacro",
        address: "Plaza Segura, 1",
        instructions: "Accede por la entrada señalizada.",
        latitude: 40.13,
        longitude: 1.24,
        qrToken: `qr-secret-${suffix}`,
        pointStatus: "ACTIVE",
        publishedAt: now,
        validatedAt: now,
        validatedById: user.id,
      },
    });
    const unapprovedPoint = await prisma.safePoint.create({
      data: {
        incidentId: incident.id,
        municipalityId: municipality.id,
        name: "Punto aún no aprobado — no publicar",
        address: "Dirección aún no aprobada, 99",
        instructions: "Instrucción pendiente de revisión humana.",
        latitude: 40.14,
        longitude: 1.25,
        qrToken: `qr-unapproved-${suffix}`,
      },
    });
    const need = await prisma.need.create({
      data: {
        incidentId: incident.id,
        safePointId: point.id,
        type: NeedType.WATER,
        title: "Agua de simulacro",
        priority: Priority.HIGH,
        quantityNeeded: 20,
        unit: "cajas",
        status: NeedStatus.ACTIVE,
        validatedAt: now,
        validatedById: user.id,
        publishedAt: now,
        deadline: new Date(now.getTime() + 60 * 60 * 1000),
      },
    });
    await prisma.need.createMany({
      data: [
        {
          incidentId: incident.id,
          safePointId: unapprovedPoint.id,
          type: NeedType.OTHER,
          title: "Necesidad validada con destino no aprobado — no publicar",
          priority: Priority.HIGH,
          quantityNeeded: 1,
          unit: "unidad",
          status: NeedStatus.ACTIVE,
          validatedAt: now,
          validatedById: user.id,
          publishedAt: now,
          deadline: new Date(now.getTime() + 60 * 60 * 1000),
        },
        {
          incidentId: incident.id,
          safePointId: point.id,
          type: NeedType.OTHER,
          title: "Necesidad activa sin validación humana — no publicar",
          priority: Priority.HIGH,
          quantityNeeded: 2,
          unit: "unidades",
          status: NeedStatus.ACTIVE,
          validatedAt: null,
          validatedById: null,
          publishedAt: now,
          deadline: new Date(now.getTime() + 60 * 60 * 1000),
        },
        {
          incidentId: incident.id,
          safePointId: point.id,
          type: NeedType.OTHER,
          title: "Necesidad activa validada pero no publicada — no publicar",
          priority: Priority.HIGH,
          quantityNeeded: 3,
          unit: "unidades",
          status: NeedStatus.ACTIVE,
          validatedAt: now,
          validatedById: user.id,
          publishedAt: null,
          deadline: new Date(now.getTime() + 60 * 60 * 1000),
        },
      ],
    });
    await prisma.contribution.create({
      data: {
        publicCode: `AN-PROJ-${suffix.slice(-10)}`,
        incidentId: incident.id,
        cancelTokenHash: "b".repeat(64),
        needId: need.id,
        safePointId: point.id,
        citizenName: "Nombre privado irrepetible",
        citizenPhone: "+34999111222",
        citizenEmail: "private-projection@example.test",
        quantity: 3,
        status: ContributionStatus.PLEDGED,
        notes: "Nota privada irrepetible",
        consentAt: now,
      },
    });
    await prisma.externalDetection.create({
      data: {
        source: DetectionSource.NASA_FIRMS,
        externalId: detectionExternalId,
        latitude: 41.223456,
        longitude: 2.754321,
        detectedAt: now,
        status: ExternalDetectionStatus.LINKED,
        municipalityId: municipality.id,
        linkedIncidentId: incident.id,
        rawJson: { privateRawSignal: "never-public" },
      },
    });

    const response = await getIncidentApi();
    const payload = (await response.json()) as {
      incidents: Array<Record<string, unknown>>;
    };
    const projected = payload.incidents.find(
      (item) => item.publicCode === incidentCode,
    );
    expect(projected).toBeDefined();
    expect(payload.incidents.map((item) => item.publicCode)).not.toEqual(
      expect.arrayContaining(incompleteProvenanceCodes),
    );
    expect(Object.keys(projected!).sort()).toEqual(
      [
        "id",
        "municipality",
        "needs",
        "notices",
        "priority",
        "publicArea",
        "publicCode",
        "publicSummary",
        "responsibleOrgName",
        "safePoints",
        "safetyNotice",
        "status",
        "timeZone",
        "title",
        "type",
        "updatedAt",
      ].sort(),
    );

    const serialized = JSON.stringify(projected);
    for (const forbidden of [
      "operationalLatitude",
      "operationalLongitude",
      "41.123456",
      "2.654321",
      "41.223456",
      "2.754321",
      `qr-secret-${suffix}`,
      `qr-unapproved-${suffix}`,
      "Punto aún no aprobado — no publicar",
      "Dirección aún no aprobada, 99",
      "Necesidad validada con destino no aprobado — no publicar",
      "Necesidad activa sin validación humana — no publicar",
      "Necesidad activa validada pero no publicada — no publicar",
      detectionExternalId,
      "privateRawSignal",
      "Nombre privado irrepetible",
      "+34999111222",
      "private-projection@example.test",
      "Nota privada irrepetible",
      "cancelTokenHash",
      "validatedByName",
      "externalDetections",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(
      (projected!.needs as Array<{ title: string }>).map(({ title }) => title),
    ).toEqual(["Agua de simulacro"]);
    expect(serialized).toContain('"radiusMeters":2500');
    expect(serialized).not.toContain('"radiusMeters":321');
    expect(
      Object.keys((projected!.safePoints as Array<Record<string, unknown>>)[0]),
    ).not.toContain("qrToken");
  });
});
