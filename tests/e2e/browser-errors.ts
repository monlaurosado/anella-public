import { expect, type Page, type TestInfo } from "@playwright/test";

export function createBrowserErrorTracker() {
  const issues: string[] = [];
  const expectedConsoleErrors: RegExp[] = [];
  const trackedPages = new WeakSet<Page>();

  function recordConsoleError(issue: string) {
    const expectedIndex = expectedConsoleErrors.findIndex((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(issue);
    });

    if (expectedIndex >= 0) {
      expectedConsoleErrors.splice(expectedIndex, 1);
      return;
    }
    issues.push(issue);
  }

  return {
    trackPage(page: Page) {
      if (trackedPages.has(page)) return;
      trackedPages.add(page);

      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const location = message.location();
        const source = location.url
          ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})`
          : "";
        recordConsoleError(`console: ${message.text()}${source}`);
      });
      page.on("pageerror", (error) => {
        issues.push(`pageerror: ${error.stack ?? error.message}`);
      });
    },

    expectConsoleError(pattern: RegExp) {
      expectedConsoleErrors.push(pattern);
    },

    async expectNoErrors(testInfo: TestInfo, message: string) {
      const missingExpectedErrors = expectedConsoleErrors.map((pattern) =>
        pattern.toString(),
      );
      if (issues.length > 0 || missingExpectedErrors.length > 0) {
        await testInfo.attach("browser-errors", {
          body: Buffer.from(
            [
              ...issues,
              ...missingExpectedErrors.map(
                (pattern) => `missing expected console error: ${pattern}`,
              ),
            ].join("\n"),
          ),
          contentType: "text/plain",
        });
      }

      expect
        .soft({ issues, missingExpectedErrors }, message)
        .toEqual({ issues: [], missingExpectedErrors: [] });
    },
  };
}

export type BrowserErrorTracker = ReturnType<typeof createBrowserErrorTracker>;
