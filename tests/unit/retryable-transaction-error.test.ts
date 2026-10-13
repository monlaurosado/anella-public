import { describe, expect, it, vi } from "vitest";

import {
  isRetryableTransactionError,
  runWholeTransactionWithRetry,
} from "@/lib/retryable-transaction-error";

describe("retryable transaction errors", () => {
  it.each([
    { code: "P2034" },
    { kind: "TransactionWriteConflict" },
    { errno: 1020, sqlState: "HY000" },
    { errno: 1205, sqlState: "HY000" },
    { errno: 1213, sqlState: "40001" },
    { sqlState: "40001" },
    { kind: "mysql", code: 1020, state: "HY000" },
    { kind: "mysql", originalCode: "1205", state: "HY000" },
    { kind: "mysql", state: "40001" },
    {
      name: "DriverAdapterError",
      cause: { kind: "mysql", code: 1020, originalCode: "1020" },
    },
    {
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { kind: "mysql", code: 1205 },
        },
      },
    },
  ])("recognises a bounded database conflict: %#", (error) => {
    expect(isRetryableTransactionError(error)).toBe(true);
  });

  it.each([
    null,
    "deadlock",
    new Error("Record changed; try restarting transaction"),
    { code: "P2002" },
    { code: "P2034x" },
    { code: 1205 },
    { originalCode: "1205" },
    { errno: 1062 },
    { errno: 1021 },
    { errno: 1206 },
    { errno: 1223 },
    { sqlState: "HY000" },
    { sqlState: "40002" },
    { kind: "mysql", state: "HY000" },
    { retryable: true },
  ])("does not retry an unrelated or ambiguous failure: %#", (error) => {
    expect(isRetryableTransactionError(error)).toBe(false);
  });

  it("terminates while inspecting cyclic causes", () => {
    const first: { cause?: unknown } = {};
    const second: { cause?: unknown } = { cause: first };
    first.cause = second;

    expect(isRetryableTransactionError(first)).toBe(false);
  });

  it("reruns a complete transaction until a retryable conflict succeeds", async () => {
    const transaction = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({
        name: "DriverAdapterError",
        cause: { kind: "mysql", code: 1020 },
      })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockResolvedValue("committed");

    await expect(runWholeTransactionWithRetry(transaction)).resolves.toBe(
      "committed",
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("propagates a non-retryable failure without rerunning", async () => {
    const failure = { code: "P2002" };
    const transaction = vi.fn<() => Promise<void>>().mockRejectedValue(failure);

    await expect(runWholeTransactionWithRetry(transaction)).rejects.toBe(
      failure,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("stops after the third retryable failure and preserves the last error", async () => {
    const failures = [{ errno: 1205 }, { errno: 1205 }, { errno: 1205 }];
    const transaction = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failures[0])
      .mockRejectedValueOnce(failures[1])
      .mockRejectedValueOnce(failures[2]);

    await expect(runWholeTransactionWithRetry(transaction)).rejects.toBe(
      failures[2],
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
