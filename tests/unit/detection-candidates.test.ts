import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DetectionSource } from "@/generated/prisma/enums";
import {
  distanceMeters,
  groupCandidateDetections,
  type CandidateDetection,
} from "@/services/detection-candidates";

const baseTime = new Date("2026-07-16T10:00:00.000Z");

function detection(
  id: string,
  overrides: Partial<CandidateDetection> = {},
): CandidateDetection {
  return {
    id,
    source: DetectionSource.NASA_FIRMS,
    provider: "NASA VIIRS",
    providerStatus: null,
    latitude: 40.4168,
    longitude: -3.7038,
    detectedAt: baseTime,
    municipalityId: "madrid",
    ...overrides,
  };
}

describe("detection candidate spatial and temporal policy", () => {
  it("groups nearby signals deterministically and requires the thermal threshold", () => {
    const clusters = groupCandidateDetections(
      [
        detection("c", { latitude: 40.4172 }),
        detection("a"),
        detection("b", { longitude: -3.7042 }),
      ],
      {
        radiusMeters: 1_000,
        windowMinutes: 120,
        minimumThermalSignals: 3,
      },
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].detections.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(clusters[0]).toMatchObject({
      thermalSignalCount: 3,
      hasOfficialOpenSignal: false,
      qualifiesAsCandidate: true,
    });
  });

  it("does not turn one unconfirmed thermal signal into an emergency candidate", () => {
    const [cluster] = groupCandidateDetections([detection("single")], {
      radiusMeters: 1_000,
      windowMinutes: 120,
      minimumThermalSignals: 3,
    });

    expect(cluster.qualifiesAsCandidate).toBe(false);
    expect(cluster.hasOfficialOpenSignal).toBe(false);
  });

  it("accepts an official open notice as a candidate but keeps confirmation human", () => {
    const [cluster] = groupCandidateDetections(
      [
        detection("official", {
          source: DetectionSource.CIVIL_PROTECTION,
          provider: "Fuente oficial TEST",
          providerStatus: "ACTIVE",
        }),
      ],
      {
        radiusMeters: 1_000,
        windowMinutes: 120,
        minimumThermalSignals: 3,
      },
    );

    expect(cluster).toMatchObject({
      hasOfficialOpenSignal: true,
      qualifiesAsCandidate: true,
      thermalSignalCount: 0,
    });
  });

  it("separates signals outside the complete time window or spatial radius", () => {
    const clusters = groupCandidateDetections(
      [
        detection("first"),
        detection("late", {
          detectedAt: new Date(baseTime.getTime() + 121 * 60_000),
        }),
        detection("far", { latitude: 41.3874, longitude: 2.1686 }),
      ],
      {
        radiusMeters: 1_000,
        windowMinutes: 120,
        minimumThermalSignals: 3,
      },
    );

    expect(clusters).toHaveLength(3);
    expect(
      distanceMeters(
        detection("madrid"),
        detection("barcelona", {
          latitude: 41.3874,
          longitude: 2.1686,
        }),
      ),
    ).toBeGreaterThan(500_000);
  });
});
