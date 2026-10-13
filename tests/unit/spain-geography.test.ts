import { describe, expect, it } from "vitest";

import { isInSpainTerritory } from "@/lib/spain-geography";

describe("Spanish territory filter", () => {
  it.each([
    ["Madrid", 40.4168, -3.7038],
    ["Mallorca", 39.6953, 3.0176],
    ["Tenerife", 28.2916, -16.6291],
    ["Ceuta", 35.8894, -5.3213],
    ["Melilla", 35.2923, -2.9381],
  ])("keeps %s", (_place, latitude, longitude) => {
    expect(isInSpainTerritory({ latitude, longitude })).toBe(true);
  });

  it.each([
    ["Portugal", 41.1579, -8.6291],
    ["France", 43.2965, 5.3698],
    ["Morocco", 35.7595, -5.834],
    ["Algeria", 35.204, 0.333],
  ])("removes %s", (_place, latitude, longitude) => {
    expect(isInSpainTerritory({ latitude, longitude })).toBe(false);
  });
});
