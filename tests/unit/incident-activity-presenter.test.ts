import { describe, expect, it } from "vitest";

import {
  presentIncidentActivity,
  presentIncidentEntity,
} from "@/components/coordination/incident-activity-presenter";

const timeZone = "Europe/Madrid";

describe("incident activity presentation", () => {
  it("translates lifecycle events and enum transitions into operational Spanish", () => {
    const incident = presentIncidentActivity(
      "incident.status_changed",
      {
        from: "DRAFT",
        to: "ACTIVE",
        reason: "Validación municipal completada",
      },
      timeZone,
    );
    const need = presentIncidentActivity(
      "need.status_changed",
      { from: "ACTIVE", to: "COVERED", reason: "Cantidad cubierta" },
      timeZone,
    );

    expect(incident).toMatchObject({
      title: "Estado del incidente cambiado",
      summary: "Se cambió la fase operativa del incidente.",
      details: [
        { label: "Estado", value: "Borrador → Activo" },
        { label: "Motivo", value: "Validación municipal completada" },
      ],
    });
    expect(need.details[0]).toEqual({
      label: "Estado",
      value: "Activa → Cubierta",
    });
    expect(JSON.stringify([incident, need])).not.toMatch(
      /DRAFT|ACTIVE|COVERED/,
    );
  });

  it("summarizes incident edits without exposing private coordinates or arbitrary metadata", () => {
    const presentation = presentIncidentActivity(
      "incident.updated",
      {
        before: {
          title: "Título anterior",
          type: "WILDFIRE",
          priority: "HIGH",
          operationalLatitude: 41.40338,
          operationalLongitude: 2.17403,
          radiusMeters: 1500,
        },
        after: {
          title: "Título nuevo",
          type: "FLOOD",
          priority: "CRITICAL",
          operationalLatitude: 41.4,
          operationalLongitude: 2.17,
          radiusMeters: 2500,
        },
        reason: "Revisión de la ficha",
        rawJson: { phone: "+34600000000", tacticalRoute: "ruta privada" },
        passwordHash: "hash-no-publicable",
      },
      timeZone,
    );
    const serialized = JSON.stringify(presentation);

    expect(presentation.details).toEqual(
      expect.arrayContaining([
        {
          label: "Tipo",
          value: "Incendio forestal → Inundación",
        },
        { label: "Prioridad", value: "Alta → Crítica" },
        {
          label: "Datos operativos privados",
          value: expect.stringContaining("valores reservados"),
        },
      ]),
    );
    expect(serialized).not.toMatch(
      /41\.40338|2\.17403|41\.4|2\.17|Título anterior|Título nuevo|WILDFIRE|FLOOD|HIGH|CRITICAL|\+34600000000|ruta privada|hash-no-publicable|rawJson|passwordHash/,
    );
  });

  it("presents contribution progress without internal identifiers or English statuses", () => {
    const presentation = presentIncidentActivity(
      "contribution.status_changed",
      {
        from: "EN_ROUTE",
        to: "PARTIALLY_DELIVERED",
        deliveredBefore: 0,
        deliveredAfter: 4,
        needStatus: "ACTIVE",
        revisionBefore: 7,
        needId: "need-private-id",
        safePointId: "point-private-id",
        reason: "Recepción parcial verificada",
      },
      timeZone,
    );
    const serialized = JSON.stringify(presentation);

    expect(presentation.details).toEqual(
      expect.arrayContaining([
        {
          label: "Estado de la aportación",
          value: "En camino → Entrega parcial",
        },
        { label: "Cantidad recibida", value: "0 → 4" },
        {
          label: "Estado resultante de la necesidad",
          value: "Activa",
        },
      ]),
    );
    expect(serialized).not.toMatch(
      /EN_ROUTE|PARTIALLY_DELIVERED|ACTIVE|revisionBefore|need-private-id|point-private-id/,
    );
  });

  it("uses exact Spanish titles for current and legacy audit action names", () => {
    const actions = [
      "incident.created_from_detection",
      "safe_point.created_and_validated",
      "safe_point.validated",
      "safe_point.reactivated_and_validated",
      "safe_point.updated_and_revalidated",
      "contribution.pledged_by_citizen",
      "CONTRIBUTION_CANCELLED_BY_CITIZEN",
      "external_detection.linked",
      "SIMULATION_CONTRIBUTION_STATE_SEEDED",
    ];

    for (const action of actions) {
      const presentation = presentIncidentActivity(action, {}, timeZone);
      expect(presentation.title).not.toBe("Actividad registrada");
      expect(presentation.title).not.toContain(action);
      expect(presentation.title).not.toContain("_");
    }
  });

  it("fails closed for unknown actions, entities and metadata", () => {
    const presentation = presentIncidentActivity(
      "future.private_tactical_event",
      {
        status: "ACTIVE",
        operationalLatitude: 41.5,
        operationalLongitude: 2.2,
        internalId: "private-id",
        nested: { secret: "do-not-render" },
      },
      timeZone,
    );
    const serialized = JSON.stringify(presentation);

    expect(presentation).toEqual({
      title: "Actividad registrada",
      summary:
        "Se registró una operación auditada. Sus metadatos técnicos no se muestran porque no tienen una presentación segura definida.",
      details: [],
    });
    expect(presentIncidentEntity("UnknownInternalRecord")).toBe(
      "Elemento operativo",
    );
    expect(serialized).not.toMatch(
      /future\.private|ACTIVE|41\.5|2\.2|private-id|do-not-render/,
    );
  });
});
