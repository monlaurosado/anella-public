const EFFIS_WMS_URL = "https://maps.effis.emergency.copernicus.eu/effis";
const EFFIS_LAYER = "modis.ba.poly";
const MAX_TILE_BYTES = 2 * 1024 * 1024;
const MAX_WEB_MERCATOR_COORDINATE = 21_000_000;
const TRANSPARENT_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  218, 99, 100, 248, 207, 240, 31, 0, 5, 254, 2, 254, 95, 135, 62, 89, 0, 0, 0,
  0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

type EffisTileRequest = {
  bbox: string;
  width: string;
  height: string;
  time: string;
};

function expectedTimeRange() {
  const year = new Date().getUTCFullYear();
  return `${year}-01-01/${year}-12-31`;
}

function boundedDimension(value: string | null) {
  if (!value || !/^\d{1,3}$/.test(value)) return false;
  const dimension = Number(value);
  return dimension >= 1 && dimension <= 512;
}

function validBbox(value: string | null) {
  if (!value || value.length > 200) return false;
  const coordinates = value.split(",").map(Number);
  return (
    coordinates.length === 4 &&
    coordinates.every(
      (coordinate) =>
        Number.isFinite(coordinate) &&
        Math.abs(coordinate) <= MAX_WEB_MERCATOR_COORDINATE,
    ) &&
    coordinates[0]! < coordinates[2]! &&
    coordinates[1]! < coordinates[3]!
  );
}

function parseTileRequest(url: URL): EffisTileRequest | null {
  const params = url.searchParams;
  const bbox = params.get("bbox");
  const width = params.get("width");
  const height = params.get("height");
  const time = params.get("TIME");
  if (
    params.get("service")?.toUpperCase() !== "WMS" ||
    params.get("request")?.toUpperCase() !== "GETMAP" ||
    params.get("layers") !== EFFIS_LAYER ||
    params.get("version") !== "1.1.1" ||
    params.get("format") !== "image/png" ||
    params.get("transparent")?.toLowerCase() !== "true" ||
    params.get("srs")?.toUpperCase() !== "EPSG:3857" ||
    (params.get("styles") ?? "") !== "" ||
    !validBbox(bbox) ||
    !boundedDimension(width) ||
    !boundedDimension(height) ||
    time !== expectedTimeRange()
  ) {
    return null;
  }
  return { bbox: bbox!, width: width!, height: height!, time: time! };
}

function imageHeaders(cacheControl: string, result: "effis" | "fallback") {
  return {
    "Cache-Control": cacheControl,
    "Content-Type": "image/png",
    "X-Anella-Map-Layer": result,
    "X-Content-Type-Options": "nosniff",
  };
}

function transparentTile() {
  return new Response(TRANSPARENT_PNG, {
    status: 200,
    headers: imageHeaders(
      "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      "fallback",
    ),
  });
}

export async function GET(request: Request) {
  const tile = parseTileRequest(new URL(request.url));
  if (!tile) {
    return Response.json(
      { error: "INVALID_EFFIS_TILE_REQUEST" },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const upstreamUrl = new URL(EFFIS_WMS_URL);
  upstreamUrl.searchParams.set("service", "WMS");
  upstreamUrl.searchParams.set("request", "GetMap");
  upstreamUrl.searchParams.set("layers", EFFIS_LAYER);
  upstreamUrl.searchParams.set("styles", "");
  upstreamUrl.searchParams.set("format", "image/png");
  upstreamUrl.searchParams.set("transparent", "true");
  upstreamUrl.searchParams.set("version", "1.1.1");
  upstreamUrl.searchParams.set("TIME", tile.time);
  upstreamUrl.searchParams.set("width", tile.width);
  upstreamUrl.searchParams.set("height", tile.height);
  upstreamUrl.searchParams.set("srs", "EPSG:3857");
  upstreamUrl.searchParams.set("bbox", tile.bbox);

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "force-cache",
      headers: {
        Accept: "image/png",
        "User-Agent": "Anella/1.0 public-map",
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(15_000),
    });
    const contentLength = Number(upstream.headers.get("content-length") ?? "0");
    if (
      !upstream.ok ||
      !upstream.headers.get("content-type")?.startsWith("image/png") ||
      (contentLength > 0 && contentLength > MAX_TILE_BYTES)
    ) {
      return transparentTile();
    }
    const image = await upstream.arrayBuffer();
    if (image.byteLength === 0 || image.byteLength > MAX_TILE_BYTES) {
      return transparentTile();
    }
    return new Response(image, {
      status: 200,
      headers: imageHeaders(
        "public, max-age=300, s-maxage=900, stale-while-revalidate=86400",
        "effis",
      ),
    });
  } catch {
    return transparentTile();
  }
}
