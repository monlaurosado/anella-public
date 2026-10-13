import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260713203000_destination_invariants/migration.sql",
);

describe("destination invariant migration", () => {
  it("installs stronger foreign keys before removing their predecessors", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const addNeedComposite = sql.indexOf(
      "ADD CONSTRAINT `Need_safePointId_incidentId_fkey`",
    );
    const dropNeedLegacy = sql.indexOf(
      "DROP FOREIGN KEY `Need_safePointId_fkey`",
    );
    const addContributionComposite = sql.indexOf(
      "ADD CONSTRAINT `Contribution_needId_safePointId_fkey`",
    );
    const dropContributionLegacy = sql.indexOf(
      "DROP FOREIGN KEY `Contribution_needId_fkey`",
    );
    const dropNullableDestination = sql.indexOf(
      "DROP FOREIGN KEY `Contribution_safePointId_fkey`",
    );
    const makeRequired = sql.indexOf(
      "MODIFY `safePointId` VARCHAR(191) NOT NULL",
    );
    const addRestrictedDestination = sql.indexOf(
      "ADD CONSTRAINT `Contribution_safePointId_fkey`",
    );

    for (const position of [
      addNeedComposite,
      dropNeedLegacy,
      addContributionComposite,
      dropContributionLegacy,
      dropNullableDestination,
      makeRequired,
      addRestrictedDestination,
    ]) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    expect(addNeedComposite).toBeLessThan(dropNeedLegacy);
    expect(addContributionComposite).toBeLessThan(dropContributionLegacy);
    expect(addContributionComposite).toBeLessThan(dropNullableDestination);
    expect(dropNullableDestination).toBeLessThan(makeRequired);
    expect(makeRequired).toBeLessThan(addRestrictedDestination);
  });

  it("audits and backfills only the need's existing safe destination before NOT NULL", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const auditBackfill = sql.indexOf(
      "migration.contribution_destination_backfilled",
    );
    const dataBackfill = sql.indexOf(
      "SET contribution.`safePointId` = need.`safePointId`",
    );
    const makeRequired = sql.indexOf(
      "MODIFY `safePointId` VARCHAR(191) NOT NULL",
    );
    const addComposite = sql.indexOf(
      "ADD CONSTRAINT `Contribution_needId_safePointId_fkey`",
    );

    expect(auditBackfill).toBeGreaterThanOrEqual(0);
    expect(dataBackfill).toBeGreaterThan(auditBackfill);
    expect(addComposite).toBeGreaterThan(dataBackfill);
    expect(makeRequired).toBeGreaterThan(addComposite);
  });
});
