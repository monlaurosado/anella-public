import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compare } from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

const runFile = promisify(execFile);
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const email = `bootstrap-${suffix}@vilabona.cat`;
const municipalityName = `Vilabona ${suffix}`;
const organizationName = `Ajuntament de Vilabona ${suffix}`;
const password = `Vb9!Riu_Clara-2026-${suffix}`;
const impostorEmail = `preexisting-${suffix}@vilabona.cat`;
const impostorMunicipalityName = `Vilabona preexistente ${suffix}`;
const impostorOrganizationName = `Ajuntament preexistente ${suffix}`;

async function runSeed(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  if (overrides.ANELLA_ENV === undefined) delete env.ANELLA_ENV;

  return runFile(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"],
    {
      cwd: process.cwd(),
      env,
      timeout: 20_000,
    },
  );
}

describe("production seed and bootstrap boundary", () => {
  afterAll(async () => {
    for (const accountEmail of [email, impostorEmail]) {
      const user = await prisma.user.findUnique({
        where: { email: accountEmail },
      });
      if (!user) continue;
      await prisma.auditLog.deleteMany({
        where: { action: "user.production_bootstrapped", entityId: user.id },
      });
      await prisma.user.delete({ where: { id: user.id } });
    }
    for (const [name, organization] of [
      [municipalityName, organizationName],
      [impostorMunicipalityName, impostorOrganizationName],
    ] as const) {
      const municipality = await prisma.municipality.findFirst({
        where: { name },
      });
      if (municipality) {
        await prisma.organization.deleteMany({
          where: { municipalityId: municipality.id, name: organization },
        });
        await prisma.municipality.delete({ where: { id: municipality.id } });
      }
    }
  });

  it("fails closed when ANELLA_ENV is omitted", async () => {
    const run = runSeed({
      ANELLA_ENV: undefined,
      SEED_DEMO_DATA: "false",
      SEED_BOOTSTRAP_ADMIN: "false",
    });

    await expect(run).rejects.toMatchObject({ code: 1 });
  });

  it("rejects simulation data in production", async () => {
    const run = runSeed({
      ANELLA_ENV: "production",
      SEED_DEMO_DATA: "true",
      SEED_BOOTSTRAP_ADMIN: "false",
    });

    await expect(run).rejects.toMatchObject({ code: 1 });
  });

  it("rejects bootstrap passwords longer than bcrypt's 72 UTF-8 bytes", async () => {
    const run = runSeed({
      ANELLA_ENV: "production",
      SEED_DEMO_DATA: "false",
      SEED_RESET_ADMIN_PASSWORD: "false",
      SEED_BOOTSTRAP_ADMIN: "true",
      SEED_ADMIN_EMAIL: `long-password-${suffix}@vilabona.cat`,
      SEED_ADMIN_PASSWORD: `A1!bcdefghij${"é".repeat(40)}`,
      SEED_ADMIN_NAME: "Administradora municipal",
      SEED_MUNICIPALITY_NAME: `Vilabona password ${suffix}`,
      SEED_ORGANIZATION_NAME: `Ajuntament password ${suffix}`,
      SEED_BOOTSTRAP_TICKET: `CHG-PASSWORD-${suffix}`,
      SEED_BOOTSTRAP_OPERATOR: `operador-password-${suffix}`,
    });

    await expect(run).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("72 bytes UTF-8"),
    });
  });

  it("rejects a matching preexisting account without bootstrap provenance", async () => {
    const municipality = await prisma.municipality.create({
      data: { name: impostorMunicipalityName, country: "ES" },
    });
    const organization = await prisma.organization.create({
      data: {
        name: impostorOrganizationName,
        kind: "MUNICIPALITY",
        municipalityId: municipality.id,
      },
    });
    const existing = await prisma.user.create({
      data: {
        email: impostorEmail,
        name: "Cuenta preexistente",
        role: UserRole.MUNICIPAL_ADMIN,
        isActive: true,
        mustChangePassword: false,
        municipalityId: municipality.id,
        organizationId: organization.id,
      },
    });

    const run = runSeed({
      ANELLA_ENV: "production",
      SEED_DEMO_DATA: "false",
      SEED_RESET_ADMIN_PASSWORD: "false",
      SEED_BOOTSTRAP_ADMIN: "true",
      SEED_ADMIN_EMAIL: impostorEmail,
      SEED_ADMIN_PASSWORD: `Vb9!Credential-Not-${suffix}`,
      SEED_ADMIN_NAME: "Administradora municipal",
      SEED_MUNICIPALITY_NAME: impostorMunicipalityName,
      SEED_ORGANIZATION_NAME: impostorOrganizationName,
      SEED_BOOTSTRAP_TICKET: `CHG-PRE-${suffix}`,
      SEED_BOOTSTRAP_OPERATOR: `operador-pre-${suffix}`,
    });

    await expect(run).rejects.toMatchObject({ code: 1 });
    await expect(
      prisma.auditLog.count({
        where: {
          action: "user.production_bootstrapped",
          entityId: existing.id,
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: existing.id } }),
    ).resolves.toMatchObject({
      passwordHash: null,
      mustChangePassword: false,
    });
  });

  it("bootstraps one audited admin idempotently with mandatory password change", async () => {
    const environment = {
      ANELLA_ENV: "production",
      SEED_DEMO_DATA: "false",
      SEED_RESET_ADMIN_PASSWORD: "false",
      SEED_BOOTSTRAP_ADMIN: "true",
      SEED_ADMIN_EMAIL: email,
      SEED_ADMIN_PASSWORD: password,
      SEED_ADMIN_NAME: "Administradora municipal",
      SEED_MUNICIPALITY_NAME: municipalityName,
      SEED_ORGANIZATION_NAME: organizationName,
      SEED_BOOTSTRAP_TICKET: `CHG-${suffix}`,
      SEED_BOOTSTRAP_OPERATOR: `operador-${suffix}`,
    };

    await Promise.all([runSeed(environment), runSeed(environment)]);
    await runSeed(environment);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({
      role: UserRole.MUNICIPAL_ADMIN,
      isActive: true,
      mustChangePassword: true,
    });
    await expect(compare(password, user.passwordHash!)).resolves.toBe(true);
    await expect(
      prisma.auditLog.count({
        where: { action: "user.production_bootstrapped", entityId: user.id },
      }),
    ).resolves.toBe(1);
  });
});
