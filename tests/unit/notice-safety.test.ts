import { describe, expect, it } from "vitest";

import { publicIncidentNoticeSchema } from "@/lib/public-notice-safety";

function validate(body: string, safetyConfirmed = true) {
  return publicIncidentNoticeSchema.safeParse({
    incidentId: "incident-test",
    title: "Aviso público TEST",
    body,
    safetyConfirmed,
  });
}

describe("public notice safety boundary", () => {
  it("requires an explicit human public-safety review", () => {
    const parsed = validate(
      "El punto de entrega permanecerá cerrado hasta nuevo aviso oficial.",
      false,
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(
        /Confirma la revisión del contenido público/,
      );
    }
  });

  it("rejects precise coordinates and tactical response positions", () => {
    for (const body of [
      "Equipos situados en 41.38740, 2.16860 hasta nuevo aviso.",
      "La posición de bomberos se encuentra junto al acceso norte.",
    ]) {
      const parsed = validate(body);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toMatch(
          /coordenadas precisas|información operativa/,
        );
      }
    }
  });

  it("accepts non-tactical public guidance after review", () => {
    expect(
      validate(
        "El punto de entrega permanecerá cerrado. No lleves material hasta que una entidad publique su reapertura.",
      ).success,
    ).toBe(true);
  });
});
