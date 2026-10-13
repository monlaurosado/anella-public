import { describe, expect, it } from "vitest";

import { assertSeedEnvironment } from "@/config/seed-environment";

describe("seed environment boundary", () => {
  it("rejects an omitted environment even for loopback MySQL", () => {
    expect(() =>
      assertSeedEnvironment(
        undefined,
        "mysql://anella:secret@127.0.0.1:3306/anella",
      ),
    ).toThrow(/ANELLA_ENV/);
  });

  it.each(["development", "test"] as const)(
    "rejects %s seeds against a remote database",
    (environment) => {
      expect(() =>
        assertSeedEnvironment(
          environment,
          "mysql://anella:secret@db.internal:3306/anella",
        ),
      ).toThrow(/loopback/);
    },
  );

  it("allows an explicit isolated test seed", () => {
    expect(
      assertSeedEnvironment(
        "test",
        "mysql://anella:secret@localhost:3307/anella",
      ),
    ).toBe("test");
  });

  it("allows an explicit production bootstrap on provider-local MySQL", () => {
    expect(
      assertSeedEnvironment(
        "production",
        "mysql://anella:secret@127.0.0.1:3306/anella",
      ),
    ).toBe("production");
  });

  it("rejects every seed execution in staging", () => {
    expect(() =>
      assertSeedEnvironment(
        "staging",
        "mysql://anella:secret@db.internal:3306/anella",
      ),
    ).toThrow(/deshabilitado en staging/);
  });
});
