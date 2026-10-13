-- CreateTable
CREATE TABLE `Municipality` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `province` VARCHAR(191) NULL,
    `region` VARCHAR(191) NULL,
    `country` CHAR(2) NOT NULL DEFAULT 'ES',
    `latitude` DECIMAL(9, 6) NULL,
    `longitude` DECIMAL(9, 6) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Municipality_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Organization` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('MUNICIPALITY', 'CIVIL_PROTECTION', 'FIRE_DEPARTMENT', 'NGO', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(50) NULL,
    `municipalityId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Organization_municipalityId_idx`(`municipalityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `emailVerified` DATETIME(3) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `phone` VARCHAR(50) NULL,
    `role` ENUM('CITIZEN', 'COORDINATOR', 'MUNICIPAL_ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'CITIZEN',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `organizationId` VARCHAR(191) NULL,
    `municipalityId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_organizationId_idx`(`organizationId`),
    INDEX `User_municipalityId_idx`(`municipalityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerAccountId` VARCHAR(191) NOT NULL,
    `refresh_token` TEXT NULL,
    `access_token` TEXT NULL,
    `expires_at` INTEGER NULL,
    `token_type` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NULL,
    `id_token` TEXT NULL,
    `session_state` VARCHAR(191) NULL,

    INDEX `Account_userId_idx`(`userId`),
    UNIQUE INDEX `Account_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `sessionToken` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Session_sessionToken_key`(`sessionToken`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationToken` (
    `identifier` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `expires` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VerificationToken_token_key`(`token`),
    UNIQUE INDEX `VerificationToken_identifier_token_key`(`identifier`, `token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Incident` (
    `id` VARCHAR(191) NOT NULL,
    `publicCode` VARCHAR(32) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `type` ENUM('WILDFIRE', 'FLOOD', 'STORM', 'EARTHQUAKE', 'SNOW', 'POWER_OUTAGE', 'SEARCH_RESCUE', 'HEALTH', 'INDUSTRIAL', 'OTHER') NOT NULL DEFAULT 'WILDFIRE',
    `status` ENUM('DRAFT', 'PENDING_VALIDATION', 'ACTIVE', 'MONITORING', 'RESOLVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_VALIDATION',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `description` TEXT NULL,
    `publicSummary` TEXT NULL,
    `safetyNotice` TEXT NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `radiusMeters` INTEGER NOT NULL DEFAULT 1500,
    `responsibleOrgName` VARCHAR(191) NULL,
    `organizationId` VARCHAR(191) NULL,
    `municipalityId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `verifiedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Incident_publicCode_key`(`publicCode`),
    INDEX `Incident_status_priority_idx`(`status`, `priority`),
    INDEX `Incident_municipalityId_idx`(`municipalityId`),
    INDEX `Incident_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SafePoint` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `municipalityId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `address` VARCHAR(255) NULL,
    `instructions` TEXT NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `capacityNote` VARCHAR(191) NULL,
    `contactName` VARCHAR(191) NULL,
    `qrToken` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SafePoint_qrToken_key`(`qrToken`),
    INDEX `SafePoint_incidentId_idx`(`incidentId`),
    INDEX `SafePoint_municipalityId_idx`(`municipalityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Need` (
    `id` VARCHAR(191) NOT NULL,
    `incidentId` VARCHAR(191) NOT NULL,
    `safePointId` VARCHAR(191) NOT NULL,
    `type` ENUM('WATER', 'FOOD', 'ICE', 'MEDICAL_SUPPLIES', 'TRANSPORT', 'POWER', 'TOOLS', 'SHELTER', 'VOLUNTEERS', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `quantityNeeded` INTEGER NOT NULL,
    `quantityReceived` INTEGER NOT NULL DEFAULT 0,
    `unit` VARCHAR(32) NOT NULL DEFAULT 'uds',
    `deadline` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'COVERED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Need_incidentId_status_idx`(`incidentId`, `status`),
    INDEX `Need_safePointId_idx`(`safePointId`),
    INDEX `Need_priority_idx`(`priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contribution` (
    `id` VARCHAR(191) NOT NULL,
    `publicCode` VARCHAR(20) NOT NULL,
    `cancelTokenHash` CHAR(64) NULL,
    `needId` VARCHAR(191) NOT NULL,
    `safePointId` VARCHAR(191) NULL,
    `citizenName` VARCHAR(191) NOT NULL,
    `citizenPhone` VARCHAR(50) NULL,
    `citizenEmail` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `deliveredQuantity` INTEGER NOT NULL DEFAULT 0,
    `eta` DATETIME(3) NULL,
    `status` ENUM('PLEDGED', 'EN_ROUTE', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'PLEDGED',
    `notes` TEXT NULL,
    `consentAt` DATETIME(3) NOT NULL,
    `checkedInAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contribution_publicCode_key`(`publicCode`),
    UNIQUE INDEX `Contribution_cancelTokenHash_key`(`cancelTokenHash`),
    INDEX `Contribution_needId_status_idx`(`needId`, `status`),
    INDEX `Contribution_safePointId_idx`(`safePointId`),
    INDEX `Contribution_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionThrottle` (
    `id` VARCHAR(191) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SubmissionThrottle_updatedAt_idx`(`updatedAt`),
    UNIQUE INDEX `SubmissionThrottle_keyHash_action_windowStart_key`(`keyHash`, `action`, `windowStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExternalDetection` (
    `id` VARCHAR(191) NOT NULL,
    `source` ENUM('NASA_FIRMS', 'EFFIS', 'INCENDISCAT', 'AEMET', 'METEOCAT', 'EMERGENCY_112', 'CIVIL_PROTECTION', 'MANUAL', 'OTHER') NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(255) NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL,
    `brightness` DECIMAL(8, 2) NULL,
    `confidence` VARCHAR(50) NULL,
    `status` ENUM('PENDING', 'DISMISSED', 'LINKED') NOT NULL DEFAULT 'PENDING',
    `rawJson` JSON NULL,
    `linkedIncidentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExternalDetection_externalId_key`(`externalId`),
    INDEX `ExternalDetection_source_detectedAt_idx`(`source`, `detectedAt`),
    INDEX `ExternalDetection_status_idx`(`status`),
    INDEX `ExternalDetection_linkedIncidentId_idx`(`linkedIncidentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `incidentId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_idx`(`actorId`),
    INDEX `AuditLog_incidentId_idx`(`incidentId`),
    INDEX `AuditLog_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Organization` ADD CONSTRAINT `Organization_municipalityId_fkey` FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_municipalityId_fkey` FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_municipalityId_fkey` FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Incident` ADD CONSTRAINT `Incident_verifiedById_fkey` FOREIGN KEY (`verifiedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SafePoint` ADD CONSTRAINT `SafePoint_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SafePoint` ADD CONSTRAINT `SafePoint_municipalityId_fkey` FOREIGN KEY (`municipalityId`) REFERENCES `Municipality`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Need` ADD CONSTRAINT `Need_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Need` ADD CONSTRAINT `Need_safePointId_fkey` FOREIGN KEY (`safePointId`) REFERENCES `SafePoint`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contribution` ADD CONSTRAINT `Contribution_needId_fkey` FOREIGN KEY (`needId`) REFERENCES `Need`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contribution` ADD CONSTRAINT `Contribution_safePointId_fkey` FOREIGN KEY (`safePointId`) REFERENCES `SafePoint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalDetection` ADD CONSTRAINT `ExternalDetection_linkedIncidentId_fkey` FOREIGN KEY (`linkedIncidentId`) REFERENCES `Incident`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `Incident`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
