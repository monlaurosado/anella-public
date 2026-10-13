import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transactionIncidentFindMany = vi.fn();
  const transactionIncidentFindFirst = vi.fn();
  const publicIncidentFindFirst = vi.fn();
  const transaction = {
    incident: {
      findMany: transactionIncidentFindMany,
      findFirst: transactionIncidentFindFirst,
    },
  };

  return {
    publicIncidentFindFirst,
    transactionIncidentFindFirst,
    transactionIncidentFindMany,
    runTransaction: vi.fn(
      async (work: (client: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    ),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dal", () => ({
  incidentScopeWhere: vi.fn(),
  requireCoordinator: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.runTransaction,
    incident: { findFirst: mocks.publicIncidentFindFirst },
  },
}));

import { publicIncidentEligibilityWhere } from "@/lib/public-incident-eligibility";
import {
  getIncidentById,
  getPublicIncidentTitle,
  getPublicIncidents,
} from "@/services/incidents";

describe("public incident query eligibility", () => {
  beforeEach(() => {
    mocks.runTransaction.mockClear();
    mocks.transactionIncidentFindMany.mockReset().mockResolvedValue([]);
    mocks.transactionIncidentFindFirst.mockReset().mockResolvedValue(null);
    mocks.publicIncidentFindFirst.mockReset().mockResolvedValue(null);
  });

  it("uses the shared eligibility filter for the public collection", async () => {
    await expect(getPublicIncidents()).resolves.toEqual([]);

    expect(mocks.transactionIncidentFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.transactionIncidentFindMany.mock.calls[0]?.[0].where).toBe(
      publicIncidentEligibilityWhere,
    );
  });

  it.each([
    ["detail", getIncidentById, mocks.transactionIncidentFindFirst],
    ["title", getPublicIncidentTitle, mocks.publicIncidentFindFirst],
  ] as const)(
    "combines only the lookup identity with the shared filter for %s queries",
    async (_label, query, findFirst) => {
      await expect(query("AN-PUBLIC")).resolves.toBeNull();

      expect(findFirst).toHaveBeenCalledTimes(1);
      const { OR, ...eligibility } = findFirst.mock.calls[0]?.[0].where;
      expect(OR).toEqual([{ id: "AN-PUBLIC" }, { publicCode: "AN-PUBLIC" }]);
      expect(eligibility).toEqual(publicIncidentEligibilityWhere);
    },
  );
});
