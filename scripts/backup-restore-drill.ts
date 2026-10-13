import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip, createGzip } from "node:zlib";

import { createConnection, type Connection } from "mariadb";

export const BASE_TABLES = [
  "Municipality",
  "Organization",
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Incident",
  "SafePoint",
  "Need",
  "Contribution",
  "SubmissionThrottle",
  "ExternalDetection",
  "AuditLog",
] as const;

const SCHEMA_TABLE = "_prisma_migrations";
const MAX_CHILD_OUTPUT = 64 * 1024;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type DrillEnvironment = "development" | "test";

type DatabaseConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type BackupRestoreDrillConfiguration = {
  environment: DrillEnvironment;
  source: DatabaseConnection;
  administrator: DatabaseConnection;
};

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type TableDigest = {
  rows: number;
  sha256: string;
};

type RuntimeState = {
  children: Set<ChildProcess>;
  interruptedBy?: NodeJS.Signals;
  restoreDatabase?: string;
  restoreDatabaseCreated: boolean;
  temporaryDirectory?: string;
};

function normalizedLoopbackHost(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHost(hostname: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(
    normalizedLoopbackHost(hostname),
  );
}

function decodeUrlPart(value: string, label: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${label} contiene caracteres codificados no válidos`);
  }
}

function assertSafeCredentialPart(value: string, label: string) {
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${label} no puede contener caracteres de control`);
  }
}

function parseLoopbackDatabaseUrl(
  rawValue: string | undefined,
  label: string,
): DatabaseConnection {
  if (!rawValue?.trim()) {
    throw new Error(`${label} no está configurada`);
  }

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${label} no es una URL MySQL válida`);
  }

  if (url.protocol !== "mysql:") {
    throw new Error(`${label} debe usar mysql://`);
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(`${label} debe apuntar a MySQL loopback`);
  }
  if (url.hash) {
    throw new Error(`${label} no puede contener un fragmento`);
  }

  const user = decodeUrlPart(url.username, `${label}: usuario`);
  const password = decodeUrlPart(url.password, `${label}: contraseña`);
  const database = decodeUrlPart(
    url.pathname.replace(/^\//, ""),
    `${label}: base de datos`,
  );
  const port = url.port ? Number(url.port) : 3306;

  if (!user) throw new Error(`${label} debe incluir un usuario`);
  if (!database || database.includes("/")) {
    throw new Error(`${label} debe seleccionar una única base de datos`);
  }
  if (Buffer.byteLength(database, "utf8") > 64) {
    throw new Error(`${label} selecciona una base de datos demasiado larga`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} contiene un puerto no válido`);
  }

  assertSafeCredentialPart(user, `${label}: usuario`);
  assertSafeCredentialPart(password, `${label}: contraseña`);
  assertSafeCredentialPart(database, `${label}: base de datos`);

  return {
    host: normalizedLoopbackHost(url.hostname),
    port,
    user,
    password,
    database,
  };
}

export function parseDrillConfiguration(
  environment: Record<string, string | undefined>,
): BackupRestoreDrillConfiguration {
  const deploymentEnvironment = environment.ANELLA_ENV?.trim();
  if (
    deploymentEnvironment !== "development" &&
    deploymentEnvironment !== "test"
  ) {
    throw new Error(
      "ANELLA_ENV debe ser explícitamente development o test para ejecutar el simulacro",
    );
  }

  const source = parseLoopbackDatabaseUrl(
    environment.DATABASE_URL,
    "DATABASE_URL",
  );
  const administrator = parseLoopbackDatabaseUrl(
    environment.ANELLA_DRILL_ADMIN_DATABASE_URL ?? environment.DATABASE_URL,
    "ANELLA_DRILL_ADMIN_DATABASE_URL",
  );

  if (
    administrator.host !== source.host ||
    administrator.port !== source.port
  ) {
    throw new Error(
      "La conexión administrativa del simulacro debe usar el mismo host y puerto loopback que DATABASE_URL",
    );
  }

  return {
    environment: deploymentEnvironment,
    source,
    administrator,
  };
}

export function quoteMySqlOptionValue(value: string) {
  assertSafeCredentialPart(value, "El valor del fichero de opciones MySQL");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function mysqlOptionFile(connection: DatabaseConnection) {
  return [
    "[client]",
    "protocol=TCP",
    `host=${quoteMySqlOptionValue(connection.host)}`,
    `port=${connection.port}`,
    `user=${quoteMySqlOptionValue(connection.user)}`,
    `password=${quoteMySqlOptionValue(connection.password)}`,
    "default-character-set=utf8mb4",
    "",
  ].join("\n");
}

function executableCandidates(names: readonly string[], override?: string) {
  if (override?.trim()) {
    const configured = override.trim();
    if (isAbsolute(configured) || configured.includes("/")) {
      return [resolve(configured)];
    }
    names = [configured];
  }

  const pathDirectories = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const homebrewDirectories = [
    "/opt/homebrew/opt/mysql-client/bin",
    "/usr/local/opt/mysql-client/bin",
    "/opt/homebrew/opt/mariadb/bin",
    "/usr/local/opt/mariadb/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  return [...new Set([...pathDirectories, ...homebrewDirectories])].flatMap(
    (directory) => names.map((name) => join(directory, name)),
  );
}

async function resolveExecutable(
  label: string,
  names: readonly string[],
  override?: string,
) {
  for (const candidate of executableCandidates(names, override)) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continúa con el siguiente candidato de PATH/Homebrew.
    }
  }
  throw new Error(
    `No se encontró ${label}. Instala mysql-client o configura el binario explícitamente.`,
  );
}

function addBoundedOutput(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString();
  return next.length <= MAX_CHILD_OUTPUT
    ? next
    : next.slice(next.length - MAX_CHILD_OUTPUT);
}

function trackChild(state: RuntimeState, child: ChildProcess) {
  state.children.add(child);
  child.once("close", () => state.children.delete(child));
  return child;
}

function waitForChild(
  child: ChildProcess,
  options: { captureStdout?: boolean } = {},
) {
  let stdout = "";
  let stderr = "";

  if (options.captureStdout) {
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = addBoundedOutput(stdout, chunk);
    });
  }
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = addBoundedOutput(stderr, chunk);
  });

  return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function assertCommandSucceeded(result: CommandResult, label: string) {
  if (result.code === 0) return;
  const detail = (result.stderr || result.stdout).trim();
  throw new Error(
    detail
      ? `${label} falló: ${detail}`
      : `${label} terminó con código ${result.code ?? "desconocido"}`,
  );
}

export function isOracleMySqlDumpVersion(versionOutput: string) {
  return !/mariadb/i.test(versionOutput);
}

export function mysqlDumpCompatibilityArguments(versionOutput: string) {
  if (!isOracleMySqlDumpVersion(versionOutput)) return [];

  // Oracle mysqldump enables COLUMN_STATISTICS by default, but MariaDB does
  // not expose that information_schema table. Both flags remain valid when
  // the same binary targets Oracle MySQL.
  return ["--set-gtid-purged=OFF", "--column-statistics=0"];
}

async function readToolVersion(binary: string, state: RuntimeState) {
  const child = trackChild(
    state,
    spawn(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"] }),
  );
  const result = await waitForChild(child, { captureStdout: true });
  assertCommandSucceeded(result, `La identificación de ${basename(binary)}`);
  return `${result.stdout}\n${result.stderr}`.trim();
}

async function runDump(input: {
  binary: string;
  defaultsFile: string;
  database: string;
  includeRoutines: boolean;
  compatibilityArguments: string[];
  outputFile: string;
  state: RuntimeState;
}) {
  const argumentsList = [
    `--defaults-extra-file=${input.defaultsFile}`,
    "--single-transaction",
    "--quick",
    "--no-tablespaces",
    "--triggers",
    "--hex-blob",
    "--default-character-set=utf8mb4",
  ];
  argumentsList.push(...input.compatibilityArguments);
  if (input.includeRoutines) argumentsList.push("--routines");
  argumentsList.push(input.database);

  const child = trackChild(
    input.state,
    spawn(input.binary, argumentsList, {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const completion = waitForChild(child);
  let streamFailure: unknown;

  try {
    if (!child.stdout) throw new Error("mysqldump no abrió su salida estándar");
    await pipeline(
      child.stdout,
      createGzip({ level: 9 }),
      createWriteStream(input.outputFile, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    streamFailure = error;
    child.kill("SIGTERM");
  }

  const result = await completion;
  if (streamFailure) throw streamFailure;
  assertCommandSucceeded(result, "mysqldump");
}

async function runRestore(input: {
  binary: string;
  defaultsFile: string;
  database: string;
  backupFile: string;
  state: RuntimeState;
}) {
  const child = trackChild(
    input.state,
    spawn(
      input.binary,
      [
        `--defaults-extra-file=${input.defaultsFile}`,
        "--binary-mode=1",
        "--default-character-set=utf8mb4",
        input.database,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    ),
  );
  const completion = waitForChild(child);
  let streamFailure: unknown;

  try {
    if (!child.stdin) throw new Error("mysql no abrió su entrada estándar");
    await pipeline(
      createReadStream(input.backupFile),
      createGunzip(),
      child.stdin,
    );
  } catch (error) {
    streamFailure = error;
    child.kill("SIGTERM");
  }

  const result = await completion;
  if (streamFailure) {
    // Si el cliente MySQL cerró la tubería, su stderr contiene la causa real
    // (por ejemplo, un límite SQL o un privilegio insuficiente). No la tapes
    // con el EPIPE secundario que observa Node al seguir escribiendo.
    if (result.code !== 0) {
      assertCommandSucceeded(result, "La restauración MySQL");
    }
    throw streamFailure;
  }
  assertCommandSucceeded(result, "La restauración MySQL");
}

async function sha256(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function quoteIdentifier(identifier: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error("El identificador temporal de base de datos no es seguro");
  }
  return `\`${identifier}\``;
}

async function connect(
  config: DatabaseConnection,
  database = config.database,
) {
  return createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database,
    // El script solo admite loopback; esto permite cuentas MySQL 8 locales con
    // caching_sha2_password sin degradar una conexión de red remota.
    allowPublicKeyRetrieval: true,
    connectTimeout: 5_000,
    socketTimeout: 30_000,
  });
}

async function withConnection<T>(
  config: DatabaseConnection,
  database: string,
  callback: (connection: Connection) => Promise<T>,
) {
  const connection = await connect(config, database);
  try {
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

function countAsNumber(value: number | bigint | string | undefined) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("MySQL devolvió un recuento no representable");
  }
  return count;
}

async function readTableCounts(
  config: DatabaseConnection,
  database: string,
) {
  return withConnection(config, database, async (connection) => {
    const counts = new Map<string, number>();
    for (const table of [...BASE_TABLES, SCHEMA_TABLE]) {
      const rows = await connection.query<
        Array<{ count: number | bigint | string }>
      >(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
      counts.set(table, countAsNumber(rows[0]?.count));
    }
    return counts;
  });
}

function canonicalDigestValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "number") return `number:${value.toString()}`;
  if (typeof value === "boolean") {
    return value ? "boolean:true" : "boolean:false";
  }
  if (typeof value === "string") return `string:${value}`;
  if (Buffer.isBuffer(value)) return `buffer:${value.toString("hex")}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (Array.isArray(value)) {
    return `array:[${value.map(canonicalDigestValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${canonicalDigestValue(key)}=${canonicalDigestValue(record[key])}`,
      );
    return `object:{${entries.join(",")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

function updateLengthPrefixed(
  hash: ReturnType<typeof createHash>,
  value: string,
) {
  hash.update(`${Buffer.byteLength(value, "utf8")}:`, "utf8");
  hash.update(value, "utf8");
}

async function readTableDigest(
  connection: Connection,
  database: string,
  table: string,
): Promise<TableDigest> {
  const columnRows = await connection.query<Array<{ name: string }>>(
    `SELECT COLUMN_NAME AS name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [database, table],
  );
  const columns = columnRows.map((row) => row.name);
  if (columns.length === 0) {
    throw new Error(`No se pudieron leer las columnas de ${table}`);
  }

  const uniqueIndexRows = await connection.query<
    Array<{ indexName: string; columnName: string; sequence: number }>
  >(
    `SELECT INDEX_NAME AS indexName,
            COLUMN_NAME AS columnName,
            SEQ_IN_INDEX AS sequence
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND NON_UNIQUE = 0
      ORDER BY CASE WHEN INDEX_NAME = 'PRIMARY' THEN 0 ELSE 1 END,
               INDEX_NAME,
               SEQ_IN_INDEX`,
    [database, table],
  );
  const preferredIndex = uniqueIndexRows[0]?.indexName;
  const orderingColumns = preferredIndex
    ? uniqueIndexRows
        .filter((row) => row.indexName === preferredIndex)
        .sort((left, right) => left.sequence - right.sequence)
        .map((row) => row.columnName)
    : columns;
  const selectedColumns = columns.map(quoteIdentifier).join(", ");
  const orderBy = orderingColumns.map(quoteIdentifier).join(", ");
  const stream = connection.queryStream(
    `SELECT ${selectedColumns} FROM ${quoteIdentifier(table)} ORDER BY ${orderBy}`,
  );
  const hash = createHash("sha256");
  updateLengthPrefixed(hash, table);
  for (const column of columns) updateLengthPrefixed(hash, column);

  let rows = 0;
  for await (const rawRow of stream) {
    const row = rawRow as Record<string, unknown>;
    hash.update("row:", "utf8");
    for (const column of columns) {
      updateLengthPrefixed(hash, canonicalDigestValue(row[column]));
    }
    rows += 1;
  }

  return { rows, sha256: hash.digest("hex") };
}

async function readTableDigests(
  config: DatabaseConnection,
  database: string,
) {
  return withConnection(config, database, async (connection) => {
    const digests = new Map<string, TableDigest>();
    for (const table of [...BASE_TABLES, SCHEMA_TABLE]) {
      digests.set(
        table,
        await readTableDigest(connection, database, table),
      );
    }
    return digests;
  });
}

async function assertBaseTablesExist(config: DatabaseConnection) {
  await withConnection(config, config.database, async (connection) => {
    const rows = await connection.query<Array<{ name: string }>>(
      `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?`,
      [config.database],
    );
    const names = new Set(rows.map((row) => row.name));
    const missing = [...BASE_TABLES, SCHEMA_TABLE].filter(
      (table) => !names.has(table),
    );
    if (missing.length > 0) {
      throw new Error(
        `La base origen no contiene todas las tablas requeridas: ${missing.join(", ")}`,
      );
    }
  });
}

async function sourceHasStoredRoutines(
  config: DatabaseConnection,
  sourceDatabase: string,
) {
  return withConnection(config, sourceDatabase, async (connection) => {
    const rows = await connection.query<
      Array<{ count: number | bigint | string }>
    >(
      `SELECT COUNT(*) AS count
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?`,
      [sourceDatabase],
    );
    return countAsNumber(rows[0]?.count) > 0;
  });
}

function restoredDatabaseUrl(config: DatabaseConnection, database: string) {
  const url = new URL("mysql://localhost");
  url.hostname = config.host === "::1" ? "[::1]" : config.host;
  url.port = String(config.port);
  url.username = config.user;
  url.password = config.password;
  url.pathname = `/${database}`;
  return url.toString();
}

async function runCapturedNodeCommand(input: {
  arguments: string[];
  databaseUrl: string;
  environment: DrillEnvironment;
  label: string;
  requiredOutput?: string;
  state: RuntimeState;
}) {
  const child = trackChild(
    input.state,
    spawn(process.execPath, input.arguments, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ANELLA_ENV: input.environment,
        DATABASE_URL: input.databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const result = await waitForChild(child, { captureStdout: true });
  assertCommandSucceeded(result, input.label);
  if (input.requiredOutput && !result.stdout.includes(input.requiredOutput)) {
    throw new Error(`${input.label} no confirmó el resultado esperado`);
  }
}

async function runSchemaChecks(input: {
  databaseUrl: string;
  environment: DrillEnvironment;
  state: RuntimeState;
}) {
  await runCapturedNodeCommand({
    arguments: [
      join(projectRoot, "node_modules/tsx/dist/cli.mjs"),
      join(projectRoot, "scripts/preflight-migrations.ts"),
    ],
    databaseUrl: input.databaseUrl,
    environment: input.environment,
    label: "El preflight de esquema",
    requiredOutput: "Preflight superado",
    state: input.state,
  });
  await runCapturedNodeCommand({
    arguments: [
      join(projectRoot, "node_modules/prisma/build/index.js"),
      "migrate",
      "status",
      "--schema",
      join(projectRoot, "prisma/schema.prisma"),
    ],
    databaseUrl: input.databaseUrl,
    environment: input.environment,
    label: "La comprobación de migraciones Prisma",
    requiredOutput: "Database schema is up to date",
    state: input.state,
  });
}

function assertEqualCounts(
  expected: Map<string, number>,
  actual: Map<string, number>,
  mismatchMessage: string,
) {
  for (const table of [...BASE_TABLES, SCHEMA_TABLE]) {
    if (expected.get(table) !== actual.get(table)) {
      throw new Error(`${mismatchMessage}: ${table}`);
    }
  }
}

export function assertEqualDigests(
  expected: Map<string, TableDigest>,
  actual: Map<string, TableDigest>,
  mismatchMessage: string,
) {
  for (const table of [...BASE_TABLES, SCHEMA_TABLE]) {
    const expectedDigest = expected.get(table);
    const actualDigest = actual.get(table);
    if (
      !expectedDigest ||
      !actualDigest ||
      expectedDigest.rows !== actualDigest.rows ||
      expectedDigest.sha256 !== actualDigest.sha256
    ) {
      throw new Error(`${mismatchMessage}: ${table}`);
    }
  }
}

function assertNotInterrupted(state: RuntimeState) {
  if (state.interruptedBy) {
    throw new Error(`Simulacro interrumpido por ${state.interruptedBy}`);
  }
}

function sanitizeMessage(message: string, sensitiveValues: string[]) {
  let safe = message;
  for (const value of sensitiveValues.filter(Boolean)) {
    safe = safe.replaceAll(value, "[redactado]");
  }
  return safe;
}

function errorMessage(error: unknown, sensitiveValues: string[]): string {
  if (error instanceof AggregateError) {
    return error.errors
      .map((entry) => errorMessage(entry, sensitiveValues))
      .join("; ");
  }
  const message = error instanceof Error ? error.message : "error desconocido";
  return sanitizeMessage(message, sensitiveValues);
}

async function cleanup(
  state: RuntimeState,
  config?: BackupRestoreDrillConfiguration,
) {
  for (const child of state.children) child.kill("SIGTERM");

  const cleanupErrors: unknown[] = [];
  if (state.restoreDatabaseCreated && state.restoreDatabase && config) {
    try {
      await withConnection(
        config.administrator,
        config.administrator.database,
        async (connection) => {
          await connection.query(
            `DROP DATABASE IF EXISTS ${quoteIdentifier(state.restoreDatabase!)}`,
          );
        },
      );
      state.restoreDatabaseCreated = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (state.temporaryDirectory) {
    try {
      await rm(state.temporaryDirectory, { recursive: true, force: true });
      state.temporaryDirectory = undefined;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "No se pudieron eliminar todos los recursos temporales del simulacro",
    );
  }
}

async function executeDrill() {
  const state: RuntimeState = {
    children: new Set(),
    restoreDatabaseCreated: false,
  };
  let configuration: BackupRestoreDrillConfiguration | undefined;
  let operationError: unknown;
  const sensitiveValues = [
    process.env.DATABASE_URL ?? "",
    process.env.ANELLA_DRILL_ADMIN_DATABASE_URL ?? "",
  ];

  const onSignal = (signal: NodeJS.Signals) => {
    state.interruptedBy = signal;
    for (const child of state.children) child.kill("SIGTERM");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    configuration = parseDrillConfiguration(process.env);
    sensitiveValues.push(
      configuration.source.password,
      configuration.administrator.password,
    );

    const [dumpBinary, mysqlBinary] = await Promise.all([
      resolveExecutable(
        "mysqldump/mariadb-dump",
        ["mysqldump", "mariadb-dump"],
        process.env.MYSQLDUMP_BIN,
      ),
      resolveExecutable(
        "mysql/mariadb",
        ["mysql", "mariadb"],
        process.env.MYSQL_BIN,
      ),
    ]);
    assertNotInterrupted(state);
    state.temporaryDirectory = await mkdtemp(
      join(tmpdir(), "anella-backup-restore-"),
    );
    await chmod(state.temporaryDirectory, 0o700);
    const sourceDefaults = join(state.temporaryDirectory, "source.cnf");
    const adminDefaults = join(state.temporaryDirectory, "administrator.cnf");
    const backupFile = join(state.temporaryDirectory, "backup.sql.gz");
    const checksumFile = join(
      state.temporaryDirectory,
      "backup.sql.gz.sha256",
    );
    const restoreDatabase = `anella_restore_drill_${process.pid}_${randomBytes(6).toString("hex")}`;
    state.restoreDatabase = restoreDatabase;

    await Promise.all([
      writeFile(sourceDefaults, mysqlOptionFile(configuration.source), {
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(adminDefaults, mysqlOptionFile(configuration.administrator), {
        flag: "wx",
        mode: 0o600,
      }),
    ]);

    console.log(
      `Simulacro local de backup/restore (${configuration.environment}).`,
    );
    console.log(
      `Herramientas: ${basename(dumpBinary)} y ${basename(mysqlBinary)}.`,
    );

    await assertBaseTablesExist(configuration.source);
    const [includeRoutines, dumpVersion] = await Promise.all([
      sourceHasStoredRoutines(
        configuration.administrator,
        configuration.source.database,
      ),
      readToolVersion(dumpBinary, state),
    ]);
    assertNotInterrupted(state);
    const countsBeforeDump = await readTableCounts(
      configuration.source,
      configuration.source.database,
    );
    const digestsBeforeDump = await readTableDigests(
      configuration.source,
      configuration.source.database,
    );
    await runDump({
      binary: dumpBinary,
      defaultsFile: sourceDefaults,
      database: configuration.source.database,
      includeRoutines,
      compatibilityArguments: mysqlDumpCompatibilityArguments(dumpVersion),
      outputFile: backupFile,
      state,
    });
    assertNotInterrupted(state);
    const countsAfterDump = await readTableCounts(
      configuration.source,
      configuration.source.database,
    );
    const digestsAfterDump = await readTableDigests(
      configuration.source,
      configuration.source.database,
    );
    assertEqualCounts(
      countsBeforeDump,
      countsAfterDump,
      "La base origen cambió mientras se generaba el backup",
    );
    assertEqualDigests(
      digestsBeforeDump,
      digestsAfterDump,
      "El contenido de la base origen cambió mientras se generaba el backup",
    );

    const checksum = await sha256(backupFile);
    await writeFile(checksumFile, `${checksum}  backup.sql.gz\n`, {
      flag: "wx",
      mode: 0o600,
    });
    const recordedChecksum = (await readFile(checksumFile, "utf8")).split(
      /\s+/,
      1,
    )[0];
    if (!recordedChecksum || recordedChecksum !== (await sha256(backupFile))) {
      throw new Error("El checksum SHA-256 del backup no coincide");
    }
    console.log("Backup comprimido y checksum SHA-256 verificados.");
    assertNotInterrupted(state);

    try {
      await withConnection(
        configuration.administrator,
        configuration.administrator.database,
        async (connection) => {
          await connection.query(
            `CREATE DATABASE ${quoteIdentifier(restoreDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
          );
        },
      );
      state.restoreDatabaseCreated = true;
    } catch (error) {
      throw new Error(
        "No se pudo crear la base temporal. Configura ANELLA_DRILL_ADMIN_DATABASE_URL con una cuenta local exclusiva que pueda crear, restaurar y eliminar bases.",
        { cause: error },
      );
    }

    await runRestore({
      binary: mysqlBinary,
      defaultsFile: adminDefaults,
      database: restoreDatabase,
      backupFile,
      state,
    });
    assertNotInterrupted(state);
    const restoredCounts = await readTableCounts(
      configuration.administrator,
      restoreDatabase,
    );
    const restoredDigests = await readTableDigests(
      configuration.administrator,
      restoreDatabase,
    );
    assertEqualCounts(
      countsAfterDump,
      restoredCounts,
      "El recuento restaurado no coincide; detén el uso de esta copia",
    );
    assertEqualDigests(
      digestsAfterDump,
      restoredDigests,
      "El contenido restaurado no coincide; detén el uso de esta copia",
    );
    console.log(
      `Recuentos y digests coincidentes en ${BASE_TABLES.length} tablas base y el historial de migraciones.`,
    );

    await runSchemaChecks({
      databaseUrl: restoredDatabaseUrl(
        configuration.administrator,
        restoreDatabase,
      ),
      environment: configuration.environment,
      state,
    });
    assertNotInterrupted(state);
    console.log("Preflight e historial Prisma de la copia restaurada correctos.");
  } catch (error) {
    operationError = error;
  }

  try {
    await cleanup(state, configuration);
  } catch (error) {
    operationError = operationError
      ? new AggregateError(
          [operationError, error],
          "El simulacro y su limpieza fallaron",
        )
      : error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  if (state.interruptedBy) {
    throw new Error(`Simulacro interrumpido por ${state.interruptedBy}`);
  }
  if (operationError) {
    throw new Error(errorMessage(operationError, sensitiveValues));
  }
  console.log("Simulacro superado; base y archivos temporales eliminados.");
}

async function main() {
  const sensitiveValues = [
    process.env.DATABASE_URL ?? "",
    process.env.ANELLA_DRILL_ADMIN_DATABASE_URL ?? "",
  ];
  try {
    await executeDrill();
  } catch (error) {
    console.error(
      `Simulacro de backup/restore fallido: ${errorMessage(error, sensitiveValues)}`,
    );
    process.exitCode = 1;
  }
}

const invokedFile = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedFile === import.meta.url) {
  void main();
}
