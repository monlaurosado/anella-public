import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pledgeContribution: vi.fn(),
  redirect: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  RedirectType: { replace: "replace" },
}));
vi.mock("@/services/pledge-contribution", () => ({
  pledgeContribution: mocks.pledgeContribution,
}));

import { submitContribution } from "@/actions/contributions";
import { PUBLIC_INCIDENTS_CACHE_TAG } from "@/config/cache";

describe("citizen contribution Server Action", () => {
  beforeEach(() => {
    mocks.pledgeContribution.mockReset();
    mocks.redirect.mockReset();
    mocks.updateTag.mockReset();
  });

  it("returns a business error inline without redirecting", async () => {
    mocks.pledgeContribution.mockResolvedValue({
      ok: false,
      message: "Esta necesidad ya no admite aportaciones.",
    });

    await expect(
      submitContribution({ ok: false, message: "" }, new FormData()),
    ).resolves.toEqual({
      ok: false,
      message: "Esta necesidad ya no admite aportaciones.",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("redirects a success with replace and never puts the token in the URL", async () => {
    const redirectSignal = new Error("NEXT_REDIRECT");
    mocks.pledgeContribution.mockResolvedValue({
      ok: true,
      message: "Aportación registrada.",
      publicCode: "AN-0123456789",
      cancelToken: "private-primary-token-that-must-not-be-serialized",
    });
    mocks.redirect.mockImplementation(() => {
      throw redirectSignal;
    });

    await expect(
      submitContribution({ ok: false, message: "" }, new FormData()),
    ).rejects.toBe(redirectSignal);
    expect(mocks.updateTag).toHaveBeenCalledTimes(1);
    expect(mocks.updateTag).toHaveBeenCalledWith(PUBLIC_INCIDENTS_CACHE_TAG);
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/aportaciones/AN-0123456789",
      "replace",
    );
    expect(mocks.redirect.mock.calls[0]?.join(";")).not.toContain("token");
  });
});
