import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const pdfMocks = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
}));

vi.mock("@/lib/pdf-text", () => ({
  extractPdfText: pdfMocks.extractPdfText,
  readBoundedPdfResponse: vi.fn(
    async (response: Response) => new Uint8Array(await response.arrayBuffer()),
  ),
}));

import { fetchOfficialFireSource } from "@/services/fire-source-adapters";

const now = new Date("2026-07-14T16:00:00.000Z");

describe("official fire source adapters", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    pdfMocks.extractPdfText.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes the latest JCyL daily report without tactical resources", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 1,
            results: [{ latest_date: "2026-07-14T00:00:00+00:00" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 1,
            results: [
              {
                fecha_del_parte: "2026-07-14",
                hora_del_parte: "17:00",
                provincia: ["BURGOS"],
                termino_municipal: "OQUILLAS",
                nivel: "0",
                nivel_maximo_alcanzado: "1",
                fecha_de_inicio: "2026-07-14",
                hora_de_inicio: "16:38",
                situacion_actual: "CONTROLADO",
                fecha_extinguido: null,
                hora_extinguido: null,
                codigo_municipio_ine: "09239",
                posicion: { lon: -3.68289, lat: 41.8342 },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await fetchOfficialFireSource("JCYL", now);

    expect(result).toMatchObject({
      ok: true,
      sourceKey: "JCYL",
      received: 1,
      rejected: 0,
    });
    expect(result.detections[0]).toMatchObject({
      provider: "JCYL",
      providerStatus: "CONTROLLED",
      latitude: 41.8342,
      longitude: -3.68289,
      confidence: "official",
      mutable: true,
    });
    expect(result.detections[0]?.detectedAt.toISOString()).toBe(
      "2026-07-14T14:38:00.000Z",
    );
    expect(result.detections[0]?.rawJson).not.toHaveProperty(
      "medios_de_extincion",
    );
    const recordsUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(recordsUrl.searchParams.get("select")).not.toContain(
      "medios_de_extincion",
    );
  });

  it("normalizes INFOCA state while requesting only non-tactical fields", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          features: [
            {
              attributes: {
                OID_ENTERO: 1049,
                ESRI_OID: 1049,
                TERMINO_MUNICIPAL: "Rota",
                PROVINCIA: "CÁDIZ",
                TIPO_INCIDENTE: "IIFF INCENDIOS FORESTALES",
                ESTADO: "ACTIVO",
                FECHA: 1783987200000,
                HORA: "16:31:00",
              },
              geometry: { x: -6.322042, y: 36.701317 },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchOfficialFireSource("INFOCA", now);

    expect(result).toMatchObject({
      ok: true,
      sourceKey: "INFOCA",
      received: 1,
      rejected: 0,
    });
    expect(result.detections[0]).toMatchObject({
      provider: "INFOCA",
      providerStatus: "ACTIVE",
      latitude: 36.701317,
      longitude: -6.322042,
      mutable: true,
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("outFields")).toBe(
      "OID_ENTERO,ESRI_OID,TERMINO_MUNICIPAL,PROVINCIA,TIPO_INCIDENTE,ESTADO,FECHA,HORA",
    );
  });

  it("imports every public Bombers Catalunya vegetation alert without requesting tactical resources", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          exceededTransferLimit: false,
          features: [
            {
              attributes: {
                ACT_DAT_ACTUACIO: new Date(
                  "2026-07-14T15:04:00.000Z",
                ).getTime(),
                TAL_COD_ALARMA2: "VF",
                TAL_DESC_ALARMA2: "Incendi vegetació forestal",
                ACT_DAT_INICI: new Date("2026-07-14T15:05:00.000Z").getTime(),
                MUNICIPI_DPX: "Rubió",
                DATA_ACT: new Date("2026-07-14T15:31:00.000Z").getTime(),
                GlobalID: "c1e8915a-9f42-4b84-98be-5bb0a6342d8c",
                COM_FASE: "Estabilitzat",
                ACT_NUM_VEH: 18,
              },
              geometry: { x: 1.629583, y: 41.680449 },
            },
            {
              attributes: {
                ACT_DAT_ACTUACIO: new Date(
                  "2026-07-14T15:20:00.000Z",
                ).getTime(),
                TAL_COD_ALARMA2: "VA",
                TAL_DESC_ALARMA2: "Incendi vegetació agrícola",
                ACT_DAT_INICI: new Date("2026-07-14T15:21:00.000Z").getTime(),
                MUNICIPI_DPX: "Cabra del Camp",
                DATA_ACT: new Date("2026-07-14T15:24:00.000Z").getTime(),
                GlobalID: "2ddd104d-64e1-4e01-a851-311b879c0a49",
                COM_FASE: null,
              },
              geometry: { x: 1.272615, y: 41.39355 },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchOfficialFireSource("BOMBERS_CATALUNYA", now);

    expect(result).toMatchObject({
      ok: true,
      sourceKey: "BOMBERS_CATALUNYA",
      received: 2,
      rejected: 0,
    });
    expect(result.detections).toHaveLength(2);
    expect(result.detections[0]).toMatchObject({
      provider: "BOMBERS_CATALUNYA",
      providerStatus: "STABILIZED",
      latitude: 41.680449,
      longitude: 1.629583,
      confidence: "official",
      mutable: true,
      rawJson: {
        municipality: "Rubió",
        incidentType: "Incendi vegetació forestal",
        officialStatus: "Estabilitzat",
        sourceUpdatedAt: "2026-07-14T15:31:00.000Z",
      },
    });
    expect(result.detections[1]?.providerStatus).toBe("UNKNOWN");
    expect(JSON.stringify(result.detections)).not.toContain("ACT_NUM_VEH");

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("outFields")).toBe(
      "ACT_DAT_ACTUACIO,TAL_COD_ALARMA2,TAL_DESC_ALARMA2,ACT_DAT_INICI,MUNICIPI_DPX,DATA_ACT,GlobalID,COM_FASE",
    );
    expect(requestUrl.searchParams.get("outFields")).not.toContain(
      "ACT_NUM_VEH",
    );
    expect(requestUrl.searchParams.get("outSR")).toBe("4326");
  });

  it("normalizes the national MITECO report using only safe municipal data", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("%PDF-fake", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    pdfMocks.extractPdfText.mockResolvedValueOnce(`
      Última actualización: 10:26:15 del día 14/07/2026
      ARAGON
      ZARAGOZA
      Localización: ORÉS S.O: 2 Estado del Incendio: ACTIVO
      Medios asignados al incendio:
      1 ALFA de REUS (TARRAGONA)
      CASTILLA-LA MANCHA
      CIUDAD REAL
      Localización: HINOJOSAS DE CALATRAVA
      Medios asignados al incendio:
      Estado del Incendio: CONTROLADO S.O: SE
      1 BRIF-A de LUBIA (SORIA)
    `);

    const result = await fetchOfficialFireSource("MITECO_CCINIF", now, [
      {
        id: "es-50210",
        name: "Orés",
        province: "Zaragoza",
        region: "Aragón",
        latitude: 42.278,
        longitude: -1.001,
      },
      {
        id: "es-13048",
        name: "Hinojosas de Calatrava",
        province: "Ciudad Real",
        region: "Castilla-La Mancha",
        latitude: 38.615,
        longitude: -4.139,
      },
    ]);

    expect(result).toMatchObject({
      ok: true,
      sourceKey: "MITECO_CCINIF",
      received: 2,
      rejected: 0,
    });
    expect(result.detections).toHaveLength(2);
    expect(result.detections[0]).toMatchObject({
      provider: "MITECO_CCINIF",
      providerStatus: "ACTIVE",
      municipalityIdHint: "es-50210",
      latitude: 42.278,
      longitude: -1.001,
      mutable: true,
      rawJson: {
        municipality: "Orés",
        province: "Zaragoza",
        locationPrecision: "municipality-centroid",
        sourceUpdatedAt: "2026-07-14T08:26:00.000Z",
      },
    });
    expect(result.detections[1]?.providerStatus).toBe("CONTROLLED");
    const serialized = JSON.stringify(result.detections);
    expect(serialized).not.toMatch(/ALFA|BRIF|medios asignados|LUBIA/i);
  });
});
