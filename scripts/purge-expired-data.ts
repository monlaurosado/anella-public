import { prisma } from "../src/lib/db";
import { runOperationalMaintenance } from "../src/lib/privacy-retention";

runOperationalMaintenance()
  .then(async (result) => {
    console.log(
      result.skippedBecauseLocked
        ? "Maintenance skipped: another process holds the database lock."
        : `Maintenance complete: ${result.expiredNeeds} needs expired, ${result.deferredNeeds} expirations deferred for pending deliveries, ${result.anonymizedContributions} contributions anonymized, ${result.anonymizedOrganizationClaims} organization claims anonymized, ${result.redactedNotificationOutbox} notification payloads redacted, ${result.redactedAuditEntries} audit metadata entries redacted, ${result.removedThrottleEntries} throttle entries removed.`,
    );
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Retention maintenance failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
