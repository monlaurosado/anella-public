import { describe, expect, it } from "vitest";

import { formatMinutesAgo, formatQuantity } from "@/lib/format";

describe("formatQuantity", () => {
  it("usa singular y plural españoles para las unidades conocidas", () => {
    expect(formatQuantity(1, "packs")).toBe("1 paquete");
    expect(formatQuantity(2, "paquetes")).toBe("2 paquetes");
    expect(formatQuantity(1, "raciones")).toBe("1 ración");
    expect(formatQuantity(0, "uds")).toBe("0 uds");
  });

  it("conserva unidades libres sin inventar una flexión", () => {
    expect(formatQuantity(1, "palés europeos")).toBe("1 palés europeos");
  });
});

describe("formatMinutesAgo", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");

  it("muestra los minutos transcurridos con singular y plural", () => {
    expect(formatMinutesAgo("2026-07-16T11:59:00.000Z", now)).toBe(
      "hace 1 minuto",
    );
    expect(formatMinutesAgo("2026-07-16T11:42:30.000Z", now)).toBe(
      "hace 17 minutos",
    );
  });

  it("no muestra minutos negativos ante pequeños desfases de reloj", () => {
    expect(formatMinutesAgo("2026-07-16T12:01:00.000Z", now)).toBe(
      "hace 0 minutos",
    );
  });
});
