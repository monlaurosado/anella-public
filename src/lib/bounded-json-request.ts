import "server-only";

export const PRIVATE_JSON_BODY_LIMIT_BYTES = 512;

type JsonBodyFailure = {
  ok: false;
  status: 400 | 413 | 415;
  message: string;
};

type JsonBodyResult = { ok: true; value: unknown } | JsonBodyFailure;

function contentLengthFailure(
  contentLength: string | null,
  maxBytes: number,
): JsonBodyFailure | { ok: true; value?: number } {
  if (contentLength === null) return { ok: true };
  if (!/^\d+$/.test(contentLength)) {
    return {
      ok: false,
      status: 400,
      message: "La cabecera Content-Length no es válida.",
    };
  }

  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes)) {
    return {
      ok: false,
      status: 400,
      message: "La cabecera Content-Length no es válida.",
    };
  }
  if (declaredBytes > maxBytes) {
    return {
      ok: false,
      status: 413,
      message: `El cuerpo JSON no puede superar ${maxBytes} bytes.`,
    };
  }

  return { ok: true, value: declaredBytes };
}

export async function readBoundedJson(
  request: Request,
  maxBytes = PRIVATE_JSON_BODY_LIMIT_BYTES,
): Promise<JsonBodyResult> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      status: 415,
      message:
        "El cuerpo debe enviarse como JSON con Content-Type application/json.",
    };
  }

  const length = contentLengthFailure(
    request.headers.get("content-length"),
    maxBytes,
  );
  if (!length.ok) return length;

  if (!request.body) {
    return {
      ok: false,
      status: 400,
      message: "El cuerpo JSON está vacío o no es válido.",
    };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          status: 413,
          message: `El cuerpo JSON no puede superar ${maxBytes} bytes.`,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    await reader.cancel().catch(() => undefined);
    return {
      ok: false,
      status: 400,
      message: "El cuerpo JSON no se ha podido leer.",
    };
  }

  if (length.value !== undefined && length.value !== bytesRead) {
    return {
      ok: false,
      status: 400,
      message: "La cabecera Content-Length no coincide con el cuerpo recibido.",
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      message: "El cuerpo JSON está vacío o no es válido.",
    };
  }
}
