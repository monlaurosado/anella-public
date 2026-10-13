import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/map/effis/route";

function tileRequest(overrides: Record<string, string> = {}) {
  const year = new Date().getUTCFullYear();
  const params = new URLSearchParams({
    service: "WMS",
    request: "GetMap",
    layers: "modis.ba.poly",
    styles: "",
    format: "image/png",
    transparent: "true",
    version: "1.1.1",
    TIME: `${year}-01-01/${year}-12-31`,
    width: "256",
    height: "256",
    srs: "EPSG:3857",
    bbox: "-2504688.5,2504688.5,0,5009377.1",
    ...overrides,
  });
  return new Request(`http://localhost/api/map/effis?${params}`);
}

describe("EFFIS public map proxy", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies only the fixed EFFIS burned-area layer", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const response = await GET(tileRequest({ upstream: "https://evil.test" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-anella-map-layer")).toBe("effis");
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.origin).toBe(
      "https://maps.effis.emergency.copernicus.eu",
    );
    expect(requestedUrl.searchParams.get("layers")).toBe("modis.ba.poly");
    expect(requestedUrl.searchParams.has("upstream")).toBe(false);
  });

  it("rejects parameters outside the map tile allowlist", async () => {
    const response = await GET(tileRequest({ bbox: "1,2,3,999999999" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_EFFIS_TILE_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a cacheable transparent tile when EFFIS is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("upstream unavailable"));

    const response = await GET(tileRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-anella-map-layer")).toBe("fallback");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(60);
  });
});
