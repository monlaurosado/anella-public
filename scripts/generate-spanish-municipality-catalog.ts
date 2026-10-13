import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { z } from "zod";

const projectRoot = resolve(__dirname, "..");
const defaultMigrationPath = join(
  projectRoot,
  "prisma/migrations/20260714193000_spanish_municipality_catalog",
  "migration.sql",
);
const sourceArchive = process.argv[2];
const migrationPath = process.argv[3]
  ? resolve(process.argv[3])
  : defaultMigrationPath;
const catalogDate = "2026-05-27";
const batchSize = 250;

if (!sourceArchive) {
  throw new Error(
    "Uso: npm run catalog:municipalities -- /ruta/BD_Municipios-Entidades.zip [ruta/migration.sql]",
  );
}

const municipalityRowSchema = z.object({
  COD_INE: z.string().regex(/^\d{11}$/),
  COD_PROV: z.string().regex(/^\d{2}$/),
  PROVINCIA: z.string().min(1),
  NOMBRE_ACTUAL: z.string().min(1),
  LONGITUD_ETRS89_REGCAN95: z.string().regex(/^-?\d+,\d+$/),
  LATITUD_ETRS89_REGCAN95: z.string().regex(/^-?\d+,\d+$/),
});
const provinceRowSchema = z.object({
  COD_PROV: z.string().regex(/^\d{2}$/),
  COMUNIDAD_AUTONOMA: z.string().min(1),
});

function decodedCsv(files: Record<string, Uint8Array>, name: string) {
  const bytes = files[name];
  if (!bytes) throw new Error(`El archivo oficial no contiene ${name}.`);
  return new TextDecoder("windows-1252").decode(bytes);
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  const archive = await readFile(resolve(sourceArchive));
  const files = unzipSync(archive);
  const provinceRows = parse(decodedCsv(files, "PROVINCIAS.csv"), {
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
    relax_column_count: false,
  }) as unknown[];
  const municipalitiesRows = parse(decodedCsv(files, "MUNICIPIOS.csv"), {
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
    relax_column_count: false,
  }) as unknown[];
  const regionsByProvince = new Map(
    provinceRows.map((row) => {
      const parsed = provinceRowSchema.parse(row);
      return [parsed.COD_PROV, parsed.COMUNIDAD_AUTONOMA] as const;
    }),
  );
  const municipalities = municipalitiesRows.map((row) => {
    const parsed = municipalityRowSchema.parse(row);
    const code = parsed.COD_INE.slice(0, 5);
    const region = regionsByProvince.get(parsed.COD_PROV);
    if (!region) {
      throw new Error(`No hay comunidad autónoma para el municipio ${code}.`);
    }
    return {
      id: `es-${code}`,
      code,
      name: parsed.NOMBRE_ACTUAL,
      province: parsed.PROVINCIA,
      region,
      longitude: parsed.LONGITUD_ETRS89_REGCAN95.replace(",", "."),
      latitude: parsed.LATITUD_ETRS89_REGCAN95.replace(",", "."),
    };
  });

  if (municipalities.length !== 8_132) {
    throw new Error(
      `Se esperaban 8.132 municipios en el catálogo 2026 y llegaron ${municipalities.length}.`,
    );
  }
  if (
    new Set(municipalities.map(({ code }) => code)).size !==
    municipalities.length
  ) {
    throw new Error("El catálogo oficial contiene códigos municipales duplicados.");
  }

  const statements = [
    "-- Catálogo nacional de municipios de España (8.132 filas).",
    "-- Fuente: Nomenclátor Geográfico de Municipios y Entidades de Población, IGN/CNIG.",
    `-- Edición: ${catalogDate}. Obra derivada de NGMEP CC-BY 4.0 ign.es.`,
    "-- Los identificadores es-CCMMM se derivan del código INE de cinco cifras.",
    "",
  ];

  for (let offset = 0; offset < municipalities.length; offset += batchSize) {
    const rows = municipalities.slice(offset, offset + batchSize).map(
      (municipality) =>
        `(${[
          sqlText(municipality.id),
          sqlText(municipality.name),
          sqlText(municipality.province),
          sqlText(municipality.region),
          "'ES'",
          municipality.latitude,
          municipality.longitude,
          "CURRENT_TIMESTAMP(3)",
          "CURRENT_TIMESTAMP(3)",
        ].join(", ")})`,
    );
    statements.push(
      "INSERT INTO `Municipality` (`id`, `name`, `province`, `region`, `country`, `latitude`, `longitude`, `createdAt`, `updatedAt`) VALUES",
      rows.join(",\n"),
      "ON DUPLICATE KEY UPDATE",
      "  `name` = VALUES(`name`),",
      "  `province` = VALUES(`province`),",
      "  `region` = VALUES(`region`),",
      "  `country` = VALUES(`country`),",
      "  `latitude` = VALUES(`latitude`),",
      "  `longitude` = VALUES(`longitude`),",
      "  `updatedAt` = VALUES(`updatedAt`);",
      "",
    );
  }

  await mkdir(dirname(migrationPath), { recursive: true });
  await writeFile(
    migrationPath,
    `${statements.join("\n").trimEnd()}\n`,
    "utf8",
  );
  console.log(
    `Catálogo generado: ${migrationPath} (${municipalities.length} municipios).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
