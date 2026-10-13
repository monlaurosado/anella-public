import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  cleanupE2EAccountSecurityFixtures,
  createE2EAccountSecurityFixture,
  type E2EAccountSecurityFixture,
} from "./database";
import {
  createBrowserErrorTracker,
  type BrowserErrorTracker,
} from "./browser-errors";
import { expectAxeClean } from "./accessibility";

let fixture: E2EAccountSecurityFixture;
let browserErrors: BrowserErrorTracker | undefined;
const rejectedCredentialsConsoleError =
  /^console: Failed to load resource: the server responded with a status of 401 \(Unauthorized\) \(http:\/\/127\.0\.0\.1:3100\/api\/auth\/callback\/credentials:\d+:\d+\)$/;

test.beforeEach(async ({ page }) => {
  browserErrors = createBrowserErrorTracker();
  browserErrors.trackPage(page);
  await cleanupE2EAccountSecurityFixtures();
  fixture = await createE2EAccountSecurityFixture();
});

test.afterEach(async ({ context }, testInfo) => {
  try {
    await context.clearCookies();
    await cleanupE2EAccountSecurityFixtures();
  } finally {
    await browserErrors?.expectNoErrors(
      testInfo,
      "El ciclo de seguridad de cuentas no debe emitir console.error ni pageerror",
    );
    browserErrors = undefined;
  }
});

async function submitLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function expectOperationalLogin(
  page: Page,
  account: { email: string; password: string },
) {
  await submitLogin(page, account.email, account.password);
  await expect(page).toHaveURL(/\/coordinacion\/incidentes\?view=active$/);
  await expect(page.getByRole("heading", { name: "Emergencias" })).toBeVisible();
}

async function signOut(page: Page) {
  await page.goto("/coordinacion/cuenta");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);
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
  const redirectPath = response.headers()["x-action-redirect"]?.split(";")[0];
  expect(redirectPath).toMatch(/^\/coordinacion\/equipo/);
  await page.goto(redirectPath!);
}

async function openNewAccountForm(page: Page): Promise<Locator> {
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Nueva cuenta" }) })
    .locator("details");
  if ((await panel.getAttribute("open")) === null) {
    await panel.locator("summary").click();
  }
  await expect(panel).toHaveAttribute("open", "");
  return panel.locator("form");
}

async function fillNewAccountForm(
  form: Locator,
  account: E2EAccountSecurityFixture["createdAdmin"],
  currentPassword: string,
) {
  await form.locator('input[name="name"]').fill(account.name);
  await form.locator('input[name="email"]').fill(account.email);
  await form.locator('select[name="role"]').selectOption("MUNICIPAL_ADMIN");
  await form.locator('input[name="password"]').fill(account.temporaryPassword);
  await form.locator('input[name="currentPassword"]').fill(currentPassword);
}

test("aplica aislamiento de tenant y el ciclo seguro de una cuenta administradora", async ({
  page,
  browser,
}, testInfo) => {
  await test.step("una administración municipal solo ve su tenant", async () => {
    await expectOperationalLogin(page, fixture.admin);
    await page.goto("/coordinacion/equipo");
    await expect(page.getByRole("heading", { name: "Equipo" })).toBeVisible();
    await expect(
      page.getByText(fixture.coordinatorA.email, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.coordinatorB.email, { exact: true }),
    ).toHaveCount(0);

    const foreignTenantQuery = new URLSearchParams({
      municipalityId: fixture.municipalityB.id,
      q: fixture.coordinatorB.email,
    });
    await page.goto(`/coordinacion/equipo?${foreignTenantQuery.toString()}`);
    await expect(page.getByRole("heading", { name: "Equipo" })).toBeVisible();
    await expect(
      page.getByText(fixture.coordinatorB.email, { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No hay cuentas que coincidan con los filtros."),
    ).toBeVisible();
  });

  await test.step("el rol COORDINATOR no puede abrir la gestión de equipo", async () => {
    await signOut(page);
    await expectOperationalLogin(page, fixture.coordinatorA);
    await page.goto("/coordinacion/equipo");
    await expect(page).toHaveURL(/\/coordinacion\/incidentes\?view=active$/);
    await expect(page.getByRole("heading", { name: "Equipo" })).toHaveCount(0);
  });

  await test.step("el alta ADMIN exige step-up con la contraseña actual", async () => {
    await signOut(page);
    await expectOperationalLogin(page, fixture.admin);
    await page.goto("/coordinacion/equipo");

    let form = await openNewAccountForm(page);
    await fillNewAccountForm(
      form,
      fixture.createdAdmin,
      "E2E-Wrong-Current-Password!",
    );
    await submitRedirectingAction(page, () =>
      form.getByRole("button", { name: "Crear cuenta" }).click(),
    );
    await expect(
      page.getByText(
        "No se pudo confirmar tu identidad. Revisa tu contraseña actual.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.createdAdmin.email, { exact: true }),
    ).toHaveCount(0);

    form = await openNewAccountForm(page);
    await fillNewAccountForm(
      form,
      fixture.createdAdmin,
      fixture.admin.password,
    );
    await submitRedirectingAction(page, () =>
      form.getByRole("button", { name: "Crear cuenta" }).click(),
    );
    await expect(page.getByRole("status")).toContainText(
      "Cuenta de coordinación creada.",
    );
    await expect(
      page.getByText(fixture.createdAdmin.email, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Clave temporal", { exact: true }),
    ).toBeVisible();
  });

  await test.step("el primer acceso fuerza el cambio y revoca la sesión", async () => {
    await signOut(page);
    await submitLogin(
      page,
      fixture.createdAdmin.email,
      fixture.createdAdmin.temporaryPassword,
    );
    await expect(page).toHaveURL(/\/coordinacion\/cuenta$/);
    await expect(
      page.getByText(
        "Esta cuenta usa una contraseña temporal. Cámbiala antes de acceder a cualquier operación.",
        { exact: true },
      ),
    ).toBeVisible();

    await page.goto("/coordinacion/equipo");
    await expect(page).toHaveURL(/\/coordinacion\/cuenta$/);

    await page
      .getByLabel("Contraseña actual", { exact: true })
      .fill(fixture.createdAdmin.temporaryPassword);
    await page
      .getByLabel("Nueva contraseña", { exact: true })
      .fill(fixture.createdAdmin.permanentPassword);
    await page
      .getByLabel("Confirmar nueva contraseña", { exact: true })
      .fill(fixture.createdAdmin.permanentPassword);
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();

    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByRole("status")).toContainText(
      "Contraseña actualizada. Inicia sesión de nuevo para continuar.",
    );
  });

  await test.step("la clave anterior falla y la nueva reautentica en el mismo tenant", async () => {
    browserErrors?.expectConsoleError(rejectedCredentialsConsoleError);
    await submitLogin(
      page,
      fixture.createdAdmin.email,
      fixture.createdAdmin.temporaryPassword,
    );
    await expect(
      page.getByText("No se ha podido iniciar sesión con esos datos.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);

    await submitLogin(
      page,
      fixture.createdAdmin.email,
      fixture.createdAdmin.permanentPassword,
    );
    await expect(page).toHaveURL(/\/coordinacion\/incidentes\?view=active$/);

    await page.goto("/coordinacion/equipo");
    await expect(page.getByRole("heading", { name: "Equipo" })).toBeVisible();
    await expect(
      page.getByText(fixture.coordinatorA.email, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.coordinatorB.email, { exact: true }),
    ).toHaveCount(0);
  });

  await test.step("un ADMIN restablece la clave y revoca una sesión ya abierta", async () => {
    const adminContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3100",
      colorScheme: "light",
      locale: "es-ES",
      timezoneId: "Europe/Madrid",
      viewport: { width: 1280, height: 720 },
    });

    try {
      const adminPage = await adminContext.newPage();
      browserErrors?.trackPage(adminPage);
      await expectOperationalLogin(adminPage, fixture.admin);
      await adminPage.goto("/coordinacion/equipo");

      const target = adminPage.locator("article").filter({
        hasText: fixture.createdAdmin.email,
      });
      const resetLabel = `Restablecer credenciales de ${fixture.createdAdmin.name}, ${fixture.createdAdmin.email}`;
      const resetDetails = target.locator("details").filter({
        has: adminPage.locator(`summary[aria-label="${resetLabel}"]`),
      });
      await resetDetails.locator("summary").click();
      const resetForm = resetDetails.locator(
        `form[aria-label="${resetLabel}"]`,
      );
      await resetForm
        .locator('input[name="password"]')
        .fill(fixture.createdAdmin.resetTemporaryPassword);
      await resetForm
        .locator('input[name="currentPassword"]')
        .fill(fixture.admin.password);
      await resetForm
        .locator('textarea[name="reason"]')
        .fill("Solicitud verificada para el ensayo E2E de revocación.");
      await resetForm.locator('input[name="confirmSensitiveAction"]').check();
      await submitRedirectingAction(adminPage, () =>
        resetForm.getByRole("button", { name: resetLabel }).click(),
      );
      await expect(adminPage.getByRole("status")).toContainText(
        "Contraseña temporal actualizada.",
      );

      await page.goto("/coordinacion/equipo");
      await expect(page).toHaveURL(/\/login(?:\?|$)/);

      browserErrors?.expectConsoleError(rejectedCredentialsConsoleError);
      await submitLogin(
        page,
        fixture.createdAdmin.email,
        fixture.createdAdmin.permanentPassword,
      );
      await expect(
        page.getByText("No se ha podido iniciar sesión con esos datos.", {
          exact: true,
        }),
      ).toBeVisible();

      await submitLogin(
        page,
        fixture.createdAdmin.email,
        fixture.createdAdmin.resetTemporaryPassword,
      );
      await expect(page).toHaveURL(/\/coordinacion\/cuenta$/);
      await expect(
        page.getByText(
          "Esta cuenta usa una contraseña temporal. Cámbiala antes de acceder a cualquier operación.",
          { exact: true },
        ),
      ).toBeVisible();
    } finally {
      await adminContext.close();
    }
  });

  await expectAxeClean(page, testInfo, "account-security-final");
});
