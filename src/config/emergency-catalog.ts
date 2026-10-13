import type { NeedTemplate, SafePointTemplate } from "@/types/domain";

export const needTemplates: NeedTemplate[] = [
  {
    type: "water",
    title: "Agua embotellada",
    unit: "paquetes",
    defaultQuantity: 40,
    priority: "high",
  },
  {
    type: "ice",
    title: "Hielo",
    unit: "bolsas",
    defaultQuantity: 25,
    priority: "medium",
  },
  {
    type: "food",
    title: "Comida preparada",
    unit: "raciones",
    defaultQuantity: 60,
    priority: "medium",
  },
  {
    type: "power",
    title: "Generadores",
    unit: "uds",
    defaultQuantity: 3,
    priority: "critical",
  },
  {
    type: "transport",
    title: "Transporte logistico",
    unit: "vehiculos",
    defaultQuantity: 4,
    priority: "high",
  },
];

export const safePointTemplates: SafePointTemplate[] = [
  {
    kind: "sports_center",
    label: "Polideportivo",
    capacityHint: "Buen acceso, sombra y espacio de descarga.",
  },
  {
    kind: "town_hall",
    label: "Ayuntamiento",
    capacityHint: "Recepcion rapida y coordinacion municipal.",
  },
  {
    kind: "civil_protection_base",
    label: "Base de Proteccion Civil",
    capacityHint: "Entrega controlada por personal autorizado.",
  },
];
