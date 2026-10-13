import {
  cleanupE2EAccountSecurityFixtures,
  cleanupE2EContributions,
  cleanupE2EOperationalFixtures,
} from "./database";

export default async function globalTeardown() {
  await cleanupE2EOperationalFixtures();
  await cleanupE2EAccountSecurityFixtures();
  await cleanupE2EContributions();
}
