-- Align the database privacy floor with the application rule. Values accepted
-- by the historical 1,000 m CHECK are generalized outward; operational
-- coordinates and operational radii are never changed.
UPDATE `Incident`
SET `publicRadiusMeters` = 1500
WHERE `publicRadiusMeters` >= 1000
  AND `publicRadiusMeters` < 1500;

-- MySQL 8.0.16-8.0.18 uses DROP CHECK, while MariaDB uses DROP CONSTRAINT.
-- MySQL 8.0.16 also cannot drop and recreate a CHECK with the same name in
-- one ALTER. Install the stronger rule under a new name while atomically
-- retiring the old one so the table is never left without the privacy floor.
SET @replace_public_radius_check = IF(
  VERSION() LIKE '%MariaDB%',
  'ALTER TABLE `Incident` DROP CONSTRAINT `Incident_publicRadiusMeters_check`, ADD CONSTRAINT `Incident_publicRadiusMeters_floor_check` CHECK (`publicRadiusMeters` IS NULL OR `publicRadiusMeters` BETWEEN 1500 AND 100000)',
  'ALTER TABLE `Incident` DROP CHECK `Incident_publicRadiusMeters_check`, ADD CONSTRAINT `Incident_publicRadiusMeters_floor_check` CHECK (`publicRadiusMeters` IS NULL OR `publicRadiusMeters` BETWEEN 1500 AND 100000)'
);

PREPARE replace_public_radius_check FROM @replace_public_radius_check;
EXECUTE replace_public_radius_check;
DEALLOCATE PREPARE replace_public_radius_check;
