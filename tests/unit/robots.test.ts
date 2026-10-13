import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";

describe("robots metadata", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disallows the complete technical staging site", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANELLA_ENV", "staging");

    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    });
  });
});
