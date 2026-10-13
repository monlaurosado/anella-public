import { createHash } from "node:crypto";

import {
  expect,
  request as createRequestContext,
  test,
  type Page,
} from "@playwright/test";

import { expectAxeClean } from "./accessibility";
import {
  createBrowserErrorTracker,
  type BrowserErrorTracker,
} from "./browser-errors";
import { cleanupE2EContributions } from "./database";

const baseUrl = "http://127.0.0.1:3100";
const activeIncidentTitle = "SIMULACRO · Incendio forestal activo";
const activePointName = "SIMULACRO · Polideportivo municipal";

let browserErrors: BrowserErrorTracker | undefined;

test.beforeEach(async ({ page }) => {
  await cleanupE2EContributions();
  browserErrors = createBrowserErrorTracker();
  browserErrors.trackPage(page);
});

test.afterEach(async ({ context }, testInfo) => {
  try {
    await context.clearCookies();
    await cleanupE2EContributions();
  } finally {
    await browserErrors?.expectNoErrors(
      testInfo,
      "El flujo público no debe emitir console.error ni pageerror",
    );
    browserErrors = undefined;
  }
});

function contributionAccessCookieName(publicCode: string) {
  const codeHash = createHash("sha256")
    .update(`contribution:${publicCode}`)
    .digest("hex")
    .slice(0, 24);
  return `__Host-anella-aportacion-${codeHash}`;
}

function uniqueCitizen() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 100_000)}`.slice(
    -9,
  );
  return {
    email: `aportacion-${suffix}@e2e.anella.local`,
    name: `Ciudadanía E2E ${suffix}`,
    phone: `+346${suffix.slice(-8)}`,
  };
}

async function selectActivePoint(page: Page) {
  const region = page.getByRole("region", {
    name: `Aportación en ${activePointName}`,
  });
  if ((await region.count()) === 0) {
    await page
      .getByRole("button", { name: new RegExp(activePointName) })
      .click();
  }
  await expect(region).toBeVisible();
  return region;
}

async function submitDirectContribution(
  page: Page,
  options: { withContact: boolean },
) {
  const citizen = uniqueCitizen();
  const point = await selectActivePoint(page);
  const form = point.locator("form");
  await expect(form.locator('input[name="needId"]')).toHaveCount(0);
  await form.getByLabel("Categoría").selectOption("water");
  await form
    .getByLabel("Descripción breve")
    .fill("Cajas de agua cerradas para el punto de entrega oficial.");
  await form.getByLabel(/Cantidad/).fill("2");
  await form.getByLabel(/Unidad/).fill("cajas");

  if (options.withContact) {
    await form.locator("summary").click();
    await form.getByLabel("Nombre").fill(citizen.name);
    await form.getByLabel("Teléfono").fill(citizen.phone);
    await form.getByLabel("Email", { exact: true }).fill(citizen.email);
    await form
      .getByRole("checkbox", { name: /Acepto que mis datos de contacto/ })
      .check();
  }

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await form.getByRole("button", { name: "Voy a aportar" }).click();
  const response = await responsePromise;
  // Next 16.4 fetch actions redirect through x-action-redirect with HTTP 200.
  expect(response.status()).toBe(200);
  const redirect = response.headers()["x-action-redirect"];
  expect(redirect).toMatch(/^\/aportaciones\/[A-Za-z0-9-]{3,20};replace$/);
  expect(redirect).not.toContain("token=");

  await expect(page).toHaveURL(
    new RegExp(`${baseUrl}/aportaciones/[A-Za-z0-9-]{3,20}$`),
  );
  const url = new URL(page.url());
  const publicCode = url.pathname.split("/").at(-1);
  expect(publicCode).toMatch(/^[A-Za-z0-9-]{3,20}$/);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");
  await expect(page.getByRole("heading", { name: "Confirmada" })).toBeVisible();
  await expect(
    page.getByText(activePointName, { exact: true }).last(),
  ).toBeVisible();
  await expect(page).toHaveTitle("Aportación privada · Anella");
  if (!publicCode)
    throw new Error("La confirmación no contiene código público");
  return { citizen, publicCode };
}

test("la CSP dinámica protege las páginas públicas", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280x720",
    "La política de seguridad se comprueba una sola vez.",
  );

  const nonces: string[] = [];
  for (const path of ["/privacidad", "/aviso-legal"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const policy = await response?.headerValue("content-security-policy");
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    nonces.push(nonce!);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(await response?.headerValue("x-content-type-options")).toBe(
      "nosniff",
    );
    await expect(page.locator("main")).toBeVisible();
  }
  expect(new Set(nonces).size).toBe(nonces.length);
  await expectAxeClean(page, testInfo, "public-legal-csp");
});

test("móvil: mapa → emergencia → punto → voy a aportar → confirmación", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390x844",
    "El recorrido ciudadano exigido se valida en el viewport móvil.",
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Mapa de incendios en España" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Actualizado hace \d+ minuto(?:s)?/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "llama al 112" }),
  ).toBeVisible();

  const emergencyMarker = page.locator(
    `[title="Emergencia confirmada: ${activeIncidentTitle}"]`,
  );
  await expect(emergencyMarker).toBeVisible();
  await emergencyMarker.focus();
  await emergencyMarker.press("Enter");
  const popup = page.locator(".leaflet-popup");
  await expect(popup).toContainText(activeIncidentTitle);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect
    .poll(async () => {
      const box = await popup.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= viewport!.width);
    })
    .toBe(true);
  const [popupBox, headerBox] = await Promise.all([
    popup.boundingBox(),
    page.locator("header").boundingBox(),
  ]);
  expect(popupBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(popupBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  await expect(page.locator(".leaflet-marker-pane")).toHaveCSS(
    "visibility",
    "hidden",
  );
  await popup.getByRole("link", { name: "Ver emergencia" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: activeIncidentTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Puntos de entrega habilitados" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: activePointName }).first(),
  ).toBeVisible();
  await expectAxeClean(page, testInfo, "mobile-public-incident");

  const { publicCode } = await submitDirectContribution(page, {
    withContact: true,
  });
  const cookies = await context.cookies();
  expect(
    cookies.find(
      (cookie) => cookie.name === contributionAccessCookieName(publicCode),
    ),
  ).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Strict",
    secure: true,
  });
  expect(
    cookies.find((cookie) => cookie.name === "__Host-anella-ultima-aportacion"),
  ).toMatchObject({ value: publicCode, httpOnly: true, sameSite: "Strict" });
  await expectAxeClean(page, testInfo, "mobile-contribution-confirmation");
  await page.screenshot({
    path: testInfo.outputPath("mobile-contribution-confirmation.png"),
    fullPage: true,
  });
});

test("un código o token enviado en el cuerpo no permite cancelar sin la cookie privada", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280x720",
    "La frontera de acceso privado se comprueba una sola vez.",
  );

  await page.goto("/incidentes/DEMO-001");
  const { publicCode } = await submitDirectContribution(page, {
    withContact: false,
  });

  const isolatedRequest = await createRequestContext.newContext({
    baseURL: baseUrl,
    extraHTTPHeaders: {
      Origin: baseUrl,
      "Sec-Fetch-Site": "same-origin",
    },
  });
  try {
    const response = await isolatedRequest.post(
      `/api/contributions/${publicCode}/cancel`,
      { data: { token: "token-inventado-sin-cookie" }, maxRedirects: 0 },
    );
    expect(response.status()).toBe(400);
  } finally {
    await isolatedRequest.dispose();
  }

  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirmada" })).toBeVisible();
  await page.getByText("Cancelar aportación", { exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "Confirmo que no podré realizar la entrega.",
    })
    .check();
  await page.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(page.getByRole("heading", { name: "Cancelada" })).toBeVisible();
  await expect(page.getByText("No te desplaces al punto.")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
});

test("la consola de coordinación usa el nuevo vocabulario operativo", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280x720",
    "La navegación completa se comprueba una sola vez.",
  );
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("Faltan las credenciales de simulacro para E2E");
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(
    page.getByRole("heading", { name: "Emergencias" }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "Navegación operativa",
  });
  for (const label of [
    "Emergencias",
    "Puntos de entrega",
    "Aportaciones",
    "Avisos",
    "Organización",
    "Radar externo",
    "Mi cuenta",
  ]) {
    await expect(navigation.getByRole("link", { name: label })).toBeVisible();
  }
  await expectAxeClean(page, testInfo, "coordination-navigation");
});
