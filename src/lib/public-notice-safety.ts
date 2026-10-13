import { z } from "zod";

const preciseCoordinatePattern =
  /(?:^|\s)[+-]?\d{1,2}\.\d{4,}\s*[,;/]\s*[+-]?\d{1,3}\.\d{4,}(?:\s|$)/;
const tacticalDetailPattern =
  /\b(?:posición de (?:bomberos|medios|efectivos)|coordenadas? operativas?|despliegue de (?:medios|efectivos)|base de bomberos|ruta de acceso de emergencias)\b/i;

export const publicIncidentNoticeSchema = z
  .object({
    incidentId: z.string().min(1).max(191),
    title: z.string().trim().min(5).max(191),
    body: z.string().trim().min(10).max(4_000),
    safetyConfirmed: z.boolean(),
  })
  .superRefine((value, context) => {
    if (!value.safetyConfirmed) {
      context.addIssue({
        code: "custom",
        message: "Confirma la revisión del contenido público.",
      });
    }
    if (
      preciseCoordinatePattern.test(value.body) ||
      tacticalDetailPattern.test(value.body)
    ) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message:
          "El aviso contiene coordenadas precisas o información operativa que no puede publicarse.",
      });
    }
  });
