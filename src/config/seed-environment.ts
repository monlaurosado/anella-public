export type SeedEnvironment = "development" | "test" | "staging" | "production";

function isLoopbackDatabase(databaseUrl: string) {
  try {
    const hostname = new URL(databaseUrl).hostname;
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function assertSeedEnvironment(
  environment: SeedEnvironment | undefined,
  databaseUrl: string,
) {
  if (!environment) {
    throw new Error(
      "ANELLA_ENV debe declararse explícitamente antes de ejecutar el seed",
    );
  }

  if (environment === "staging") {
    throw new Error(
      "El seed está deshabilitado en staging; usa migraciones y datos de prueba controlados fuera del seed local",
    );
  }

  if (environment !== "production" && !isLoopbackDatabase(databaseUrl)) {
    throw new Error(
      "Los seeds de development y test solo pueden usar una base MySQL loopback",
    );
  }

  return environment;
}
