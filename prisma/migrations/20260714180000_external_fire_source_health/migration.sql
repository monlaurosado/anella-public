-- Keep the provider-specific lifecycle separate from Anella's human review
-- status. External sources may update these fields but can never publish an
-- incident or change PENDING/LINKED/DISMISSED automatically.
ALTER TABLE `ExternalDetection`
  ADD COLUMN `provider` VARCHAR(64) NULL,
  ADD COLUMN `providerStatus` VARCHAR(32) NULL,
  ADD COLUMN `providerStatusChangedAt` DATETIME(3) NULL,
  ADD COLUMN `lastSeenAt` DATETIME(3) NULL;

UPDATE `ExternalDetection`
SET `provider` = CAST(`source` AS CHAR),
    `lastSeenAt` = `updatedAt`
WHERE `provider` IS NULL;

CREATE INDEX `ExternalDetection_provider_status_seen_idx`
  ON `ExternalDetection`(`provider`, `providerStatus`, `lastSeenAt`);

-- One aggregate row per upstream feed provides observable freshness without
-- persisting response bodies, credentials or tactical resource information.
CREATE TABLE `ExternalSourceSync` (
  `sourceKey` VARCHAR(64) NOT NULL,
  `source` ENUM('NASA_FIRMS', 'EFFIS', 'INCENDISCAT', 'AEMET', 'METEOCAT', 'EMERGENCY_112', 'CIVIL_PROTECTION', 'MANUAL', 'OTHER') NOT NULL,
  `label` VARCHAR(100) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  `lastAttemptAt` DATETIME(3) NOT NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `lastFailureAt` DATETIME(3) NULL,
  `received` INTEGER NOT NULL DEFAULT 0,
  `rejected` INTEGER NOT NULL DEFAULT 0,
  `imported` INTEGER NOT NULL DEFAULT 0,
  `updated` INTEGER NOT NULL DEFAULT 0,
  `statusChanged` INTEGER NOT NULL DEFAULT 0,
  `durationMs` INTEGER NULL,
  `error` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `ExternalSourceSync_status_attempt_idx`(`status`, `lastAttemptAt`),
  PRIMARY KEY (`sourceKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
