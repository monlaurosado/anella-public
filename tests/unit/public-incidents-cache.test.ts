import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicSnapshot: vi.fn(),
  unstableCache: vi.fn((loader: () => Promise<unknown>) => loader),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: mocks.unstableCache }));
vi.mock("@/services/incidents", () => ({
  getPublicSnapshot: mocks.getPublicSnapshot,
}));

import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";
import { getCachedPublicSnapshot } from "@/lib/public-incidents-cache";

describe("public incidents cache contract", () => {
  beforeEach(() => {
    mocks.getPublicSnapshot.mockReset();
  });

  it("uses the shared invalidation tag and the 15-second freshness window", async () => {
    const snapshot = {
      incidents: [],
      stats: {
        activeIncidents: 0,
        enabledDropOffPoints: 0,
        openNeeds: 0,
        coveredNeeds: 0,
        pledgedContributions: 0,
      },
    };
    mocks.getPublicSnapshot.mockResolvedValue(snapshot);

    await expect(getCachedPublicSnapshot()).resolves.toEqual(snapshot);
    expect(mocks.unstableCache).toHaveBeenCalledTimes(1);
    expect(mocks.unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      [PUBLIC_INCIDENTS_CACHE_TAG],
      {
        revalidate: 15,
        tags: [PUBLIC_INCIDENTS_CACHE_TAG],
      },
    );
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
  });

  it("removes deadline-expired needs and recomputes stats after a cached read", async () => {
    mocks.getPublicSnapshot.mockResolvedValue({
      incidents: [
        {
          id: "incident-1",
          status: "active",
          safePoints: [],
          needs: [
            {
              id: "expired-need",
              deadline: "2026-07-14T09:59:59.000Z",
              operationalStatus: "open",
              quantityCommitted: 7,
            },
            {
              id: "open-need",
              deadline: "2026-07-14T10:00:01.000Z",
              operationalStatus: "committed",
              quantityCommitted: 3,
            },
            {
              id: "covered-need",
              deadline: "2026-07-14T10:00:01.000Z",
              operationalStatus: "covered",
              quantityCommitted: 0,
            },
          ],
        },
      ],
      stats: {
        activeIncidents: 1,
        enabledDropOffPoints: 0,
        openNeeds: 2,
        coveredNeeds: 1,
        pledgedContributions: 10,
      },
    });

    const snapshot = await getCachedPublicSnapshot(
      new Date("2026-07-14T10:00:00.000Z"),
    );

    expect(snapshot.incidents[0]?.needs.map((need) => need.id)).toEqual([
      "open-need",
      "covered-need",
    ]);
    expect(snapshot.stats).toEqual({
      activeIncidents: 1,
      enabledDropOffPoints: 0,
      openNeeds: 1,
      coveredNeeds: 1,
      pledgedContributions: 3,
    });
    expect(mocks.getPublicSnapshot).toHaveBeenCalledTimes(1);
  });
});
