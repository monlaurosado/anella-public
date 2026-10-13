const MAX_TRACKPAD_GESTURE_ZOOM = 1.5;
const MAX_TRACKPAD_WHEEL_STEP = 0.3;

export function boundedTrackpadZoomChange(value: number) {
  return Math.max(
    -MAX_TRACKPAD_GESTURE_ZOOM,
    Math.min(MAX_TRACKPAD_GESTURE_ZOOM, value),
  );
}

export function trackpadWheelZoomStep(normalizedDelta: number) {
  return Math.max(
    -MAX_TRACKPAD_WHEEL_STEP,
    Math.min(MAX_TRACKPAD_WHEEL_STEP, -normalizedDelta * 0.018),
  );
}

export function trackpadScaleZoomChange(scale: number) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return boundedTrackpadZoomChange(Math.log2(safeScale) * 0.8);
}
