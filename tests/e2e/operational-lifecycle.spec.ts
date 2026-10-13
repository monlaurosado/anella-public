import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectAxeClean } from "./accessibility";
import {
  createBrowserErrorTracker,
  type BrowserErrorTracker,
} from "./browser-errors";
import {
  cleanupE2EOperationalFixtures,
  createE2EOperationalFixture,
  getE2EOperationalAuditSnapshot,
  type E2EOperationalFixture,
} from "./database";

let fixture: E2EOperationalFixture | undefined;
let browserErrors: BrowserErrorTracker | undefined;

test.beforeEach(async ({ page }, testInfo) => {
  browserErrors = createBrowserErrorTracker();
  browserErrors.trackPage(page);
  test.skip(
    testInfo.project.name !== "desktop-1280x720",
    "El ciclo de coordinación se ejecuta una sola vez en escritorio.",
  );
  await cleanupE2EOperationalFixtures();
  fixture = await createE2EOperationalFixture();
});

test.afterEach(async ({ context }, testInfo) => {
  try {
    if (fixture) {
      await context.clearCookies();
      await cleanupE2EOperationalFixtures();
      fixture = undefined;
    }
  } finally {
    await browserErrors?.expectNoErrors(
      testInfo,
      "El ciclo operativo no debe emitir console.error ni pageerror",
    );
    browserErrors = undefined;
  }
});

function operationalFixture() {
  if (!fixture) throw new Error("E2E operational fixture was not created");
  return fixture;
}

async function login(page: Page, account: E2EOperationalFixture["admin"]) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/coordinacion\/incidentes\?view=active$/);
  await expect(
    page.getByRole("heading", { name: "Emergencias" }),
  ).toBeVisible();
}

async function openIncidentTab(page: Page, label: RegExp) {
  const link = page
    .getByRole("navigation", { name: "Secciones de la emergencia" })
    .getByRole("link", { name: label });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/coordinacion\/incidentes\//);
  await page.goto(href!);
}

async function submitRedirectingAction(
  page: Page,
  submit: () => Promise<void>,
) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await submit();
  const response = await responsePromise;
  expect([200, 303]).toContain(response.status());
  const redirectHeader = response.headers()["x-action-redirect"];
  expect(redirectHeader).toBeTruthy();
  const redirectPath = redirectHeader?.split(";")[0];
  expect(redirectPath).toMatch(/^\/coordinacion\//);
  await page.goto(redirectPath!);
}

async function submitStateAction(page: Page, submit: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await submit();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
}

function articleWithHeading(page: Page, title: string): Locator {
  return page.locator("article").filter({
    has: page.getByRole("heading", { name: title }),
  });
}

test("alerta → emergencia → punto → aportación → recepción → cierre auditado", async ({
  page,
}, testInfo) => {
  const data = operationalFixture();
  let incidentPath = "";

  await test.step("reconoce una alerta oficial y prepara la emergencia", async () => {
    await login(page, data.admin);
    await page.goto("/coordinacion/detecciones");
    await expect(
      page.getByRole("heading", { name: "Señales externas pendientes" }),
    ).toBeVisible();

    const alert = page.locator("article").filter({
      hasText: "Protección Civil E2E",
    });
    await expect(alert).toHaveCount(1);
    await alert
      .getByRole("link", { name: /Crear borrador desde la señal/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Nueva emergencia" }),
    ).toBeVisible();
    await expect(page.getByText("Señal seleccionada")).toBeVisible();

    const form = page.locator("form").filter({
      has: page.getByRole("button", { name: "Crear emergencia" }),
    });
    await form.locator('input[name="title"]').fill(data.incident.title);
    await form
      .locator('textarea[name="publicSummary"]')
      .fill(data.incident.publicSummary);
    await submitRedirectingAction(page, () =>
      form.getByRole("button", { name: "Crear emergencia" }).click(),
    );

    await expect(
      page.getByText(
        "Incidente guardado como borrador y señal vinculada. Revisa la vista pública antes de validarlo.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: data.incident.title }),
    ).toBeVisible();
    incidentPath = new URL(page.url()).pathname;
    expect(incidentPath).toMatch(/^\/coordinacion\/incidentes\/[^/?#]+$/);
  });

  await test.step("aprueba la proyección pública y habilita un punto de entrega", async () => {
    const publicLocation = page.locator("details").filter({
      has: page.getByRole("heading", { name: "Ubicación pública aprobada" }),
    });
    await publicLocation.locator("summary").click();
    const publicLocationForm = publicLocation.locator("form");
    await publicLocationForm
      .locator('select[name="mode"]')
      .selectOption("SAFE_POINTS_ONLY");
    await publicLocationForm
      .locator('input[name="label"]')
      .fill(data.incident.publicLocationLabel);
    await publicLocationForm
      .locator('input[name="reason"]')
      .fill("Representación no táctica revisada para el simulacro E2E.");
    await publicLocationForm
      .locator('input[name="confirmPublicSafety"]')
      .check();
    await submitRedirectingAction(page, () =>
      publicLocationForm
        .getByRole("button", { name: "Aprobar ubicación pública" })
        .click(),
    );

    await openIncidentTab(page, /^Puntos de entrega\b/);
    const createPoint = page.locator("#nuevo-punto");
    await createPoint.locator(":scope > summary").click();
    const pointForm = createPoint.locator(":scope > form");
    await pointForm.locator('input[name="name"]').fill(data.safePoint.name);
    await pointForm
      .locator('input[name="address"]')
      .fill(data.safePoint.address);
    await pointForm.getByRole("button", { name: "Usar centro" }).click();
    await pointForm
      .getByRole("button", {
        name: "Ampliar alcance de ubicación exacta del punto seguro",
      })
      .click();
    await pointForm.locator('input[name="confirmSafePointSafety"]').check();
    await submitRedirectingAction(page, () =>
      pointForm
        .getByRole("button", { name: "Habilitar punto de entrega" })
        .click(),
    );

    await expect(
      page.getByText("Punto de entrega creado y habilitado.", { exact: true }),
    ).toBeVisible();
    await expect(articleWithHeading(page, data.safePoint.name)).toContainText(
      "Activo y público",
    );
    await expect(articleWithHeading(page, data.safePoint.name)).toContainText(
      "Zona visible de 40 m",
    );
  });

  await test.step("valida la emergencia y registra una aportación sin solicitud previa", async () => {
    await openIncidentTab(page, /^Resumen\b/);
    await submitRedirectingAction(page, () =>
      page
        .getByRole("button", { name: "Enviar a validación", exact: true })
        .click(),
    );
    await submitRedirectingAction(page, () =>
      page
        .getByRole("button", { name: "Validar y publicar", exact: true })
        .click(),
    );
    await expect(
      page.getByRole("heading", { name: "Estado: Activo" }),
    ).toBeVisible();

    const publicCode = (
      await getE2EOperationalAuditSnapshot(data.incident.title)
    ).publicCode;
    await page.goto(`/incidentes/${publicCode}`);
    await expect(
      page.getByRole("heading", { level: 1, name: data.incident.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Puntos de entrega habilitados" }),
    ).toBeVisible();

    const contributionForm = page
      .getByRole("region", {
        name: new RegExp(`Aportación en ${data.safePoint.name}`),
      })
      .locator("form");
    await contributionForm
      .getByLabel("Descripción breve")
      .fill("Cuatro cajas de agua cerradas para el punto oficial.");
    await contributionForm.getByLabel(/Cantidad/).fill("4");
    await contributionForm.getByLabel(/Unidad/).fill("cajas");
    await contributionForm.locator("summary").click();
    await contributionForm.getByLabel("Nombre").fill(data.citizen.name);
    await contributionForm.getByLabel("Teléfono").fill(data.citizen.phone);
    await contributionForm
      .getByLabel("Email", { exact: true })
      .fill(data.citizen.email);
    await contributionForm
      .getByRole("checkbox", { name: /Acepto que mis datos de contacto/ })
      .check();

    const contributionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.request().headers()["next-action"] !== undefined,
    );
    await contributionForm
      .getByRole("button", { name: "Voy a aportar" })
      .click();
    // JavaScript submissions use the action redirect header, not an HTTP redirect.
    expect((await contributionResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/aportaciones\/[A-Za-z0-9-]{3,20}$/);
    expect(new URL(page.url()).search).toBe("");
    await expect(
      page.getByRole("heading", { name: "Confirmada" }),
    ).toBeVisible();
    await expect(
      page.getByText(data.safePoint.name, { exact: true }),
    ).toBeVisible();
  });

  await test.step("revisa, recibe y cierra el punto de entrega", async () => {
    await page.goto(`${incidentPath}?tab=contributions`);
    let contribution = page.locator("article").filter({
      hasText: data.citizen.name,
    });
    await expect(contribution).toHaveCount(1);
    await contribution
      .locator("details[data-contribution-details] > summary")
      .click();
    let statusForm = contribution
      .locator("details[data-contribution-details]")
      .locator("form")
      .first();
    await statusForm.locator('select[name="status"]').selectOption("EN_ROUTE");
    await submitStateAction(page, () =>
      statusForm
        .getByRole("button", { name: /Actualizar estado para/ })
        .click(),
    );

    await page.goto(`${incidentPath}?tab=contributions`);
    contribution = page.locator("article").filter({
      hasText: data.citizen.name,
    });
    await contribution
      .locator("details[data-contribution-details] > summary")
      .click();
    statusForm = contribution
      .locator("details[data-contribution-details]")
      .locator("form")
      .first();
    await statusForm.locator('select[name="status"]').selectOption("DELIVERED");
    await submitStateAction(page, () =>
      statusForm
        .getByRole("button", { name: /Actualizar estado para/ })
        .click(),
    );

    await openIncidentTab(page, /^Puntos de entrega\b/);
    const point = articleWithHeading(page, data.safePoint.name);
    await point
      .locator('summary[aria-label^="Desactivar punto de entrega"]')
      .click();
    const closeForm = point.locator('form[aria-label^="Desactivar el punto"]');
    await closeForm
      .locator('textarea[name="reason"]')
      .fill("Simulacro completado; el punto deja de estar operativo.");
    await closeForm.locator('input[name="confirmSafePointChange"]').check();
    await submitRedirectingAction(page, () =>
      closeForm
        .getByRole("button", { name: /Confirmar desactivación/ })
        .click(),
    );

    await expect(
      page.getByText("Estado del punto de entrega actualizado.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(articleWithHeading(page, data.safePoint.name)).toContainText(
      "Inactivo",
    );
  });

  const audit = await getE2EOperationalAuditSnapshot(data.incident.title);
  expect(audit.actions).toEqual(
    expect.arrayContaining([
      "incident.created_from_detection",
      "external_detection.linked",
      "incident.public_location_approved",
      "safe_point.created_and_validated",
      "contribution.pledged_by_citizen",
      "contribution.status_changed",
      "safe_point.deactivated",
    ]),
  );
  expect(
    audit.actions.filter((action) => action === "contribution.status_changed"),
  ).toHaveLength(2);
  await expectAxeClean(page, testInfo, "operational-lifecycle-final");
});
