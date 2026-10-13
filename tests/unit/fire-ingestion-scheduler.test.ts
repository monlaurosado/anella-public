import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  sync: vi.fn(),
  ingestionModuleLoaded: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/env", () => ({
  getAutomaticFireIngestionConfig: mocks.config,
}));
vi.mock("@/services/fire-ingestion", () => {
  mocks.ingestionModuleLoaded();
  return { syncAutomaticFireDetections: mocks.sync };
});

const schedulerGlobal = globalThis as typeof globalThis & {
  anellaFireIngestionScheduler?: unknown;
};

describe("automatic fire ingestion scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mocks.config.mockReset();
    mocks.sync.mockReset();
    mocks.ingestionModuleLoaded.mockReset();
    delete schedulerGlobal.anellaFireIngestionScheduler;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete schedulerGlobal.anellaFireIngestionScheduler;
  });

  it("does not schedule anything while ingestion is disabled", async () => {
    mocks.config.mockReturnValue({ enabled: false });
    const { startAutomaticFireIngestionScheduler } =
      await import("@/services/fire-ingestion-scheduler");
    expect(startAutomaticFireIngestionScheduler()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.ingestionModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("runs after startup and at the configured interval without duplicate timers", async () => {
    mocks.config.mockReturnValue({ enabled: true, intervalMinutes: 5 });
    mocks.sync.mockResolvedValue({
      ok: true,
      status: "completed",
      degraded: false,
      imported: 0,
      updated: 0,
      statusChanged: 0,
      received: 0,
      rejected: 0,
      assigned: 0,
      unassigned: 0,
      generatedAt: "2026-07-14T12:00:00.000Z",
      sources: [],
    });
    const { startAutomaticFireIngestionScheduler } =
      await import("@/services/fire-ingestion-scheduler");

    expect(startAutomaticFireIngestionScheduler()).toBe(true);
    expect(startAutomaticFireIngestionScheduler()).toBe(false);
    expect(mocks.ingestionModuleLoaded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.ingestionModuleLoaded).toHaveBeenCalledTimes(1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 1_000 + 30_000);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
});
