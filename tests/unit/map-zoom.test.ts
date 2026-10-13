import { describe, expect, it } from "vitest";

import {
  boundedTrackpadZoomChange,
  trackpadScaleZoomChange,
  trackpadWheelZoomStep,
} from "@/lib/map-zoom";

describe("trackpad map zoom", () => {
  it("limits every wheel event and the complete gesture", () => {
    expect(trackpadWheelZoomStep(-100)).toBe(0.3);
    expect(trackpadWheelZoomStep(100)).toBe(-0.3);
    expect(boundedTrackpadZoomChange(8)).toBe(1.5);
    expect(boundedTrackpadZoomChange(-8)).toBe(-1.5);
  });

  it("applies a gentler scale to Safari gesture events", () => {
    expect(trackpadScaleZoomChange(2)).toBe(0.8);
    expect(trackpadScaleZoomChange(0.5)).toBe(-0.8);
    expect(trackpadScaleZoomChange(Number.NaN)).toBe(0);
  });
});
