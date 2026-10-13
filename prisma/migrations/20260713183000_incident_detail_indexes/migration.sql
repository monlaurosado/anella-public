-- Additive index aligned with the stable mixed-direction order used by the
-- paginated coordination incident detail. Existing indexes remain untouched.
CREATE INDEX `Need_incident_priority_created_id_idx`
  ON `Need`(`incidentId`, `priority` DESC, `createdAt`, `id`);
