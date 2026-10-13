import "server-only";

export const EXTERNAL_PDF_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxPages: 12,
  maxCharacters: 250_000,
});

export class ExternalPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalPdfError";
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // Preserve the bounded-response error instead of a secondary I/O error.
  }
}

/** Reads an untrusted PDF response without buffering it without a limit. */
export async function readBoundedPdfResponse(
  response: Pick<Response, "body" | "headers">,
  maximum = EXTERNAL_PDF_LIMITS.maxBytes,
) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new ExternalPdfError(
        "La fuente ha declarado un tamaño de PDF no válido.",
      );
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared > maximum) {
      try {
        await response.body?.cancel();
      } catch {
        // The size failure is the useful error to report.
      }
      throw new ExternalPdfError(
        "El PDF de la fuente supera el límite seguro.",
      );
    }
  }

  if (!response.body) {
    throw new ExternalPdfError("La fuente ha devuelto un PDF vacío.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximum) {
        await cancelReader(reader);
        throw new ExternalPdfError(
          "El PDF de la fuente supera el límite seguro.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ExternalPdfError) throw error;
    await cancelReader(reader);
    throw new ExternalPdfError("El PDF de la fuente no se ha podido leer.");
  } finally {
    reader.releaseLock();
  }

  const payload = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (new TextDecoder("ascii").decode(payload.subarray(0, 5)) !== "%PDF-") {
    throw new ExternalPdfError("La fuente no ha devuelto un PDF válido.");
  }
  return payload;
}

/** Extracts only bounded text lines; images, annotations and attachments are ignored. */
export async function extractPdfText(pdf: Uint8Array) {
  try {
    // Loading PDF.js initializes native canvas polyfills in Node. Keep that
    // work out of the application startup path and only pay for it when the
    // MITECO PDF source is actually fetched.
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: pdf,
      disableFontFace: true,
      enableXfa: false,
      stopAtErrors: true,
      useSystemFonts: false,
      useWasm: false,
      verbosity: 0,
    });

    try {
      const document = await loadingTask.promise;
      if (
        document.numPages < 1 ||
        document.numPages > EXTERNAL_PDF_LIMITS.maxPages
      ) {
        throw new ExternalPdfError(
          "El PDF de la fuente tiene un número de páginas no permitido.",
        );
      }

      const pages: string[] = [];
      let characters = 0;
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const lines: string[] = [];
        let line = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          line += item.str;
          if (item.hasEOL) {
            const normalized = line.replace(/\s+/g, " ").trim();
            if (normalized) lines.push(normalized);
            line = "";
          } else if (item.str && !item.str.endsWith(" ")) {
            line += " ";
          }
        }
        const normalized = line.replace(/\s+/g, " ").trim();
        if (normalized) lines.push(normalized);
        const pageText = lines.join("\n");
        characters += pageText.length;
        if (characters > EXTERNAL_PDF_LIMITS.maxCharacters) {
          throw new ExternalPdfError(
            "El texto del PDF de la fuente supera el límite seguro.",
          );
        }
        pages.push(pageText);
      }
      return pages.join("\n");
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof ExternalPdfError) throw error;
    throw new ExternalPdfError(
      "El PDF de la fuente no se ha podido validar ni extraer.",
    );
  }
}
