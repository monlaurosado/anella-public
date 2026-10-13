import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

describe("official Spanish municipality catalog", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads every 2026 INE municipality with operational coordinates", async () => {
    const [countRows, madrid, barcelona] = await Promise.all([
      prisma.$queryRaw<Array<{ total: bigint | number }>>`
        SELECT COUNT(*) AS total
        FROM Municipality
        WHERE id REGEXP '^es-[0-9]{5}$'
          AND country = 'ES'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
      `,
      prisma.municipality.findUnique({ where: { id: "es-28079" } }),
      prisma.municipality.findUnique({ where: { id: "es-08019" } }),
    ]);

    expect(Number(countRows[0]?.total ?? 0)).toBe(8_132);
    expect(madrid).toMatchObject({
      name: "Madrid",
      province: "Madrid",
      region: "Comunidad de Madrid",
      country: "ES",
    });
    expect(barcelona).toMatchObject({
      name: "Barcelona",
      province: "Barcelona",
      region: "Cataluña/Catalunya",
      country: "ES",
    });
  });

  it("supports the Prisma string filters used by national municipality search", async () => {
    const [officialCount, madrid, barcelonaProvince] = await Promise.all([
      prisma.municipality.count({
        where: { id: { startsWith: "es-" }, country: "ES" },
      }),
      prisma.municipality.findFirst({
        where: {
          id: { startsWith: "es-" },
          name: { contains: "Madrid" },
        },
        select: { id: true, name: true },
      }),
      prisma.municipality.findFirst({
        where: {
          id: { startsWith: "es-" },
          province: { contains: "Barcelona" },
        },
        select: { id: true, province: true },
      }),
    ]);

    expect(officialCount).toBe(8_132);
    expect(madrid?.name).toContain("Madrid");
    expect(barcelonaProvince?.province).toBe("Barcelona");
  });
});
