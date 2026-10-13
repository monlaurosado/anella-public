-- Preserve the historical Incident -> Need -> Contribution cascade for
-- maintenance and restore drills. Direct contributions now follow the same
-- lifecycle when an incident is explicitly deleted; normal product flows
-- close incidents and never delete them.
ALTER TABLE `Contribution`
  DROP FOREIGN KEY `Contribution_incidentId_fkey`;

ALTER TABLE `Contribution`
  ADD CONSTRAINT `Contribution_incidentId_fkey`
  FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
