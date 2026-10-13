const retryableMysqlTransactionCodes = new Set(["1020", "1205", "1213"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizedCode(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

/**
 * Recognises only database signals that are safe to retry as a complete
 * transaction. Prisma normally maps write conflicts to P2034, but the
 * MariaDB driver adapter currently leaves errors 1020 and 1205 nested in a
 * DriverAdapterError payload.
 */
export function isRetryableTransactionError(error: unknown) {
  const queue: unknown[] = [error];
  const seen = new Set<object>();

  for (let index = 0; index < queue.length && index < 8; index += 1) {
    const candidate = queue[index];
    if (!isRecord(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);

    if (
      candidate.code === "P2034" ||
      candidate.kind === "TransactionWriteConflict"
    ) {
      return true;
    }

    const rawDriverCode = normalizedCode(candidate.errno);
    if (
      (rawDriverCode && retryableMysqlTransactionCodes.has(rawDriverCode)) ||
      candidate.sqlState === "40001"
    ) {
      return true;
    }

    if (candidate.kind === "mysql") {
      const adapterCode =
        normalizedCode(candidate.originalCode) ??
        normalizedCode(candidate.code);
      if (
        (adapterCode && retryableMysqlTransactionCodes.has(adapterCode)) ||
        candidate.state === "40001"
      ) {
        return true;
      }
    }

    queue.push(candidate.cause);
    if (isRecord(candidate.meta)) {
      queue.push(candidate.meta.driverAdapterError);
    }
  }

  return false;
}

/** Retries only when the callback represents one complete database transaction. */
export async function runWholeTransactionWithRetry<T>(
  transaction: () => Promise<T>,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction();
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 3) throw error;
    }
  }

  throw new Error("UNREACHABLE_TRANSACTION_RETRY");
}
