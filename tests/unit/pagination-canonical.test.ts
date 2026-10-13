import { describe, expect, it } from "vitest";

import { copySearchParams } from "@/components/coordination/queue-query";
import { canonicalPaginationHref } from "@/lib/pagination-canonical";

describe("coordination pagination canonical URLs", () => {
  it("does not redirect an available page", () => {
    const params = new URLSearchParams({ view: "active", page: "3" });

    expect(
      canonicalPaginationHref("/coordinacion/incidentes", params, [
        { parameter: "page", requestedPage: 3, pageCount: 3 },
      ]),
    ).toBeNull();
  });

  it("replaces an out-of-range page while preserving all filters", () => {
    const params = new URLSearchParams();
    params.set("view", "custom");
    params.append("status", "active");
    params.append("status", "monitoring");
    params.set("page", "999");
    params.set("pageSize", "50");

    expect(
      canonicalPaginationHref("/coordinacion/incidentes", params, [
        { parameter: "page", requestedPage: 999, pageCount: 4 },
      ]),
    ).toBe(
      "/coordinacion/incidentes?view=custom&status=active&status=monitoring&page=4&pageSize=50",
    );
  });

  it("canonicalizes every out-of-range directory in one team URL", () => {
    const params = new URLSearchParams({
      municipalityId: "municipality-1",
      municipalityQuery: "Vallès",
      municipalityPage: "8",
      organizationQuery: "Protecció",
      organizationPage: "12",
      page: "2",
    });

    expect(
      canonicalPaginationHref("/coordinacion/equipo", params, [
        { parameter: "page", requestedPage: 2, pageCount: 5 },
        {
          parameter: "municipalityPage",
          requestedPage: 8,
          pageCount: 3,
        },
        {
          parameter: "organizationPage",
          requestedPage: 12,
          pageCount: 2,
        },
      ]),
    ).toBe(
      "/coordinacion/equipo?municipalityId=municipality-1&municipalityQuery=Vall%C3%A8s&municipalityPage=3&organizationQuery=Protecci%C3%B3&organizationPage=2&page=2",
    );
  });

  it("drops signed flash data through the existing canonical query pattern", () => {
    const params = copySearchParams({
      municipalityId: "municipality-1",
      page: "50",
      pageSize: "25",
      notice: "mensaje firmado",
      flashAt: "123",
      flashSig: "secret",
    });

    expect(
      canonicalPaginationHref("/coordinacion/detecciones", params, [
        { parameter: "page", requestedPage: 50, pageCount: 2 },
      ]),
    ).toBe(
      "/coordinacion/detecciones?municipalityId=municipality-1&page=2&pageSize=25",
    );
  });
});
