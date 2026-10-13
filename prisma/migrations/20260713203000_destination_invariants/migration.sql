-- Every public need must belong to the same incident as its safe destination.
-- Add the stronger relationship before removing the old single-column one.
-- If legacy rows cross incidents, this fails while the previous FK remains in
-- force so a partially applied migration never weakens existing protection.
CREATE UNIQUE INDEX `SafePoint_id_incidentId_key`
  ON `SafePoint`(`id`, `incidentId`);

ALTER TABLE `Need`
  ADD CONSTRAINT `Need_safePointId_incidentId_fkey`
  FOREIGN KEY (`safePointId`, `incidentId`)
  REFERENCES `SafePoint`(`id`, `incidentId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX `Need_id_safePointId_key`
  ON `Need`(`id`, `safePointId`);

-- A legacy contribution without an explicit destination has exactly one safe
-- recovery value: the destination already assigned to its need. Record that
-- repair before making the column mandatory.
INSERT INTO `AuditLog` (
  `id`,
  `incidentId`,
  `municipalityId`,
  `action`,
  `entityType`,
  `entityId`,
  `metadata`
)
SELECT
  CONCAT('mig_', REPLACE(UUID(), '-', '')),
  need.`incidentId`,
  incident.`municipalityId`,
  'migration.contribution_destination_backfilled',
  'Contribution',
  contribution.`id`,
  JSON_OBJECT(
    'migration', '20260713203000_destination_invariants',
    'safePointId', need.`safePointId`
  )
FROM `Contribution` AS contribution
INNER JOIN `Need` AS need ON need.`id` = contribution.`needId`
INNER JOIN `Incident` AS incident ON incident.`id` = need.`incidentId`
WHERE contribution.`safePointId` IS NULL;

UPDATE `Contribution` AS contribution
INNER JOIN `Need` AS need ON need.`id` = contribution.`needId`
SET contribution.`safePointId` = need.`safePointId`
WHERE contribution.`safePointId` IS NULL;

-- Keep the two legacy FKs until the composite destination relationship has
-- itself been accepted by MySQL. A mismatch therefore fails closed. The
-- nullable column is valid here because the audited backfill has already
-- populated every existing row.
ALTER TABLE `Contribution`
  ADD CONSTRAINT `Contribution_needId_safePointId_fkey`
  FOREIGN KEY (`needId`, `safePointId`)
  REFERENCES `Need`(`id`, `safePointId`)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The composite path Contribution -> Need -> SafePoint is now active, so both
-- legacy single-column contribution FKs are redundant. The old direct FK used
-- ON DELETE SET NULL and must be removed before the column can become required.
ALTER TABLE `Contribution`
  DROP FOREIGN KEY `Contribution_needId_fkey`,
  DROP FOREIGN KEY `Contribution_safePointId_fkey`;

ALTER TABLE `Contribution`
  MODIFY `safePointId` VARCHAR(191) NOT NULL;

ALTER TABLE `Contribution`
  ADD CONSTRAINT `Contribution_safePointId_fkey`
  FOREIGN KEY (`safePointId`)
  REFERENCES `SafePoint`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The stronger relationships are active. Remove the final redundant legacy
-- link only after every replacement has been accepted by MySQL.
ALTER TABLE `Need`
  DROP FOREIGN KEY `Need_safePointId_fkey`;
