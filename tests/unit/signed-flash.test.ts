import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readSignedFlash, signedFlashPath } from "@/lib/signed-flash";

describe("signed operational flash messages", () => {
  const now = 1_789_000_000_000;

  function queryFrom(path: string) {
    const url = new URL(path, "https://anella.test");
    return {
      notice: url.searchParams.get("notice") ?? undefined,
      error: url.searchParams.get("error") ?? undefined,
      flashAt: url.searchParams.get("flashAt") ?? undefined,
      flashSig: url.searchParams.get("flashSig") ?? undefined,
    };
  }

  it("accepts an unmodified, current message on its intended path", () => {
    const path = signedFlashPath(
      "/coordinacion/incidentes/incident-1?tab=needs&page=3",
      "notice",
      "Necesidad actualizada.",
      now,
    );
    expect(
      readSignedFlash(
        queryFrom(path),
        "/coordinacion/incidentes/incident-1",
        now + 1_000,
      ),
    ).toEqual({ notice: "Necesidad actualizada.", error: undefined });
  });

  it("rejects forged text, another path, ambiguous values and expiry", () => {
    const path = signedFlashPath(
      "/coordinacion/equipo",
      "error",
      "Cuenta no encontrada.",
      now,
    );
    const query = queryFrom(path);
    expect(
      readSignedFlash(
        { ...query, error: "Cuenta creada." },
        "/coordinacion/equipo",
        now,
      ),
    ).toEqual({ notice: undefined, error: undefined });
    expect(readSignedFlash(query, "/login", now)).toEqual({
      notice: undefined,
      error: undefined,
    });
    expect(
      readSignedFlash(
        { ...query, notice: "También éxito" },
        "/coordinacion/equipo",
        now,
      ),
    ).toEqual({ notice: undefined, error: undefined });
    expect(
      readSignedFlash(query, "/coordinacion/equipo", now + 5 * 60 * 1_000 + 1),
    ).toEqual({ notice: undefined, error: undefined });
  });
});
