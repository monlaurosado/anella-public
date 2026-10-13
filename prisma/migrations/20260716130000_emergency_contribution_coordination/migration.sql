-- Contribution-first emergency coordination. This migration is deliberately
-- additive: legacy needs, QR destinations and public codes remain addressable.

-- Extend organization and incident provenance without granting any new role.
ALTER TABLE `Organization`
  MODIFY `kind` ENUM(
    'MUNICIPALITY',
    'CIVIL_PROTECTION',
    'FIRE_DEPARTMENT',
    'FORESTRY_DEFENSE',
    'AUTONOMIC_ADMINISTRATION',
    'NGO',
    'OTHER'
  ) NOT NULL DEFAULT 'OTHER',
  ADD COLUMN `verificationStatus` ENUM(
    'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'
  ) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN `verifiedAt` DATETIME(3) NULL,
  ADD COLUMN `verifiedById` VARCHAR(191) NULL,
  ADD COLUMN `notificationEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `notificationRadiusMeters` INTEGER NOT NULL DEFAULT 25000,
  ADD COLUMN `notificationCooldownMinutes` INTEGER NOT NULL DEFAULT 60;

ALTER TABLE `Incident`
  ADD COLUMN `origin` ENUM(
    'MANUAL', 'DETECTION_CANDIDATE', 'OFFICIAL_NOTICE'
  ) NOT NULL DEFAULT 'MANUAL';

-- Existing organizations already scoped active coordinator accounts. Preserve
-- that access while making the provenance explicit and auditable.
UPDATE `Organization`
SET
  `verificationStatus` = 'VERIFIED',
  `verifiedAt` = `createdAt`;

INSERT INTO `AuditLog` (
  `id`, `action`, `entityType`, `entityId`, `metadata`
)
VALUES (
  CONCAT('mig_', REPLACE(UUID(), '-', '')),
  'migration.organization_verification_backfilled',
  'Migration',
  '20260716130000_emergency_contribution_coordination',
  JSON_OBJECT('strategy', 'preserve_existing_coordinator_scope')
);

-- Keep the SafePoint table and QR contract for compatibility, while adding
-- explicit delivery/logistics semantics used by all new code.
ALTER TABLE `SafePoint`
  ADD COLUMN `organizationId` VARCHAR(191) NULL,
  ADD COLUMN `pointType` ENUM(
    'DROP_OFF', 'LOGISTICS', 'COLLECTION'
  ) NOT NULL DEFAULT 'DROP_OFF',
  ADD COLUMN `pointStatus` ENUM(
    'DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'
  ) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `publishedAt` DATETIME(3) NULL,
  ADD COLUMN `closedAt` DATETIME(3) NULL;

UPDATE `SafePoint` AS `point`
INNER JOIN `Incident` AS `incident` ON `incident`.`id` = `point`.`incidentId`
SET
  `point`.`organizationId` = `incident`.`organizationId`,
  `point`.`pointStatus` = CASE
    WHEN `point`.`isActive` = false THEN 'CLOSED'
    WHEN `point`.`validatedAt` IS NOT NULL THEN 'ACTIVE'
    ELSE 'DRAFT'
  END,
  `point`.`publishedAt` = CASE
    WHEN `point`.`isActive` = true AND `point`.`validatedAt` IS NOT NULL
      THEN `point`.`validatedAt`
    ELSE NULL
  END,
  `point`.`closedAt` = CASE
    WHEN `point`.`isActive` = false
      THEN COALESCE(`point`.`deactivatedAt`, `point`.`updatedAt`)
    ELSE NULL
  END;

CREATE INDEX `Organization_verificationStatus_municipalityId_idx`
  ON `Organization`(`verificationStatus`, `municipalityId`);
CREATE INDEX `Organization_verifiedById_idx`
  ON `Organization`(`verifiedById`);
CREATE INDEX `SafePoint_organizationId_idx`
  ON `SafePoint`(`organizationId`);
CREATE INDEX `SafePoint_dropoff_public_idx`
  ON `SafePoint`(`incidentId`, `pointStatus`, `publishedAt`);

ALTER TABLE `Organization`
  ADD CONSTRAINT `Organization_verifiedById_fkey`
  FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SafePoint`
  ADD CONSTRAINT `SafePoint_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Add the direct emergency relationship while the legacy need relationship is
-- still mandatory, then backfill and verify it before relaxing needId.
ALTER TABLE `Contribution`
  ADD COLUMN `incidentId` VARCHAR(191) NULL,
  ADD COLUMN `category` ENUM(
    'WATER', 'FOOD', 'HYGIENE', 'MEDICAL_SUPPLIES', 'TOOLS',
    'PROTECTIVE_EQUIPMENT', 'TRANSPORT', 'ACCOMMODATION',
    'ANIMAL_SUPPORT', 'OTHER'
  ) NOT NULL DEFAULT 'OTHER',
  ADD COLUMN `origin` ENUM(
    'PUBLIC_ANONYMOUS', 'COORDINATION', 'LEGACY_NEED'
  ) NOT NULL DEFAULT 'PUBLIC_ANONYMOUS',
  ADD COLUMN `description` VARCHAR(500) NULL,
  ADD COLUMN `unit` VARCHAR(32) NULL,
  ADD COLUMN `personalDataConsentAt` DATETIME(3) NULL,
  ADD COLUMN `followUpConsentAt` DATETIME(3) NULL,
  ADD COLUMN `piiExpiresAt` DATETIME(3) NULL;

UPDATE `Contribution` AS `contribution`
INNER JOIN `Need` AS `need` ON `need`.`id` = `contribution`.`needId`
SET
  `contribution`.`incidentId` = `need`.`incidentId`,
  `contribution`.`category` = CASE `need`.`type`
    WHEN 'WATER' THEN 'WATER'
    WHEN 'FOOD' THEN 'FOOD'
    WHEN 'MEDICAL_SUPPLIES' THEN 'MEDICAL_SUPPLIES'
    WHEN 'TOOLS' THEN 'TOOLS'
    WHEN 'TRANSPORT' THEN 'TRANSPORT'
    WHEN 'SHELTER' THEN 'ACCOMMODATION'
    ELSE 'OTHER'
  END,
  `contribution`.`origin` = 'LEGACY_NEED',
  `contribution`.`unit` = `need`.`unit`,
  `contribution`.`personalDataConsentAt` = `contribution`.`consentAt`,
  `contribution`.`piiExpiresAt` = DATE_ADD(
    `contribution`.`createdAt`, INTERVAL 90 DAY
  );

-- Fail closed if a historical row could not be associated with its emergency.
SET @unlinked_contribution_count = (
  SELECT COUNT(*) FROM `Contribution` WHERE `incidentId` IS NULL
);
SET @assert_contributions_linked = IF(
  @unlinked_contribution_count = 0,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Contribution backfill left rows without incidentId'''
);
PREPARE assert_contributions_linked FROM @assert_contributions_linked;
EXECUTE assert_contributions_linked;
DEALLOCATE PREPARE assert_contributions_linked;

ALTER TABLE `Contribution`
  DROP FOREIGN KEY `Contribution_needId_safePointId_fkey`,
  DROP FOREIGN KEY `Contribution_safePointId_fkey`;

ALTER TABLE `Contribution`
  MODIFY `incidentId` VARCHAR(191) NOT NULL,
  MODIFY `needId` VARCHAR(191) NULL;

CREATE INDEX `Contribution_incident_status_updated_idx`
  ON `Contribution`(`incidentId`, `status`, `updatedAt`);
CREATE INDEX `Contribution_dropoff_category_status_eta_idx`
  ON `Contribution`(`safePointId`, `category`, `status`, `eta`);
CREATE INDEX `Contribution_pii_expiry_idx`
  ON `Contribution`(`piiExpiresAt`);

ALTER TABLE `Contribution`
  ADD CONSTRAINT `Contribution_incidentId_fkey`
  FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Contribution_safePointId_incidentId_fkey`
  FOREIGN KEY (`safePointId`, `incidentId`)
  REFERENCES `SafePoint`(`id`, `incidentId`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Contribution_needId_safePointId_fkey`
  FOREIGN KEY (`needId`, `safePointId`)
  REFERENCES `Need`(`id`, `safePointId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Organization`
  ADD CONSTRAINT `Organization_notificationRadiusMeters_check`
    CHECK (`notificationRadiusMeters` BETWEEN 1000 AND 200000),
  ADD CONSTRAINT `Organization_notificationCooldownMinutes_check`
    CHECK (`notificationCooldownMinutes` BETWEEN 5 AND 10080);

-- An incident may affect several municipalities while municipalityId remains
-- the compatible primary tenant field.
CREATE TABLE `IncidentMunicipality` (
  `incidentId` VARCHAR(191) NOT NULL,
  `municipalityId` VARCHAR(191) NOT NULL,
  `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `IncidentMunicipality_municipalityId_incidentId_idx` (`municipalityId`, `incidentId`),
  PRIMARY KEY (`incidentId`, `municipalityId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `IncidentMunicipality` (
  `incidentId`, `municipalityId`, `isPrimary`
)
SELECT `id`, `municipalityId`, true
FROM `Incident`
WHERE `municipalityId` IS NOT NULL;

ALTER TABLE `IncidentMunicipality`
  ADD CONSTRAINT `IncidentMunicipality_incidentId_fkey`
  FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `IncidentMunicipality_municipalityId_fkey`
  FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `IncidentNotice` (
  `id` VARCHAR(191) NOT NULL,
  `incidentId` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
  `publishedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `IncidentNotice_incidentId_status_publishedAt_idx` (`incidentId`, `status`, `publishedAt`),
  INDEX `IncidentNotice_organizationId_createdAt_idx` (`organizationId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IncidentNotice`
  ADD CONSTRAINT `IncidentNotice_incidentId_fkey`
  FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `IncidentNotice_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `IncidentNotice_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `OrganizationDomain` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `domain` VARCHAR(191) NOT NULL,
  `isVerified` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `OrganizationDomain_domain_key` (`domain`),
  INDEX `OrganizationDomain_organizationId_isVerified_idx` (`organizationId`, `isVerified`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrganizationDomain`
  ADD CONSTRAINT `OrganizationDomain_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `OrganizationClaim` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `municipalityId` VARCHAR(191) NULL,
  `claimantName` VARCHAR(191) NOT NULL,
  `claimantEmail` VARCHAR(191) NOT NULL,
  `emailDomain` VARCHAR(191) NOT NULL,
  `verificationTokenHash` CHAR(64) NULL,
  `status` ENUM(
    'EMAIL_PENDING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED'
  ) NOT NULL DEFAULT 'EMAIL_PENDING',
  `emailVerifiedAt` DATETIME(3) NULL,
  `reviewedById` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewReason` VARCHAR(500) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `piiExpiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `OrganizationClaim_verificationTokenHash_key` (`verificationTokenHash`),
  INDEX `OrganizationClaim_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `OrganizationClaim_organizationId_claimantEmail_status_idx` (`organizationId`, `claimantEmail`, `status`),
  INDEX `OrganizationClaim_municipalityId_status_idx` (`municipalityId`, `status`),
  INDEX `OrganizationClaim_piiExpiresAt_idx` (`piiExpiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrganizationClaim`
  ADD CONSTRAINT `OrganizationClaim_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `OrganizationClaim_municipalityId_fkey`
  FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `OrganizationClaim_reviewedById_fkey`
  FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `NotificationOutbox` (
  `id` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `kind` ENUM(
    'DETECTION_DIGEST', 'INCIDENT_CANDIDATE',
    'ORGANIZATION_CLAIM_VERIFICATION', 'ORGANIZATION_CLAIM_DECISION'
  ) NOT NULL,
  `status` ENUM(
    'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DISCARDED'
  ) NOT NULL DEFAULT 'PENDING',
  `incidentId` VARCHAR(191) NULL,
  `municipalityId` VARCHAR(191) NULL,
  `organizationId` VARCHAR(191) NULL,
  `organizationClaimId` VARCHAR(191) NULL,
  `templateKey` VARCHAR(100) NOT NULL,
  `payload` JSON NOT NULL,
  `notBefore` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `maxAttempts` INTEGER NOT NULL DEFAULT 5,
  `lockedAt` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `discardedAt` DATETIME(3) NULL,
  `lastError` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `NotificationOutbox_idempotencyKey_key` (`idempotencyKey`),
  INDEX `NotificationOutbox_status_notBefore_createdAt_idx` (`status`, `notBefore`, `createdAt`),
  INDEX `NotificationOutbox_organizationId_kind_createdAt_idx` (`organizationId`, `kind`, `createdAt`),
  INDEX `NotificationOutbox_municipalityId_kind_createdAt_idx` (`municipalityId`, `kind`, `createdAt`),
  INDEX `NotificationOutbox_incidentId_kind_createdAt_idx` (`incidentId`, `kind`, `createdAt`),
  CONSTRAINT `NotificationOutbox_attempts_check`
    CHECK (`attempts` >= 0 AND `maxAttempts` BETWEEN 1 AND 20 AND `attempts` <= `maxAttempts`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NotificationOutbox`
  ADD CONSTRAINT `NotificationOutbox_incidentId_fkey`
  FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `NotificationOutbox_municipalityId_fkey`
  FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `NotificationOutbox_organizationId_fkey`
  FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `NotificationOutbox_organizationClaimId_fkey`
  FOREIGN KEY (`organizationClaimId`) REFERENCES `OrganizationClaim`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
