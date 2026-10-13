import { PrismaClient } from "@/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { getDatabaseUrl } from "@/config/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const databaseUrl = new URL(getDatabaseUrl());

  if (databaseUrl.searchParams.get("sslaccept") === "strict") {
    databaseUrl.searchParams.delete("sslaccept");
    databaseUrl.searchParams.set("ssl", "true");
  }
  databaseUrl.searchParams.set("connectionLimit", "3");
  databaseUrl.searchParams.set("idleTimeout", "0");
  // MariaDB executable comments are ignored by MySQL. This initializes every
  // supported MariaDB session with CHECK enforcement and keeps utf8mb4 text
  // literals aligned with the utf8mb4_unicode_ci schema. MariaDB 11.4+
  // otherwise defaults those literals to its newer UCA collation.
  databaseUrl.searchParams.set(
    "initSql",
    // A newline is the only required whitespace. URL serialization preserves
    // it as %0A instead of turning spaces into '+' inside initSql.
    "/*M!110400\nSET@@session.check_constraint_checks=1,@@session.character_set_collations='utf8mb4=utf8mb4_unicode_ci'*/",
  );

  // MariaDB 11.8 resolves string parameters from the binary protocol as
  // utf8mb4_bin inside Prisma's CONCAT-based string filters. The adapter's
  // text protocol keeps values escaped by the driver while preserving the
  // connection collation, so contains/startsWith work on both supported
  // MariaDB and MySQL installations.
  const adapter = new PrismaMariaDb(databaseUrl.toString(), {
    useTextProtocol: true,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
