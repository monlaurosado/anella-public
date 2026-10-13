import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const deploymentEnvironment = process.env.ANELLA_ENV?.trim();
const environmentsWithManagedSchema = new Set([
  "test",
  "staging",
  "production",
]);

if (!deploymentEnvironment || !environmentsWithManagedSchema.has(deploymentEnvironment)) {
  console.info(
    "Schema deployment skipped: ANELLA_ENV is not test, staging or production.",
  );
  process.exit(0);
}

const prismaCli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Schema deployment failed before build with exit code ${result.status ?? "unknown"}.`,
  );
}
