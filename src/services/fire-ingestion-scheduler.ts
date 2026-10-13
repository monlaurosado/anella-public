import "server-only";

import { getAutomaticFireIngestionConfig } from "@/config/env";

const INITIAL_SYNC_DELAY_MS = 30_000;

const globalScheduler = globalThis as typeof globalThis & {
  anellaFireIngestionScheduler?: {
    initial: NodeJS.Timeout;
    interval: NodeJS.Timeout;
  };
};

let executionInProgress = false;

async function runScheduledSync() {
  if (executionInProgress) return;
  executionInProgress = true;
  try {
    // External adapters include parsers with native dependencies. Loading them
    // only when a scheduled run starts keeps an upstream/parser failure from
    // preventing the Next.js server from becoming ready.
    const { syncAutomaticFireDetections } =
      await import("@/services/fire-ingestion");
    const result = await syncAutomaticFireDetections();
    if (result.ok) {
      console.info("Automatic fire ingestion completed", {
        imported: result.imported,
        updated: result.updated,
        statusChanged: result.statusChanged,
        received: result.received,
        rejected: result.rejected,
        assigned: result.assigned,
        unassigned: result.unassigned,
        degraded: result.degraded,
      });
    } else if (result.status !== "busy") {
      console.error("Automatic fire ingestion did not complete", {
        status: result.status,
        sources: result.sources.map((source) => ({
          sourceKey: source.sourceKey,
          ok: source.ok,
        })),
      });
    }
  } catch (error) {
    console.error("Scheduled automatic fire ingestion failed", error);
  } finally {
    executionInProgress = false;
  }
}

export function startAutomaticFireIngestionScheduler() {
  const config = getAutomaticFireIngestionConfig();
  if (!config.enabled || globalScheduler.anellaFireIngestionScheduler) {
    return false;
  }

  const initial = setTimeout(
    () => void runScheduledSync(),
    INITIAL_SYNC_DELAY_MS,
  );
  const interval = setInterval(
    () => void runScheduledSync(),
    config.intervalMinutes * 60 * 1_000,
  );
  initial.unref();
  interval.unref();
  globalScheduler.anellaFireIngestionScheduler = { initial, interval };
  return true;
}
