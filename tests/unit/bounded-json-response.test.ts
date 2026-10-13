import { describe, expect, it } from "vitest";

import {
  ExternalJsonResponseError,
  readBoundedJsonResponse,
} from "@/lib/bounded-json-response";

describe("bounded upstream JSON responses", () => {
  it("parses a valid bounded JSON response", async () => {
    await expect(
      readBoundedJsonResponse(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("stops a chunked response once it exceeds the byte limit", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":"'));
          controller.enqueue(new TextEncoder().encode("x".repeat(100)));
          controller.close();
        },
      }),
    );

    await expect(readBoundedJsonResponse(response, 32)).rejects.toThrow(
      ExternalJsonResponseError,
    );
  });

  it("rejects malformed JSON", async () => {
    await expect(
      readBoundedJsonResponse(new Response("{not-json")),
    ).rejects.toThrow(/JSON válido/);
  });
});
