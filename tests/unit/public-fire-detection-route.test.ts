import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getPublicMap: vi.fn(),
}));

vi.mock("@/services/fire-detection-map", () => ({
  getPublicFireDetectionMap: mocks.getPublicMap,
}));

describe("public fire detection route", () => {
  beforeEach(() => {
    mocks.getPublicMap.mockReset().mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "fire-1",
          geometry: { type: "Point", coordinates: [-3.7, 40.4] },
          properties: {
            source: "NASA_FIRMS",
            provider: "VIIRS_NOAA21_NRT",
            detectedAt: "2026-07-14T18:00:00.000Z",
            footprintRadiusMeters: 188,
            municipalityName: "Madrid",
          },
        },
      ],
      sourceHealth: [],
      overallStatus: "healthy",
      generatedAt: "2026-07-14T18:01:00.000Z",
      refreshAfterSeconds: 60,
    });
  });

  it("serves the nationwide layer anonymously without internal fields", async () => {
    const { GET } = await import("@/app/api/fire-detections/route");
    const response = await GET(
      new NextRequest("http://localhost/api/fire-detections"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getPublicMap).toHaveBeenCalledWith({
      municipalityId: undefined,
    });
    const payload = await response.json();
    expect(payload.features).toHaveLength(1);
    expect(payload.features[0].properties).not.toHaveProperty("status");
    expect(JSON.stringify(payload)).not.toMatch(
      /rawJson|linkedIncidentId|sourceUrl|actorId/,
    );
  });

  it("accepts an optional public municipality filter", async () => {
    const { GET } = await import("@/app/api/fire-detections/route");
    await GET(
      new NextRequest(
        "http://localhost/api/fire-detections?municipalityId=es-28079",
      ),
    );

    expect(mocks.getPublicMap).toHaveBeenCalledWith({
      municipalityId: "es-28079",
    });
  });
});
