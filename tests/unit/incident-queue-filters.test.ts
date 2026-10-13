import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IncidentQueueFilters } from "@/components/coordination/incident-queue-filters";
import {
  QUEUE_TEXT_FILTER_MAX_LENGTH,
  parseIncidentQueueQuery,
} from "@/components/coordination/queue-query";

function inputMarkup(html: string, name: string) {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
}

describe("incident queue filter form", () => {
  it("uses a progressive GET that always submits the custom view", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentQueueFilters, {
        state: parseIncidentQueueQuery({ view: "active" }).state,
      }),
    );

    expect(html).toMatch(
      /<form[^>]*action="\/coordinacion\/incidentes"[^>]*method="get"/,
    );
    expect(html).toContain('<input type="hidden" name="view" value="custom"/>');
  });

  it("exposes the parser limit on every free-text filter", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentQueueFilters, {
        state: parseIncidentQueueQuery({ view: "active" }).state,
      }),
    );

    for (const name of ["q", "municipality", "organization"]) {
      expect(inputMarkup(html, name)).toContain(
        `maxLength="${QUEUE_TEXT_FILTER_MAX_LENGTH}"`,
      );
    }
  });
});
