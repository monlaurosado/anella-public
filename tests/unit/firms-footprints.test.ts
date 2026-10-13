import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import {
  detectionWithinBounds,
  FirmsKmzError,
  parseFirmsFootprintsKmz,
  readFirmsKmzResponse,
} from "@/lib/firms-footprints";

function kmzWithPlacemark(overrides = "") {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml><Document><Placemark>
  <name> Fire Detection Footprint </name>
  <description><![CDATA[
    <b>Latitude: </b> 41.65000<br/>
    <b>Longitude: </b> 1.55000<br/>
    <b>Detection Time: </b> 2026-07-14 12:49 UTC<br/>
    <b>Sensor: </b> NOAA-21 VIIRS<br/>
    <b>Confidence: </b> Nominal<br/>
    <b>Day/Night: </b> Day<br/>
    <b>Scan: </b> 0.4 km<br/>
    <b>Track: </b> 0.44 km<br/>
    <b>FRP: </b> 8.29 MW<br/>
    <b>Brightness: </b> 345.65 K
  ]]></description>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>
    1.5475,41.6518,0 1.5525,41.6518,0 1.5525,41.6482,0
    1.5475,41.6482,0 1.5475,41.6518,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>${overrides}</Document></kml>`;
  return zipSync({ "fire.kml": strToU8(kml) });
}

function modisKmz() {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml><Document><Placemark>
  <name> Fire Detection Footprint </name>
  <description><![CDATA[
    <b>Latitude: </b> 40.41000<br/>
    <b>Longitude: </b> -3.71000<br/>
    <b>Detection Time: </b> 2026-07-14 13:29 UTC<br/>
    <b>Sensor: </b> Aqua MODIS<br/>
    <b>Confidence [0-100%]: </b> 65%<br/>
    <b>Day/Night: </b> Day<br/>
    <b>Scan: </b> 1.02 km<br/>
    <b>Track: </b> 1.01 km<br/>
    <b>FRP: </b> 7.58 MW<br/>
    <b>Brightness: </b> 315.81 K
  ]]></description>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>
    -3.715,40.415,0 -3.705,40.415,0 -3.705,40.405,0
    -3.715,40.405,0 -3.715,40.415,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark></Document></kml>`;
  return zipSync({ "modis.kml": strToU8(kml) });
}

describe("NASA FIRMS KMZ footprints", () => {
  it("parses the official footprint fields and bounded polygon", () => {
    const parsed = parseFirmsFootprintsKmz(kmzWithPlacemark());

    expect(parsed.rejected).toBe(0);
    expect(parsed.detections).toHaveLength(1);
    expect(parsed.detections[0]).toMatchObject({
      latitude: 41.65,
      longitude: 1.55,
      satellite: "NOAA-21",
      instrument: "VIIRS",
      confidence: "Nominal",
      fireRadiativePowerMw: 8.29,
      brightness: 345.65,
      footprint: { type: "Polygon" },
    });
    expect(parsed.detections[0]?.footprintAreaHectares).toBeGreaterThan(10);
    expect(parsed.detections[0]?.footprintRadiusMeters).toBeGreaterThan(150);
  });

  it("filters a detection against the configured operational bounds", () => {
    const detection = parseFirmsFootprintsKmz(kmzWithPlacemark()).detections[0];
    expect(detection).toBeDefined();
    expect(
      detectionWithinBounds(detection!, {
        west: -0.5,
        south: 40.4,
        east: 3.4,
        north: 42.9,
      }),
    ).toBe(true);
    expect(
      detectionWithinBounds(detection!, {
        west: -10,
        south: 35,
        east: -5,
        north: 40,
      }),
    ).toBe(false);
  });

  it("parses the official MODIS confidence label and sensor identity", () => {
    const parsed = parseFirmsFootprintsKmz(modisKmz());

    expect(parsed.rejected).toBe(0);
    expect(parsed.detections[0]).toMatchObject({
      satellite: "Aqua",
      instrument: "MODIS",
      confidence: "65%",
      fireRadiativePowerMw: 7.58,
    });
  });

  it("rejects an ambiguous archive containing more than one KML", () => {
    const kmz = zipSync({
      "one.kml": strToU8("<kml />"),
      "two.kml": strToU8("<kml />"),
    });
    expect(() => parseFirmsFootprintsKmz(kmz)).toThrow(FirmsKmzError);
  });

  it("rejects a response whose declared compressed size exceeds the limit", async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: { "content-length": "101" },
    });
    await expect(readFirmsKmzResponse(response, 100)).rejects.toThrow(
      /demasiado grande/,
    );
  });
});
