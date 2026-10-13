import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

export async function expectAxeClean(
  page: Page,
  testInfo: TestInfo,
  artifactName: string,
) {
  const result = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22a",
      "wcag22aa",
    ])
    .analyze();
  const violations = result.violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }));

  await testInfo.attach(`${artifactName}-axe`, {
    body: Buffer.from(JSON.stringify(result.violations, null, 2)),
    contentType: "application/json",
  });
  expect(
    violations,
    `${artifactName} debe cumplir las reglas automáticas WCAG A/AA hasta 2.2`,
  ).toEqual([]);
}
