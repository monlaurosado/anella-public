-- Additive human-approval metadata for public safe points. Existing rows stay
-- operationally active but are not public until a coordinator approves them.
ALTER TABLE `SafePoint`
  ADD COLUMN `validatedById` VARCHAR(191) NULL,
  ADD COLUMN `validatedAt` DATETIME(3) NULL;

CREATE INDEX `SafePoint_public_idx`
  ON `SafePoint`(`incidentId`, `isActive`, `validatedAt`);
CREATE INDEX `SafePoint_validatedById_idx`
  ON `SafePoint`(`validatedById`);

ALTER TABLE `SafePoint`
  ADD CONSTRAINT `SafePoint_validatedById_fkey`
  FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
