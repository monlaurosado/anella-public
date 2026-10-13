import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const seedIncidentTitle = "SIMULACRO · Incendio forestal activo";
const browserIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    const source = location.url
      ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})`
      : "";
    issues.push(`console: ${message.text()}${source}`);
  });
  page.on("pageerror", (error) => {
    issues.push(`pageerror: ${error.stack ?? error.message}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const issues = browserIssues.get(page) ?? [];
  await testInfo.attach("browser-errors", {
    body: Buffer.from(JSON.stringify(issues, null, 2)),
    contentType: "application/json",
  });
  expect
    .soft(
      issues,
      "Las pantallas protegidas no deben emitir errores de consola ni pageerror",
    )
    .toEqual([]);
});

async function loginAsSeedAdmin(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD son obligatorios para E2E",
    );
  }

  await page.goto("/coordinacion");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Emergencias" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/coordinacion\/incidentes\?view=active$/);
}

async function gotoProtected(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} debe responder con un documento`).not.toBeNull();
  expect(response?.ok(), `${path} debe responder sin error HTTP`).toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator("#contenido-coordinacion")).toBeVisible();
}

async function auditScreen(
  page: Page,
  testInfo: TestInfo,
  artifactName: string,
) {
  await page.evaluate(async () => {
    const finiteAnimations = document.getAnimations().filter((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime;
      return typeof endTime === "number" && Number.isFinite(endTime);
    });
    await Promise.race([
      Promise.all(
        finiteAnimations.map((animation) =>
          animation.finished.catch(() => undefined),
        ),
      ),
      new Promise((resolve) => window.setTimeout(resolve, 1_000)),
    ]);
  });

  const axeResult = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22a",
      "wcag22aa",
    ])
    .analyze();
  await testInfo.attach(`${artifactName}-axe`, {
    body: Buffer.from(JSON.stringify(axeResult.violations, null, 2)),
    contentType: "application/json",
  });
  expect
    .soft(
      axeResult.violations.map((violation) => ({
        help: violation.help,
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.map((node) => node.target),
      })),
      `${artifactName} debe cumplir WCAG 2.2 A/AA`,
    )
    .toEqual([]);

  const undersizedTouchTargets = await page.evaluate(() => {
    const describe = (element: Element, rect: DOMRect) => ({
      element: element.tagName.toLowerCase(),
      height: Math.round(rect.height),
      label:
        element.getAttribute("aria-label") ||
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ||
        element.getAttribute("name") ||
        "sin nombre",
      width: Math.round(rect.width),
    });
    const failures: ReturnType<typeof describe>[] = [];
    const actionable = document.querySelectorAll(
      'a, button, summary, select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), [role="button"]',
    );

    for (const element of actionable) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        element.closest('[aria-hidden="true"]') ||
        element.matches(".sr-only:not(:focus)") ||
        (element.tagName === "A" && style.display === "inline")
      ) {
        continue;
      }
      if (rect.width < 44 || rect.height < 44) {
        failures.push(describe(element, rect));
      }
    }

    for (const control of document.querySelectorAll(
      'input[type="checkbox"], input[type="radio"]',
    )) {
      const target = control.closest("label") ?? control;
      const rect = target.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.width < 44 || rect.height < 44)
      ) {
        failures.push(describe(target, rect));
      }
    }

    return failures.slice(0, 40);
  });
  await testInfo.attach(`${artifactName}-touch-targets`, {
    body: Buffer.from(JSON.stringify(undersizedTouchTargets, null, 2)),
    contentType: "application/json",
  });
  expect
    .soft(
      undersizedTouchTargets,
      `${artifactName} debe mantener objetivos táctiles de al menos 44×44 px`,
    )
    .toEqual([]);

  const layout = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const overflowingElements = [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.getAttribute("class") ?? "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          tag: element.tagName.toLowerCase(),
          text:
            element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ??
            "",
          width: Math.round(rect.width),
        };
      })
      .filter(
        (element) =>
          element.width > 0 &&
          (element.left < -1 || element.right > clientWidth + 1),
      )
      .slice(0, 30);

    return {
      clientWidth,
      overflowingElements,
      scrollWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      viewportWidth: window.innerWidth,
    };
  });
  await testInfo.attach(`${artifactName}-layout`, {
    body: Buffer.from(JSON.stringify(layout, null, 2)),
    contentType: "application/json",
  });
  expect
    .soft(
      layout.scrollWidth,
      `${artifactName} no debe provocar desplazamiento horizontal: ${JSON.stringify(layout.overflowingElements)}`,
    )
    .toBeLessThanOrEqual(layout.clientWidth + 1);
}

async function assertKeyboardSkipLink(page: Page) {
  const skipLink = page.getByRole("link", { name: "Saltar al contenido" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  const box = await skipLink.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#contenido-coordinacion$/);
  const content = page.locator("#contenido-coordinacion");
  await expect(content).toBeFocused();
  await expect(content).toBeInViewport();
}

test("el área protegida mantiene accesibilidad y layout en sus pantallas pendientes", async ({
  page,
}, testInfo) => {
  await loginAsSeedAdmin(page);

  const seedIncidentLink = page.getByRole("link", {
    name: new RegExp(`Abrir emergencia .*${seedIncidentTitle}`),
  });
  await expect(seedIncidentLink).toBeVisible();
  const seedIncidentHref = await seedIncidentLink.getAttribute("href");
  expect(seedIncidentHref).toMatch(/^\/coordinacion\/incidentes\/[^/?#]+$/);

  await gotoProtected(page, "/coordinacion/equipo");
  await expect(
    page.getByRole("heading", { level: 1, name: "Equipo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("search", { name: "Buscar cuentas del equipo" }),
  ).toBeVisible();
  await assertKeyboardSkipLink(page);
  const newAccountPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Nueva cuenta" }) })
    .locator("details");
  const newAccountSummary = newAccountPanel.locator("summary");
  const createAccountButton = newAccountPanel.getByRole("button", {
    name: "Crear cuenta",
  });
  await expect(newAccountSummary).toBeVisible();
  const summaryBox = await newAccountSummary.boundingBox();
  expect(summaryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(createAccountButton).toBeHidden();
  await newAccountSummary.click();
  await expect(createAccountButton).toBeVisible();
  const visiblePrimaryActions = await page
    .locator("button")
    .evaluateAll(
      (buttons) =>
        buttons.filter(
          (button) =>
            button.getBoundingClientRect().height > 0 &&
            button.className.includes("bg-[color:var(--foreground)]"),
        ).length,
    );
  expect(visiblePrimaryActions).toBe(1);
  await newAccountSummary.click();
  await expect(createAccountButton).toBeHidden();
  await auditScreen(page, testInfo, "protected-team");

  await gotoProtected(page, "/coordinacion/incidentes/nuevo");
  await expect(
    page.getByRole("heading", { level: 1, name: "Nueva emergencia" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Título" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crear emergencia" }),
  ).toBeVisible();
  await auditScreen(page, testInfo, "protected-incident-new");

  await gotoProtected(page, "/coordinacion/detecciones");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Señales externas pendientes",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Importar FIRMS" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /^Señales pendientes del municipio \(\d+\)$/,
    }),
  ).toBeVisible();
  await auditScreen(page, testInfo, "protected-detections");

  await gotoProtected(page, `${seedIncidentHref!}?tab=needs`);
  await expect(
    page.getByRole("heading", { level: 1, name: seedIncidentTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Necesidades del incidente",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Secciones de la emergencia" })
      .getByRole("link", { name: /^Solicitudes \(legado\)/ }),
  ).toHaveAttribute("aria-current", "page");
  await auditScreen(page, testInfo, "protected-incident-needs");

  await gotoProtected(page, `${seedIncidentHref!}?tab=activity`);
  await expect(
    page.getByRole("heading", { level: 1, name: seedIncidentTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Actividad y auditoría" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Secciones de la emergencia" })
      .getByRole("link", { name: /^Actividad\b/ }),
  ).toHaveAttribute("aria-current", "page");
  await auditScreen(page, testInfo, "protected-incident-activity");
});
