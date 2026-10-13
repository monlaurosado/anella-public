import {
  cleanupE2EAccountSecurityFixtures,
  cleanupE2EContributions,
  cleanupE2EOperationalFixtures,
} from "./database";

export default async function globalSetup() {
  await cleanupE2EOperationalFixtures();
  await cleanupE2EAccountSecurityFixtures();
  await cleanupE2EContributions();
}
