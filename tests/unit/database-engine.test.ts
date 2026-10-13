import { describe, expect, it } from "vitest";

import {
  databaseEngineLabel,
  databaseMeetsAnellaContract,
  identifyDatabaseEngine,
} from "@/lib/database-engine";

describe("supported database engine contract", () => {
  it.each([
    ["8.0.15", "MySQL Community Server - GPL", false],
    ["8.0.16", "MySQL Community Server - GPL", true],
    ["8.4.10", "MySQL Community Server - GPL", true],
    ["11.7.2-MariaDB", "MariaDB Server", false],
    ["11.8.0-MariaDB", "MariaDB Server", true],
    ["11.8.8-MariaDB-log", "MariaDB Server", true],
    ["5.5.5-11.8.8-MariaDB", "MariaDB Server", true],
    ["invalid", "MySQL Community Server - GPL", false],
  ])("classifies CHECK support for %s", (version, versionComment, expected) => {
    expect(databaseMeetsAnellaContract(version, versionComment)).toBe(expected);
  });

  it("identifies MariaDB independently of casing and compatibility prefixes", () => {
    expect(
      identifyDatabaseEngine("5.5.5-11.8.8-MariaDB", "mariadb server"),
    ).toBe("mariadb");
    expect(databaseEngineLabel("11.8.8-MariaDB", "MariaDB Server")).toBe(
      "MariaDB",
    );
  });

  it("keeps the MySQL label for the reference MySQL server", () => {
    expect(
      identifyDatabaseEngine("8.4.10", "MySQL Community Server - GPL"),
    ).toBe("mysql");
    expect(databaseEngineLabel("8.4.10", "MySQL Community Server - GPL")).toBe(
      "MySQL",
    );
  });

  it.each([
    ["8.0.36-28", "Percona Server (GPL)"],
    ["8.0.mysql_aurora.3.08.2", "Source distribution"],
    ["15.4", "PostgreSQL"],
  ])("fails closed for an uncertified engine: %s", (version, comment) => {
    expect(identifyDatabaseEngine(version, comment)).toBe("unknown");
    expect(databaseMeetsAnellaContract(version, comment)).toBe(false);
    expect(databaseEngineLabel(version, comment)).toBe("motor desconocido");
  });
});
