export type SupportedDatabaseEngine = "mysql" | "mariadb";
export type DatabaseEngine = SupportedDatabaseEngine | "unknown";

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
};

export function identifyDatabaseEngine(
  version: string,
  versionComment: string,
): DatabaseEngine {
  const identity = `${version} ${versionComment}`;
  if (/mariadb/i.test(identity)) return "mariadb";
  if (/\bmysql\b/i.test(identity)) return "mysql";
  return "unknown";
}

function parseDatabaseVersion(
  version: string,
  engine: DatabaseEngine,
): ParsedVersion | null {
  if (engine === "unknown") return null;
  const normalized =
    engine === "mariadb" ? version.replace(/^5\.5\.5-/, "") : version;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(normalized);
  if (!match) return null;

  const [, majorText, minorText, patchText] = match;
  return {
    major: Number(majorText),
    minor: Number(minorText),
    patch: Number(patchText),
  };
}

export function databaseMeetsAnellaContract(
  version: string,
  versionComment: string,
) {
  const engine = identifyDatabaseEngine(version, versionComment);
  const parsed = parseDatabaseVersion(version, engine);
  if (!parsed) return false;

  const { major, minor, patch } = parsed;
  if (engine === "mariadb") {
    return major > 11 || (major === 11 && minor >= 8);
  }

  return major > 8 || (major === 8 && (minor > 0 || patch >= 16));
}

export function databaseEngineLabel(version: string, versionComment: string) {
  const engine = identifyDatabaseEngine(version, versionComment);
  if (engine === "mariadb") return "MariaDB";
  if (engine === "mysql") return "MySQL";
  return "motor desconocido";
}
