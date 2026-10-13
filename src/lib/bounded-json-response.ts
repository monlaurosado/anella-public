export const EXTERNAL_JSON_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;

export class ExternalJsonResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalJsonResponseError";
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // Preserve the bounded-response error instead of a secondary I/O error.
  }
}

/** Reads an untrusted upstream JSON response without buffering it unboundedly. */
export async function readBoundedJsonResponse(
  response: Pick<Response, "body" | "headers">,
  maximum = EXTERNAL_JSON_RESPONSE_LIMIT_BYTES,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new ExternalJsonResponseError(
        "La fuente ha declarado un tamaño de respuesta no válido.",
      );
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > maximum) {
      try {
        await response.body?.cancel();
      } catch {
        // The size failure is the useful error to report.
      }
      throw new ExternalJsonResponseError(
        "La respuesta de la fuente supera el límite seguro.",
      );
    }
  }

  if (!response.body) {
    throw new ExternalJsonResponseError(
      "La fuente ha devuelto una respuesta vacía.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > maximum) {
        await cancelReader(reader);
        throw new ExternalJsonResponseError(
          "La respuesta de la fuente supera el límite seguro.",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof ExternalJsonResponseError) throw error;
    await cancelReader(reader);
    throw new ExternalJsonResponseError(
      "La respuesta de la fuente no se ha podido leer.",
    );
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExternalJsonResponseError(
      "La fuente no ha devuelto JSON válido.",
    );
  }
}
