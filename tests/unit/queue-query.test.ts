import { describe, expect, it } from "vitest";

import {
  QUEUE_TEXT_FILTER_MAX_LENGTH,
  parseContributionQueueQuery,
  parseIncidentQueueQuery,
} from "@/components/coordination/queue-query";

describe("incident queue query contract", () => {
  it.each([
    ["validation", ["pending_validation"], undefined],
    ["active", ["active"], undefined],
    ["help", ["active", "monitoring"], true],
    ["monitoring", ["monitoring"], undefined],
    ["closed", ["resolved", "cancelled"], undefined],
    ["all", undefined, undefined],
  ] as const)(
    "maps the %s saved view to explicit filters",
    (view, statuses, hasPendingNeeds) => {
      const parsed = parseIncidentQueueQuery({ view });

      expect(parsed.state.view).toBe(view);
      expect(parsed.filters.statuses).toEqual(statuses);
      expect(parsed.filters.hasPendingNeeds).toBe(hasPendingNeeds);
    },
  );

  it("keeps valid custom search, filters, ordering and pagination", () => {
    const parsed = parseIncidentQueueQuery({
      q: "  AN-2026  ",
      status: "operational",
      type: "flood",
      priority: "critical",
      municipality: "Vic",
      organization: "Protección Civil",
      createdFrom: "2026-07-01",
      createdTo: "2026-07-13",
      pending: "1",
      sort: "created",
      direction: "asc",
      page: "3",
      pageSize: "50",
    });

    expect(parsed.state.view).toBe("custom");
    expect(parsed.filters).toEqual({
      query: "AN-2026",
      statuses: ["draft", "pending_validation", "active", "monitoring"],
      types: ["flood"],
      priorities: ["critical"],
      municipality: "Vic",
      organization: "Protección Civil",
      createdFrom: "2026-07-01",
      createdTo: "2026-07-13",
      hasPendingNeeds: true,
      sort: "created",
      direction: "asc",
      page: 3,
      pageSize: 50,
    });
  });

  it("falls back safely for invalid enum values and oversized pages", () => {
    const parsed = parseIncidentQueueQuery({
      view: "unknown",
      status: "secret",
      type: "fire",
      priority: "urgent",
      sort: "random",
      page: "-4",
      pageSize: "10000",
    });

    expect(parsed.state.view).toBe("custom");
    expect(parsed.filters).toMatchObject({
      statuses: undefined,
      types: undefined,
      priorities: undefined,
      sort: "activity",
      direction: "desc",
      page: 1,
      pageSize: 25,
    });
  });

  it("rejects page numbers that exceed the six-digit operational bound", () => {
    const incident = parseIncidentQueueQuery({ page: "1000000" });
    const contribution = parseContributionQueueQuery({
      page: "999999999999999999999999",
    });

    expect(incident.filters.page).toBe(1);
    expect(contribution.filters.page).toBe(1);
  });

  it("caps free-text incident filters at the shared HTML limit", () => {
    const oversized = `  ${"x".repeat(QUEUE_TEXT_FILTER_MAX_LENGTH + 20)}  `;
    const parsed = parseIncidentQueueQuery({
      q: oversized,
      municipality: oversized,
      organization: oversized,
    });

    expect(parsed.state.query).toHaveLength(QUEUE_TEXT_FILTER_MAX_LENGTH);
    expect(parsed.state.municipality).toHaveLength(
      QUEUE_TEXT_FILTER_MAX_LENGTH,
    );
    expect(parsed.state.organization).toHaveLength(
      QUEUE_TEXT_FILTER_MAX_LENGTH,
    );
  });
});

describe("contribution queue query contract", () => {
  it.each([
    ["open", ["pledged", "en_route", "partially_delivered"]],
    ["delivered", ["delivered"]],
    ["exceptions", ["cancelled", "no_show"]],
  ] as const)("maps the %s view to exact statuses", (view, statuses) => {
    const parsed = parseContributionQueueQuery({ view });

    expect(parsed.state.view).toBe(view);
    expect(parsed.filters.statuses).toEqual(statuses);
  });

  it("supports each operational contribution status and real pagination", () => {
    const parsed = parseContributionQueueQuery({
      status: "partially_delivered",
      q: "AN-42",
      incident: "Vic",
      safePoint: "Pabellón",
      page: "4",
      pageSize: "100",
    });

    expect(parsed.state.view).toBe("custom");
    expect(parsed.filters).toEqual({
      query: "AN-42",
      statuses: ["partially_delivered"],
      incidentQuery: "Vic",
      safePointQuery: "Pabellón",
      page: 4,
      pageSize: 100,
    });
  });

  it("keeps exact-id deep links without preloading global filter options", () => {
    const parsed = parseContributionQueueQuery({
      incidentId: "incident-1",
      safePointId: "point-1",
    });

    expect(parsed.filters).toMatchObject({
      incidentId: "incident-1",
      safePointId: "point-1",
    });
  });

  it("caps free-text contribution filters at the shared HTML limit", () => {
    const oversized = `  ${"x".repeat(QUEUE_TEXT_FILTER_MAX_LENGTH + 20)}  `;
    const parsed = parseContributionQueueQuery({
      q: oversized,
      incident: oversized,
      safePoint: oversized,
    });

    expect(parsed.state.query).toHaveLength(QUEUE_TEXT_FILTER_MAX_LENGTH);
    expect(parsed.state.incident).toHaveLength(QUEUE_TEXT_FILTER_MAX_LENGTH);
    expect(parsed.state.safePoint).toHaveLength(QUEUE_TEXT_FILTER_MAX_LENGTH);
  });
});
