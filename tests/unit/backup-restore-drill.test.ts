import { describe, expect, it } from "vitest";

import {
  assertEqualDigests,
  BASE_TABLES,
  isOracleMySqlDumpVersion,
  mysqlDumpCompatibilityArguments,
  parseDrillConfiguration,
  quoteMySqlOptionValue,
  type TableDigest,
} from "../../scripts/backup-restore-drill";

describe("local backup/restore drill safety boundary", () => {
  it.each([undefined, "", "production"])(
    "rejects ANELLA_ENV=%s",
    (environment) => {
      expect(() =>
        parseDrillConfiguration({
          ANELLA_ENV: environment,
          DATABASE_URL: "mysql://anella:secret@127.0.0.1:3307/anella",
        }),
      ).toThrow(/development o test/);
    },
  );

  it("rejects a remote source database", () => {
    expect(() =>
      parseDrillConfiguration({
        ANELLA_ENV: "test",
        DATABASE_URL: "mysql://anella:secret@db.internal:3306/anella",
      }),
    ).toThrow(/loopback/);
  });

  it("rejects an administrator connection to another local server", () => {
    expect(() =>
      parseDrillConfiguration({
        ANELLA_ENV: "development",
        DATABASE_URL: "mysql://anella:secret@127.0.0.1:3307/anella",
        ANELLA_DRILL_ADMIN_DATABASE_URL:
          "mysql://root:admin-secret@127.0.0.1:3308/mysql",
      }),
    ).toThrow(/mismo host y puerto/);
  });

  it("accepts and decodes explicit loopback credentials", () => {
    const config = parseDrillConfiguration({
      ANELLA_ENV: "test",
      DATABASE_URL: "mysql://anella:s%40fe%3Apass@[::1]:3307/anella_test",
      ANELLA_DRILL_ADMIN_DATABASE_URL:
        "mysql://root:admin%23pass@[::1]:3307/mysql",
    });

    expect(config).toMatchObject({
      environment: "test",
      source: {
        host: "::1",
        port: 3307,
        user: "anella",
        password: "s@fe:pass",
        database: "anella_test",
      },
      administrator: {
        host: "::1",
        port: 3307,
        user: "root",
        password: "admin#pass",
        database: "mysql",
      },
    });
  });

  it("quotes option-file values without permitting line injection", () => {
    expect(quoteMySqlOptionValue('a\\b"c')).toBe('"a\\\\b\\"c"');
    expect(() => quoteMySqlOptionValue("safe\ninjected=1")).toThrow(
      /caracteres de control/,
    );
  });

  it("adds only the Oracle mysqldump compatibility flags", () => {
    const oracleVersion =
      "mysqldump  Ver 10.13 Distrib 8.4.0, for macos14.7 (arm64)";
    const mariaDbVersion =
      "mysqldump  Ver 10.19 Distrib 10.11.14-MariaDB, for debian-linux-gnu";

    expect(isOracleMySqlDumpVersion(oracleVersion)).toBe(true);
    expect(mysqlDumpCompatibilityArguments(oracleVersion)).toEqual([
      "--set-gtid-purged=OFF",
      "--column-statistics=0",
    ]);
    expect(isOracleMySqlDumpVersion(mariaDbVersion)).toBe(false);
    expect(mysqlDumpCompatibilityArguments(mariaDbVersion)).toEqual([]);
  });

  it("detects restored content corruption even when row counts match", () => {
    const original = new Map<string, TableDigest>();
    const corrupted = new Map<string, TableDigest>();
    for (const table of [...BASE_TABLES, "_prisma_migrations"]) {
      original.set(table, { rows: 1, sha256: `${table}-original` });
      corrupted.set(table, { rows: 1, sha256: `${table}-original` });
    }
    corrupted.set("Incident", { rows: 1, sha256: "same-count-corruption" });

    expect(() =>
      assertEqualDigests(
        original,
        corrupted,
        "El contenido restaurado no coincide",
      ),
    ).toThrow(/contenido restaurado.*Incident/i);
  });
});
