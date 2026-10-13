import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260713150000_public_radius_floor/migration.sql",
);

describe("public radius privacy-floor migration", () => {
  it("replaces the CHECK atomically with engine-specific drop syntax", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("VERSION() LIKE '%MariaDB%'");
    expect(sql).toContain(
      "DROP CONSTRAINT `Incident_publicRadiusMeters_check`, ADD CONSTRAINT `Incident_publicRadiusMeters_floor_check`",
    );
    expect(sql).toContain(
      "DROP CHECK `Incident_publicRadiusMeters_check`, ADD CONSTRAINT `Incident_publicRadiusMeters_floor_check`",
    );
    expect(sql).toContain(
      "PREPARE replace_public_radius_check FROM @replace_public_radius_check",
    );
    expect(sql).toContain("EXECUTE replace_public_radius_check");
    expect(sql).toContain("DEALLOCATE PREPARE replace_public_radius_check");
  });

  it("generalizes historical radii before installing the stronger CHECK", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const backfill = sql.indexOf("SET `publicRadiusMeters` = 1500");
    const replacement = sql.indexOf("SET @replace_public_radius_check");

    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(replacement).toBeGreaterThan(backfill);
    expect(sql).toContain("BETWEEN 1500 AND 100000");
  });
});
