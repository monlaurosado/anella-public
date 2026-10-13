-- Read-path indexes for the anonymous projection and operational queues.
CREATE INDEX `Incident_public_queue_idx`
  ON `Incident`(`status`, `verifiedAt`, `publicLocationApprovedAt`, `priority`, `lastActivityAt`);

CREATE INDEX `SafePoint_incident_active_idx`
  ON `SafePoint`(`incidentId`, `isActive`);

CREATE INDEX `Need_incident_status_deadline_idx`
  ON `Need`(`incidentId`, `status`, `deadline`);
