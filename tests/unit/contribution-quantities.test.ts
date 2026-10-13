import { describe, expect, it } from "vitest";

import {
  calculateCommittedQuantity,
  calculateRemainingQuantity,
} from "@/lib/contribution-quantities";

describe("contribution quantities", () => {
  it("counts only outstanding quantities as committed", () => {
    expect(
      calculateCommittedQuantity([
        { quantity: 10, deliveredQuantity: 0, status: "pledged" },
        { quantity: 8, deliveredQuantity: 0, status: "en_route" },
        {
          quantity: 6,
          deliveredQuantity: 2,
          status: "partially_delivered",
        },
        { quantity: 4, deliveredQuantity: 4, status: "delivered" },
        { quantity: 5, deliveredQuantity: 0, status: "cancelled" },
      ]),
    ).toBe(22);
  });

  it("never returns a negative remaining quantity", () => {
    expect(
      calculateRemainingQuantity({
        quantityNeeded: 20,
        quantityReceived: 15,
        quantityCommitted: 8,
      }),
    ).toBe(0);
  });
});
