export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutomaticFireIngestionScheduler } =
      await import("@/services/fire-ingestion-scheduler");
    startAutomaticFireIngestionScheduler();
  }
}
