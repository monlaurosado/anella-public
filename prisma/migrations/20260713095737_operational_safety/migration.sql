-- AlterTable
ALTER TABLE `AuditLog` ADD COLUMN `municipalityId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Contribution` ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `statusReason` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `ExternalDetection` ADD COLUMN `municipalityId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Incident` ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedReason` VARCHAR(500) NULL,
    ADD COLUMN `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `publicLatitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `publicLocationApprovedAt` DATETIME(3) NULL,
    ADD COLUMN `publicLocationApprovedById` VARCHAR(191) NULL,
    ADD COLUMN `publicLocationLabel` VARCHAR(191) NULL,
    ADD COLUMN `publicLocationMode` ENUM('MUNICIPALITY_ONLY', 'GENERALIZED_AREA', 'SAFE_POINTS_ONLY') NOT NULL DEFAULT 'MUNICIPALITY_ONLY',
    ADD COLUMN `publicLongitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `publicRadiusMeters` INTEGER NULL,
    ADD COLUMN `timeZone` VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid';

-- AlterTable
ALTER TABLE `Need` ADD COLUMN `cancellationReason` VARCHAR(500) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `publishedAt` DATETIME(3) NULL,
    ADD COLUMN `requestedById` VARCHAR(191) NULL,
    ADD COLUMN `requestingOrganizationId` VARCHAR(191) NULL,
    ADD COLUMN `validatedAt` DATETIME(3) NULL,
    ADD COLUMN `validatedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SafePoint` ADD COLUMN `deactivatedAt` DATETIME(3) NULL,
    ADD COLUMN `deactivationReason` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `credentialsChangedAt` DATETIME(3) NULL,
    ADD COLUMN `disabledAt` DATETIME(3) NULL,
    ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 1;

-- Backfill provenance without ever inventing a human validation or copying
-- operational coordinates into public fields. Legacy needs remain private
-- until a coordinator explicitly reviews and publishes them.
UPDATE `Incident`
SET `lastActivityAt` = `updatedAt`;

UPDATE `Need` AS `need`
INNER JOIN `Incident` AS `incident` ON `incident`.`id` = `need`.`incidentId`
SET
  `need`.`requestingOrganizationId` = `incident`.`organizationId`,
  `need`.`requestedById` = `incident`.`createdById`;

UPDATE `ExternalDetection` AS `detection`
INNER JOIN `Incident` AS `incident`
  ON `incident`.`id` = `detection`.`linkedIncidentId`
SET `detection`.`municipalityId` = `incident`.`municipalityId`;

UPDATE `AuditLog` AS `audit`
INNER JOIN `Incident` AS `incident` ON `incident`.`id` = `audit`.`incidentId`
SET `audit`.`municipalityId` = `incident`.`municipalityId`;

UPDATE `AuditLog` AS `audit`
INNER JOIN `User` AS `actor` ON `actor`.`id` = `audit`.`actorId`
SET `audit`.`municipalityId` = `actor`.`municipalityId`
WHERE `audit`.`municipalityId` IS NULL;

-- Database-level guards complement the transactional application checks.
ALTER TABLE `Incident`
  ADD CONSTRAINT `Incident_operationalLatitude_check`
    CHECK (`latitude` BETWEEN -90 AND 90),
  ADD CONSTRAINT `Incident_operationalLongitude_check`
    CHECK (`longitude` BETWEEN -180 AND 180),
  ADD CONSTRAINT `Incident_radiusMeters_check`
    CHECK (`radiusMeters` BETWEEN 100 AND 100000),
  ADD CONSTRAINT `Incident_publicCoordinates_pair_check`
    CHECK ((`publicLatitude` IS NULL) = (`publicLongitude` IS NULL)),
  ADD CONSTRAINT `Incident_publicLatitude_check`
    CHECK (`publicLatitude` IS NULL OR `publicLatitude` BETWEEN -90 AND 90),
  ADD CONSTRAINT `Incident_publicLongitude_check`
    CHECK (`publicLongitude` IS NULL OR `publicLongitude` BETWEEN -180 AND 180),
  ADD CONSTRAINT `Incident_publicRadiusMeters_check`
    CHECK (`publicRadiusMeters` IS NULL OR `publicRadiusMeters` BETWEEN 1000 AND 100000);

ALTER TABLE `SafePoint`
  ADD CONSTRAINT `SafePoint_latitude_check`
    CHECK (`latitude` BETWEEN -90 AND 90),
  ADD CONSTRAINT `SafePoint_longitude_check`
    CHECK (`longitude` BETWEEN -180 AND 180);

ALTER TABLE `Need`
  ADD CONSTRAINT `Need_quantities_check`
    CHECK (`quantityNeeded` > 0 AND `quantityReceived` >= 0 AND `quantityReceived` <= `quantityNeeded`);

ALTER TABLE `Contribution`
  ADD CONSTRAINT `Contribution_quantities_check`
    CHECK (`quantity` > 0 AND `deliveredQuantity` >= 0 AND `deliveredQuantity` <= `quantity`);

-- CreateIndex
CREATE INDEX `AuditLog_incidentId_createdAt_idx` ON `AuditLog`(`incidentId`, `createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_municipalityId_createdAt_idx` ON `AuditLog`(`municipalityId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Contribution_status_updatedAt_idx` ON `Contribution`(`status`, `updatedAt`);

-- CreateIndex
CREATE INDEX `Contribution_needId_status_eta_idx` ON `Contribution`(`needId`, `status`, `eta`);

-- CreateIndex
CREATE INDEX `ExternalDetection_municipalityId_status_detectedAt_idx` ON `ExternalDetection`(`municipalityId`, `status`, `detectedAt`);

-- CreateIndex
CREATE INDEX `Incident_municipalityId_status_priority_lastActivityAt_idx` ON `Incident`(`municipalityId`, `status`, `priority`, `lastActivityAt`);

-- CreateIndex
CREATE INDEX `Incident_municipalityId_lastActivityAt_idx` ON `Incident`(`municipalityId`, `lastActivityAt`);

-- CreateIndex
CREATE INDEX `Need_incidentId_updatedAt_idx` ON `Need`(`incidentId`, `updatedAt`);

-- CreateIndex
CREATE INDEX `Need_status_deadline_idx` ON `Need`(`status`, `deadline`);

-- CreateIndex
CREATE INDEX `Need_requestingOrganizationId_idx` ON `Need`(`requestingOrganizationId`);

-- CreateIndex
CREATE INDEX `Need_requestedById_idx` ON `Need`(`requestedById`);

-- CreateIndex
CREATE INDEX `Need_validatedById_idx` ON `Need`(`validatedById`);

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_publicLocationApprovedById_fkey` FOREIGN KEY (`publicLocationApprovedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Need` ADD CONSTRAINT `Need_requestingOrganizationId_fkey` FOREIGN KEY (`requestingOrganizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Need` ADD CONSTRAINT `Need_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Need` ADD CONSTRAINT `Need_validatedById_fkey` FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalDetection` ADD CONSTRAINT `ExternalDetection_municipalityId_fkey` FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
