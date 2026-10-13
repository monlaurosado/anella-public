import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublicIncidentView } from "@/components/incidents/public-incident-view";
import { UrgentNeedsList } from "@/components/incidents/urgent-needs-list";
import type { Incident } from "@/types/domain";

const incident: Incident = {
  id: "incident-public-view",
  publicCode: "AN-PUBLIC",
  title: "Incendio forestal verificado",
  type: "wildfire",
  status: "active",
  priority: "critical",
  municipality: {
    id: "municipality-1",
    name: "Municipio seguro",
    province: "Barcelona",
  },
  responsibleOrgName: "Protección Civil municipal",
  publicSummary: "Resumen público validado para ciudadanía.",
  safetyNotice: "No te acerques a la zona afectada.",
  publicArea: {
    mode: "safe_points_only",
    label: "Solo puntos seguros validados",
  },
  timeZone: "Europe/Madrid",
  updatedAt: "2026-07-13T12:00:00.000Z",
  safePoints: [
    {
      id: "safe-point-1",
      incidentId: "incident-public-view",
      name: "Centro cívico seguro",
      address: "Carrer Major, 1",
      instructions: "Accede únicamente por la entrada principal.",
      coordinates: { lat: 41.4, lng: 2.1 },
      radiusMeters: 30,
      capacityNote: "Recepción abierta",
      isActive: true,
      pointType: "drop_off",
      status: "active",
    },
  ],
  needs: [
    {
      id: "need-water",
      incidentId: "incident-public-view",
      safePointId: "safe-point-1",
      type: "water",
      title: "Agua potable",
      description: "Botellas cerradas y sin abrir.",
      priority: "high",
      quantityNeeded: 20,
      quantityReceived: 5,
      quantityCommitted: 3,
      quantityEnRoute: 2,
      unit: "cajas",
      deadline: "2026-07-14T16:00:00.000Z",
      timeZone: "Europe/Madrid",
      status: "active",
      operationalStatus: "open",
      updatedAt: "2026-07-13T12:00:00.000Z",
    },
    {
      id: "need-blankets",
      incidentId: "incident-public-view",
      safePointId: "safe-point-1",
      type: "shelter",
      title: "Mantas térmicas",
      description: "Mantas limpias y embaladas.",
      priority: "high",
      quantityNeeded: 15,
      quantityReceived: 2,
      quantityCommitted: 0,
      quantityEnRoute: 0,
      unit: "uds",
      deadline: "2026-07-14T18:00:00.000Z",
      timeZone: "Europe/Madrid",
      status: "active",
      operationalStatus: "open",
      updatedAt: "2026-07-13T12:00:00.000Z",
    },
    {
      id: "need-food",
      incidentId: "incident-public-view",
      safePointId: "safe-point-1",
      type: "food",
      title: "Alimentos cubiertos",
      priority: "medium",
      quantityNeeded: 10,
      quantityReceived: 10,
      quantityCommitted: 0,
      quantityEnRoute: 0,
      unit: "cajas",
      timeZone: "Europe/Madrid",
      status: "covered",
      operationalStatus: "covered",
      updatedAt: "2026-07-13T12:00:00.000Z",
    },
  ],
  notices: [],
};

function renderPublicView(initialSelectedPointId?: string) {
  return renderToStaticMarkup(
    createElement(PublicIncidentView, {
      incident,
      initialSelectedPointId,
      mode: "public",
      contributionActions: {
        "safe-point-1": createElement(
          "form",
          { "data-live-contribution": "safe-point-1" },
          "Formulario ciudadano real",
        ),
      },
    }),
  );
}

function renderPreview() {
  return renderToStaticMarkup(
    createElement(PublicIncidentView, { incident, mode: "preview" }),
  );
}

describe("shared public incident presenter", () => {
  it("renders the same public DTO and sections in public and preview modes", () => {
    const publicHtml = renderPublicView();
    const previewHtml = renderPreview();
    const sharedContent = [
      "Peligro inmediato: llama al 112.",
      incident.title,
      incident.publicSummary,
      incident.safetyNotice,
      "Agua potable",
      "Mantas térmicas",
      "Alimentos cubiertos",
      "Centro cívico seguro",
      "Carrer Major, 1",
      "Accede únicamente por la entrada principal.",
    ];

    for (const content of sharedContent) {
      expect(publicHtml).toContain(content);
      expect(previewHtml).toContain(content);
    }
    for (const section of [
      "emergency",
      "summary",
      "drop-off-points",
      "needs",
    ]) {
      expect(publicHtml).toContain(`data-public-section="${section}"`);
      expect(previewHtml).toContain(`data-public-section="${section}"`);
    }

    expect(publicHtml).toContain('data-public-incident-view="public"');
    expect(previewHtml).toContain('data-public-incident-view="preview"');
    expect(publicHtml).toMatch(/<h1[^>]*>Incendio forestal verificado<\/h1>/);
    expect(previewHtml).toMatch(/<h3[^>]*>Incendio forestal verificado<\/h3>/);
    expect(previewHtml).toMatch(/<h4[^>]*>Puntos de entrega habilitados<\/h4>/);
    expect(previewHtml).toMatch(/<h5[^>]*>Centro cívico seguro<\/h5>/);
  });

  it("keeps the preview visibly isolated and unable to submit citizen mutations", () => {
    const publicHtml = renderPublicView();
    const previewHtml = renderPreview();

    expect(publicHtml).toContain('data-live-contribution="safe-point-1"');
    expect(publicHtml).toContain("Formulario ciudadano real");
    expect(previewHtml).not.toContain("data-live-contribution");
    expect(previewHtml).not.toContain("<form");
    expect(previewHtml).toContain("Modo vista previa.");
    expect(previewHtml).toContain("data-preview-inert-action");
    expect(previewHtml).toContain("Voy a aportar · Desactivado");
    expect(previewHtml).toContain('disabled=""');
  });

  it("renders one selected contribution flow even when several needs are open", () => {
    const publicHtml = renderPublicView();
    const previewHtml = renderPreview();

    expect(publicHtml.match(/<form/g) ?? []).toHaveLength(1);
    expect(publicHtml).toContain('data-live-contribution="safe-point-1"');
    expect(publicHtml.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
    expect(publicHtml.match(/aria-pressed="false"/g) ?? []).toHaveLength(0);
    expect(publicHtml).toContain("Elige un punto de entrega");
    expect(previewHtml.match(/data-preview-inert-action/g) ?? []).toHaveLength(
      1,
    );
    expect(previewHtml).not.toContain("<form");
  });

  it("server-renders a requested point before hydration", () => {
    const publicHtml = renderPublicView("safe-point-1");

    expect(publicHtml.match(/<form/g) ?? []).toHaveLength(1);
    expect(publicHtml).toContain('data-live-contribution="safe-point-1"');
  });

  it("falls back to the first active point for an unavailable deep link", () => {
    const publicHtml = renderPublicView("missing-point");

    expect(publicHtml).toContain('data-live-contribution="safe-point-1"');
  });

  it("exposes verified open needs in the public rail with a direct offer action", () => {
    const html = renderToStaticMarkup(
      createElement(UrgentNeedsList, { incidents: [incident] }),
    );

    expect(html).toContain("Necesidades verificadas");
    expect(html).toContain("Agua potable");
    expect(html).toContain("Mantas térmicas");
    expect(html).not.toContain("Alimentos cubiertos");
    expect(html.match(/Lo ofrezco/g) ?? []).toHaveLength(2);
    expect(html).toContain("necesidad=need-water");
    expect(html).toContain("punto=safe-point-1");
  });
});
