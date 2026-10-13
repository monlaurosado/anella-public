/**
 * Emit only a bounded error class/code. Error messages and Prisma metadata can
 * contain submitted form values, URLs or upstream payloads and must not reach
 * application logs.
 */
export function logServerError(context: string, error: unknown) {
  const record =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; code?: unknown })
      : null;
  const name =
    typeof record?.name === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(record.name)
      ? record.name
      : "UnknownError";
  const code =
    typeof record?.code === "string" &&
    /^[A-Za-z0-9_.-]{1,80}$/.test(record.code)
      ? record.code
      : undefined;
  console.error(context, code ? { name, code } : { name });
}
