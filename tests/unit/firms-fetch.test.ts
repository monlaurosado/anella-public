import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getFirmsConfig: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/config/env", () => ({
  getFirmsConfig: mocks.getFirmsConfig,
}));
vi.mock("@/lib/dal", () => ({
  requireCoordinator: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { FIRMS_RESPONSE_LIMITS } from "@/lib/firms";
import { fetchNasaFirmsDetections } from "@/services/detections";

describe("bounded NASA FIRMS fetch", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.getFirmsConfig.mockReturnValue({
      apiKey: "test-map-key",
      source: "VIIRS_SNPP_NRT",
      bounds: { west: 1, south: 40, east: 3, north: 43 },
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a complete visible error and imports nothing when the stream is too large", async () => {
    const oversizedChunk = new Uint8Array(FIRMS_RESPONSE_LIMITS.maxBytes + 1);
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversizedChunk);
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchNasaFirmsDetections();

    expect(result).toEqual({
      ok: false,
      reason:
        "La respuesta de NASA FIRMS supera el límite seguro de 2 MiB. No se ha importado ninguna señal.",
      detections: [],
      rejected: [],
    });
  });

  it("rejects malformed CSV without returning partial detections", async () => {
    mocks.fetch.mockResolvedValue(
      new Response('latitude,longitude\n"41.2,2.1', { status: 200 }),
    );

    const result = await fetchNasaFirmsDetections();

    expect(result).toMatchObject({
      ok: false,
      reason:
        "NASA FIRMS ha devuelto un CSV no válido. No se ha importado ninguna señal.",
      detections: [],
    });
  });

  it("discards signals outside Spanish territory before a coordinator can import them", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        [
          "latitude,longitude,acq_date,acq_time,satellite,instrument",
          "40.4168,-3.7038,2026-07-14,1200,N,VIIRS",
          "35.2040,0.3330,2026-07-14,1201,N,VIIRS",
        ].join("\n"),
        { status: 200 },
      ),
    );

    const result = await fetchNasaFirmsDetections();

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("La fuente debería ser válida.");
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]).toMatchObject({
      latitude: 40.4168,
      longitude: -3.7038,
    });
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatch(/fuera de España/);
  });
});
