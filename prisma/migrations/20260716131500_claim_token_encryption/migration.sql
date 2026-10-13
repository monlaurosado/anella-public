-- Verification links must be deliverable without storing the raw token. The
-- application encrypts this value with an authenticated key before enqueueing
-- the provider job; only its SHA-256 hash is used to verify a submitted token.
ALTER TABLE `OrganizationClaim`
  ADD COLUMN `verificationTokenCiphertext` TEXT NULL;
