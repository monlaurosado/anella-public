-- Store the satellite footprint separately from raw provider metadata so the
-- operational map can render a bounded, validated geometry without exposing
-- the complete upstream payload. Existing detections remain valid points.
ALTER TABLE `ExternalDetection`
  ADD COLUMN `satellite` VARCHAR(50) NULL,
  ADD COLUMN `instrument` VARCHAR(50) NULL,
  ADD COLUMN `fireRadiativePowerMw` DECIMAL(10, 2) NULL,
  ADD COLUMN `footprintAreaHectares` DECIMAL(12, 4) NULL,
  ADD COLUMN `footprintJson` JSON NULL;

CREATE INDEX `ExternalDetection_status_detectedAt_idx`
  ON `ExternalDetection`(`status`, `detectedAt`);
