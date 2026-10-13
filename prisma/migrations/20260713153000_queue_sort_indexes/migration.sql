-- Additive indexes aligned with the sortable, tenant-scoped incident queue.
-- Existing indexes remain in place so deployment never needs a destructive
-- index swap while coordinators are using the queue.
CREATE INDEX `Incident_tenant_status_activity_idx`
  ON `Incident`(`municipalityId`, `status`, `lastActivityAt`, `createdAt`);

CREATE INDEX `Incident_tenant_activity_idx`
  ON `Incident`(`municipalityId`, `lastActivityAt`, `createdAt`);

CREATE INDEX `Incident_tenant_created_idx`
  ON `Incident`(`municipalityId`, `createdAt`);

CREATE INDEX `Incident_tenant_priority_idx`
  ON `Incident`(`municipalityId`, `priority`, `lastActivityAt`);
