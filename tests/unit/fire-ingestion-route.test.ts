import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getAutomaticFireIngestionConfig: mocks.config,
}));

vi.mock("@/services/fire-ingestion", () => ({
  syncAutomaticFireDetections: mocks.sync,
}));

function request(secret?: string) {
  return new NextRequest("http://localhost/api/internal/fire-detections/sync", {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("automatic fire ingestion route", () => {
  beforeEach(() => {
    mocks.config.mockReset();
    mocks.sync.mockReset();
  });

  it("is fail-closed while automatic ingestion is disabled", async () => {
    mocks.config.mockReturnValue({ enabled: false, secret: null });
    const { POST } =
      await import("@/app/api/internal/fire-detections/sync/route");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects a missing or incorrect bearer secret", async () => {
    const secret = "0123456789abcdef-automatic-fire-secret";
    mocks.config.mockReturnValue({ enabled: true, secret });
    const { POST } =
      await import("@/app/api/internal/fire-detections/sync/route");
    await expect(POST(request())).resolves.toMatchObject({ status: 401 });
    await expect(POST(request(`${secret}-wrong`))).resolves.toMatchObject({
      status: 401,
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("runs an authenticated sync and returns its operational status", async () => {
    const secret = "0123456789abcdef-automatic-fire-secret";
    mocks.config.mockReturnValue({ enabled: true, secret });
    mocks.sync.mockResolvedValue({
      ok: true,
      status: "completed",
      imported: 3,
      received: 4,
      rejected: 1,
      assigned: 3,
      unassigned: 0,
      generatedAt: "2026-07-14T14:00:00.000Z",
      sources: [],
    });
    const { POST } =
      await import("@/app/api/internal/fire-detections/sync/route");
    const response = await POST(request(secret));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, imported: 3 });
    expect(mocks.sync).toHaveBeenCalledOnce();
  });
});
