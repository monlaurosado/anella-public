export const appConfig = {
  name: "Anella",
  description:
    "Coordinacion ciudadana verificada para emergencias y puntos de entrega.",
  defaultCountry: "ES",
  supportEmail: "operaciones@anella.local",
};

export const safetyPrinciples = [
  "Los bomberos no gestionan la app en caliente.",
  "La ciudadania solo ve puntos de entrega habilitados por entidades autorizadas.",
  "Las detecciones externas nunca activan ayuda automaticamente.",
  "La ciudadania comunica voluntariamente que puede aportar sin crear una cuenta.",
];

export const externalSourceRegistry = [
  {
    id: "NASA_FIRMS",
    name: "NASA FIRMS",
    role: "Deteccion satelital de puntos calientes",
    mvpUse: "Prealerta interna para coordinadores",
  },
  {
    id: "EFFIS",
    name: "EFFIS",
    role: "Contexto europeo de incendios forestales",
    mvpUse: "Capa informativa futura",
  },
  {
    id: "INCENDISCAT",
    name: "IncendisCAT",
    role: "Informacion autonomica cuando exista acceso publico o acuerdo",
    mvpUse: "No bloquear el MVP",
  },
  {
    id: "AEMET_METEOCAT",
    name: "AEMET / Meteocat",
    role: "Riesgo meteorologico, viento y calor",
    mvpUse: "Contexto para priorizacion",
  },
];
