import { describe, expect, it } from "vitest";

import {
  FirmsPayloadLimitError,
  firmsDetectionDate,
  firmsExternalId,
  parseFirmsCsv,
  readFirmsCsvResponse,
} from "@/lib/firms";

const csv = `latitude,longitude,bright_ti4,acq_date,acq_time,satellite,instrument,confidence,frp,daynight
41.6082,2.2864,341.2,2026-07-09,1840,N20,VIIRS,n,8.4,N
999,2.0000,320.0,2026-07-09,1900,N20,VIIRS,l,1.0,D`;

describe("NASA FIRMS parsing", () => {
  it("validates rows and reports rejected records", () => {
    const result = parseFirmsCsv(csv);

    expect(result.detections).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.detections[0]?.latitude).toBe(41.6082);
  });

  it("builds a UTC timestamp and stable external id", () => {
    const detection = parseFirmsCsv(csv).detections[0]!;

    expect(firmsDetectionDate(detection).toISOString()).toBe(
      "2026-07-09T18:40:00.000Z",
    );
    expect(firmsExternalId(detection, "VIIRS_SNPP_NRT")).toBe(
      firmsExternalId(detection, "VIIRS_SNPP_NRT"),
    );
  });

  it("reads a chunked response without using response.text", async () => {
    const encoder = new TextEncoder();
    const chunks = [csv.slice(0, 37), csv.slice(37, 103), csv.slice(103)];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
    );

    const payload = await readFirmsCsvResponse(response, {
      maxBytes: 10_000,
      maxRows: 10,
    });

    expect(payload).toBe(csv);
    expect(parseFirmsCsv(payload, { maxRows: 10 }).detections).toHaveLength(1);
  });

  it("cancels the stream and rejects the whole response when bytes exceed the limit", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("123456"));
          controller.enqueue(encoder.encode("789"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(
      readFirmsCsvResponse(response, { maxBytes: 8, maxRows: 10 }),
    ).rejects.toMatchObject({
      limit: "bytes",
      maximum: 8,
    } satisfies Partial<FirmsPayloadLimitError>);
    expect(cancelled).toBe(true);
  });

  it("rejects excess rows even when the last row has no trailing newline", async () => {
    const twoRows = [
      "latitude,longitude,acq_date",
      "41.1,2.1,2026-07-09",
      "41.2,2.2,2026-07-09",
    ].join("\n");
    const payload = await readFirmsCsvResponse(new Response(twoRows), {
      maxBytes: 10_000,
      maxRows: 1,
    });

    expect(() => parseFirmsCsv(payload, { maxRows: 1 })).toThrowError(
      expect.objectContaining({ limit: "rows", maximum: 1 }),
    );
  });

  it("stops the response stream as soon as the row limit is exceeded", async () => {
    const payload = [
      "latitude,longitude,acq_date",
      "41.1,2.1,2026-07-09",
      "41.2,2.2,2026-07-09",
      "",
    ].join("\r\n");

    await expect(
      readFirmsCsvResponse(new Response(payload), {
        maxBytes: 10_000,
        maxRows: 1,
      }),
    ).rejects.toMatchObject({ limit: "rows", maximum: 1 });
  });
});
