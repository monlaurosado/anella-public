-- Additive indexes for the global contribution queue. The existing indexes
-- remain in place to keep this migration deploy-safe under live reads.
CREATE INDEX `Contribution_queue_status_updated_created_idx`
  ON `Contribution`(`status`, `updatedAt`, `createdAt`);

CREATE INDEX `Contribution_queue_updated_created_idx`
  ON `Contribution`(`updatedAt`, `createdAt`);
