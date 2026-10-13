import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ContributionQueueFilters } from "@/components/coordination/contribution-queue-filters";
import {
  QUEUE_TEXT_FILTER_MAX_LENGTH,
  parseContributionQueueQuery,
} from "@/components/coordination/queue-query";

function inputMarkup(html: string, name: string) {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
}

describe("contribution queue filter form", () => {
  it("exposes the parser limit on every free-text filter", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionQueueFilters, {
        state: parseContributionQueueQuery({ view: "open" }).state,
      }),
    );

    for (const name of ["q", "incident", "safePoint", "municipality"]) {
      expect(inputMarkup(html, name)).toContain(
        `maxLength="${QUEUE_TEXT_FILTER_MAX_LENGTH}"`,
      );
    }
  });

  it("parses category, ETA, municipality and bounded date filters", () => {
    const parsed = parseContributionQueueQuery({
      category: "water",
      eta: "due_soon",
      municipality: "  Madrid  ",
      createdFrom: "2026-07-01",
      createdTo: "2026-07-16",
      view: "custom",
    });

    expect(parsed.state).toMatchObject({
      category: "water",
      eta: "due_soon",
      municipality: "Madrid",
      createdFrom: "2026-07-01",
      createdTo: "2026-07-16",
    });
    expect(parsed.filters).toMatchObject({
      category: "water",
      eta: "due_soon",
      municipality: "Madrid",
      createdFrom: "2026-07-01",
      createdTo: "2026-07-16",
    });
  });

  it("drops unknown enum filters instead of widening the database query", () => {
    const parsed = parseContributionQueueQuery({
      category: "explosives",
      eta: "whenever",
    });

    expect(parsed.state.category).toBe("");
    expect(parsed.state.eta).toBe("");
    expect(parsed.filters.category).toBeUndefined();
    expect(parsed.filters.eta).toBeUndefined();
  });
});
