"use client";

import { useEffect } from "react";

export function FocusHashTarget() {
  useEffect(() => {
    const fragment = window.location.hash;
    const rawId = fragment.slice(1);
    if (!rawId) return;

    let id: string;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      return;
    }
    const target = document.getElementById(id);
    if (!target) return;

    // A fragment returned by a Server Component redirect updates the App Router
    // URL, but Chromium does not always recompute :target. Replaying only the
    // fragment restores native fragment semantics without adding history.
    if (!target.matches(":target")) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.replace(fragment);
    }

    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return null;
}
