import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";

export const FIRMS_RESPONSE_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxRows: 10_000,
});

type FirmsResponseLimits = {
  maxBytes: number;
  maxRows: number;
};

export class FirmsPayloadLimitError extends Error {
  constructor(
    readonly limit: "bytes" | "rows",
    readonly maximum: number,
  ) {
    super(`NASA FIRMS payload exceeds the ${limit} limit of ${maximum}`);
    this.name = "FirmsPayloadLimitError";
  }
}

export class FirmsPayloadFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirmsPayloadFormatError";
  }
}

const firmsDetectionSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  bright_ti4: z.coerce.number().optional(),
  confidence: z.string().optional(),
  acq_date: z.iso.date(),
  acq_time: z.coerce.string().optional(),
  satellite: z.string().optional(),
  instrument: z.string().optional(),
  frp: z.coerce.number().optional(),
  daynight: z.string().optional(),
});

export type FirmsDetection = z.infer<typeof firmsDetectionSchema>;

function assertResponseLimits(limits: FirmsResponseLimits) {
  if (
    !Number.isSafeInteger(limits.maxBytes) ||
    limits.maxBytes <= 0 ||
    !Number.isSafeInteger(limits.maxRows) ||
    limits.maxRows <= 0
  ) {
    throw new RangeError(
      "Los límites de NASA FIRMS deben ser enteros positivos.",
    );
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // El límite ya se ha aplicado; un fallo del origen al cancelar no debe
    // sustituir el error seguro que verá la persona coordinadora.
  }
}

/**
 * Lee el CSV sin confiar en Content-Length. Si supera cualquier límite se
 * cancela el stream y se descarta el cuerpo completo: nunca se devuelve un
 * prefijo truncado que pudiera importarse como si fuese una respuesta válida.
 */
export async function readFirmsCsvResponse(
  response: Pick<Response, "body" | "headers">,
  limits: FirmsResponseLimits = FIRMS_RESPONSE_LIMITS,
) {
  assertResponseLimits(limits);

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isSafeInteger(declaredLength) &&
    declaredLength > limits.maxBytes
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // El origen ya ha declarado un cuerpo excesivo. Se mantiene el error de
      // límite aunque el transporte falle al cancelar la descarga.
    }
    throw new FirmsPayloadLimitError("bytes", limits.maxBytes);
  }
  if (!response.body) {
    throw new FirmsPayloadFormatError(
      "NASA FIRMS ha devuelto un cuerpo vacío.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let recordDelimiters = 0;
  let previousWasCarriageReturn = false;
  let payload = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > limits.maxBytes) {
        await cancelReader(reader);
        throw new FirmsPayloadLimitError("bytes", limits.maxBytes);
      }

      for (const byte of value) {
        if (byte === 0x0d) {
          recordDelimiters += 1;
          previousWasCarriageReturn = true;
        } else if (byte === 0x0a) {
          if (!previousWasCarriageReturn) recordDelimiters += 1;
          previousWasCarriageReturn = false;
        } else {
          previousWasCarriageReturn = false;
        }
      }
      // Una línea es la cabecera y puede existir un salto final. El recuento
      // exacto se confirma después con csv-parse para cubrir la última fila sin \n.
      if (recordDelimiters > limits.maxRows + 1) {
        await cancelReader(reader);
        throw new FirmsPayloadLimitError("rows", limits.maxRows);
      }

      try {
        payload += decoder.decode(value, { stream: true });
      } catch {
        await cancelReader(reader);
        throw new FirmsPayloadFormatError(
          "NASA FIRMS ha devuelto texto que no es UTF-8 válido.",
        );
      }
    }

    try {
      payload += decoder.decode();
    } catch {
      throw new FirmsPayloadFormatError(
        "NASA FIRMS ha devuelto texto que no es UTF-8 válido.",
      );
    }
    return payload;
  } finally {
    reader.releaseLock();
  }
}

export function firmsDetectionDate(row: FirmsDetection) {
  const time = (row.acq_time ?? "0000").padStart(4, "0");
  const hours = time.slice(0, 2);
  const minutes = time.slice(2, 4);
  return new Date(`${row.acq_date}T${hours}:${minutes}:00.000Z`);
}

export function firmsExternalId(row: FirmsDetection, source: string) {
  return createHash("sha256")
    .update(
      [
        source,
        row.satellite ?? "unknown",
        row.acq_date,
        row.acq_time ?? "0000",
        row.latitude.toFixed(5),
        row.longitude.toFixed(5),
      ].join(":"),
    )
    .digest("hex");
}

export function parseFirmsCsv(
  payload: string,
  limits: Pick<FirmsResponseLimits, "maxRows"> = FIRMS_RESPONSE_LIMITS,
) {
  if (!Number.isSafeInteger(limits.maxRows) || limits.maxRows <= 0) {
    throw new RangeError("El límite de filas de NASA FIRMS debe ser positivo.");
  }
  const rows = parse(payload, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as unknown[];
  if (rows.length > limits.maxRows) {
    throw new FirmsPayloadLimitError("rows", limits.maxRows);
  }
  const detections: FirmsDetection[] = [];
  const rejected: string[] = [];

  rows.forEach((row, index) => {
    const parsed = firmsDetectionSchema.safeParse(row);

    if (parsed.success) {
      detections.push(parsed.data);
    } else {
      rejected.push(`Fila ${index + 2}: ${parsed.error.issues[0]?.message}`);
    }
  });

  return { detections, rejected };
}
