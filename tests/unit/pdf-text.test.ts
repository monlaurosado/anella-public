import { describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({ moduleLoaded: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  pdfMocks.moduleLoaded();
  return { getDocument: vi.fn() };
});

import { ExternalPdfError, readBoundedPdfResponse } from "@/lib/pdf-text";

describe("readBoundedPdfResponse", () => {
  it("accepts a bounded response with a PDF signature", async () => {
    const payload = await readBoundedPdfResponse(
      new Response("%PDF-1.7\nfixture"),
      64,
    );

    expect(new TextDecoder().decode(payload)).toBe("%PDF-1.7\nfixture");
    expect(pdfMocks.moduleLoaded).not.toHaveBeenCalled();
  });

  it("rejects a declared or streamed payload above the limit", async () => {
    await expect(
      readBoundedPdfResponse(
        new Response("%PDF-1.7", {
          headers: { "content-length": "2048" },
        }),
        64,
      ),
    ).rejects.toBeInstanceOf(ExternalPdfError);

    await expect(
      readBoundedPdfResponse(new Response(`%PDF-${"x".repeat(128)}`), 32),
    ).rejects.toBeInstanceOf(ExternalPdfError);
  });

  it("rejects content without a PDF signature", async () => {
    await expect(
      readBoundedPdfResponse(new Response("not a pdf"), 64),
    ).rejects.toThrow(/PDF válido/);
  });
});
