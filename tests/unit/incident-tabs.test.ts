import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  IncidentTabs,
  parseIncidentTab,
} from "@/components/coordination/incident-tabs";

describe("incident detail tabs", () => {
  it("names the primary contribution section as aportaciones", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentTabs, {
        incidentId: "incident-1",
        activeTab: "contributions",
        needCount: 2,
        contributionCount: 3,
        safePointCount: 1,
        activityCount: 4,
      }),
    );

    expect(html).toContain("Aportaciones");
    expect(html).toContain(
      'href="/coordinacion/incidentes/incident-1?tab=contributions"',
    );
    expect(html).toMatch(
      /aria-current="page"[^>]*>[\s\S]*Aportaciones/,
    );
  });

  it("keeps parsing the stable contributions query value", () => {
    expect(parseIncidentTab("contributions")).toBe("contributions");
  });
});
