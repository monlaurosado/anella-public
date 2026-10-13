import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260714180000_external_fire_source_health/migration.sql",
);

describe("external fire source health migration", () => {
  it("backfills provider freshness without changing Anella's review status", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("ADD COLUMN `providerStatus`");
    expect(sql).toContain("ADD COLUMN `lastSeenAt`");
    expect(sql).toContain("SET `provider` = CAST(`source` AS CHAR)");
    expect(sql).toContain("`lastSeenAt` = `updatedAt`");
    expect(sql).not.toMatch(/SET\s+`status`\s*=/u);
  });

  it("creates one bounded aggregate health row per upstream feed", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE `ExternalSourceSync`");
    expect(sql).toContain("PRIMARY KEY (`sourceKey`)");
    expect(sql).toContain("`error` VARCHAR(500) NULL");
    expect(sql).toContain("ExternalSourceSync_status_attempt_idx");
  });
});
