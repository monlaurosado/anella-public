import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/health/route";

describe("health readiness against MySQL", () => {
  it("accepts the migrated database's real schema signature", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "anella",
      database: "available",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
