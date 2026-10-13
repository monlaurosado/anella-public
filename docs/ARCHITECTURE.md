# Arquitectura

## Objetivo y límites

Anella publica información no táctica y coordina aportaciones voluntarias hacia
puntos oficiales. No dirige voluntariado, no es una herramienta de mando de
extinción y no sustituye al 112.

Una `ExternalDetection` es una observación de una fuente. Una `Incident` es una
emergencia interna. Solo una emergencia validada por una persona puede
presentarse como confirmada. El estado oficial comunicado por un proveedor y el
estado interno de revisión se conservan por separado.

## Capas

- `src/app`: páginas, rutas públicas, panel y endpoints.
- `src/actions`: mutaciones, autorización, validación y redirects firmados.
- `src/services`: fronteras de datos y reglas del dominio.
- `src/components`: presentación e interacción; no consulta Prisma.
- `src/lib`: autenticación, retención, seguridad y utilidades puras.
- `src/config`: validación de entorno y banderas de automatización.
- `prisma`: esquema, migraciones forward-only y simulacro.

`src/services/incidents.ts` sigue siendo la frontera temporal de incidentes. Las
proyecciones públicas son allowlists explícitas: nunca se serializa un modelo
Prisma completo.

## Modelo operativo

### Detección y emergencia

`ExternalDetection` conserva origen, momento, geometría de la fuente, estado
del proveedor y estado de revisión. Su proyección pública omite JSON bruto,
relaciones, actores y datos tácticos.

`Incident` incorpora `origin` (`MANUAL`, `DETECTION_CANDIDATE` u
`OFFICIAL_NOTICE`), organización responsable y municipios afectados mediante
`IncidentMunicipality`. Las coordenadas operativas permanecen separadas de la
representación pública, que debe aprobar una persona.

La agrupación candidata usa:

- ventana temporal configurable;
- distancia máxima configurable;
- orden determinista por fecha e identidad;
- mínimo de tres señales térmicas o una señal oficial abierta;
- comparación con candidatas/emergencias próximas existentes;
- lock de base e idempotencia.

El resultado es siempre `PENDING_VALIDATION`, sin verificación ni coordenadas
públicas. Una candidata nunca aparece como emergencia confirmada.

### Puntos de entrega

La tabla histórica `SafePoint` se conserva para no romper datos ni claves, pero
su semántica pública es `DropOffPoint`: punto de entrega, logístico o de
recogida. `pointStatus`, `pointType`, `publishedAt`, `closedAt` y
`organizationId` expresan su ciclo nuevo.

Un punto solo es público cuando está activo, validado y pertenece a una
emergencia pública. Desactivarlo exige motivo y confirmación, y se bloquea si
quedan aportaciones operativas o solicitudes legado activas.

### Aportaciones

`Contribution` pertenece directamente a una emergencia y a un punto mediante
FK compuestas. `needId` es opcional:

- registros nuevos públicos: `PUBLIC_ANONYMOUS`, normalmente sin `needId`;
- altas de coordinación: `COORDINATION`;
- históricos o enlaces opcionales: `LEGACY_NEED`.

Se conservan categoría, descripción, unidad, cantidad, ETA, estado, revisión
optimista, consentimientos separados y `piiExpiresAt`. El estado admite
anunciada, en camino, recepción parcial, recibida, cancelada y no presentada.

Las operaciones críticas usan transacciones serializables, idempotencia,
revisión optimista y cantidades monotónicas. La cancelación ciudadana requiere
cookie privada HttpOnly; el código público por sí solo no concede acceso.

### Avisos

`IncidentNotice` permite a una organización verificada publicar texto no
táctico. La acción rechaza coordenadas, frases tácticas y contenido que no haya
sido confirmado como seguro por la persona editora. Toda publicación o cierre
queda auditado.

### Organizaciones

`Organization` tiene tipo, estado de verificación, configuración de avisos y
dominios permitidos. `OrganizationClaim` conserva el flujo de verificación y
revisión. Verificar el email solo mueve la solicitud a revisión; nunca concede
acceso automáticamente.

Una aprobación de superadministración crea o vincula una cuenta inactiva,
limitada a organización y municipio, y fuerza cambio de contraseña antes de
operar. Rechazo, aprobación y activación son pasos auditables separados.

### Notificaciones

`NotificationOutbox` desacopla planificación y entrega. La clave de idempotencia
impide duplicados. La planificación genera un digest por organización,
municipio, candidata y ventana de cooldown, sin coordenadas ni PII.

El procesador:

1. reclama un lote con estado `PROCESSING`;
2. resuelve el destinatario solo al enviar;
3. descarta en simulacro o entrega mediante una interfaz de proveedor;
4. reintenta con backoff exponencial y límite;
5. recupera locks obsoletos;
6. registra resultado sin incluir el destinatario en auditoría.

Las tres banderas de creación de candidatas, generación de outbox y entrega
real son independientes y están apagadas por defecto.

## Autorización y aislamiento

- `SUPER_ADMIN`: alcance nacional explícito.
- `MUNICIPAL_ADMIN`: municipio asignado.
- `COORDINATOR`: organización verificada y municipio asignados; emergencias de
  su organización y candidatas locales aún no reclamadas.
- ciudadanía: solo rutas públicas y acceso privado a su aportación mediante
  cookie/token intercambiado.

Los municipios afectados amplían visibilidad solo según la política del rol;
no eliminan el filtro de organización. Las lecturas y escrituras vuelven a
aplicar el scope en servidor, aunque la UI ya haya filtrado.

## Frontera pública y privacidad

Nunca salen al cliente público:

- coordenadas operativas o posiciones de recursos;
- `rawJson`, enlaces internos o identificadores de actores;
- tokens, hashes, QR internos o payloads de outbox;
- nombre, teléfono, correo, notas o consentimientos de aportaciones.

Los logs usan errores saneados. Los tokens de reclamación se guardan con hash
para verificar y cifrado AES-256-GCM solo mientras la outbox necesita construir
el enlace. Los tokens de aportación no aparecen en query strings: el enlace
portable usa fragmento, se intercambia por una cookie HttpOnly, Secure y
SameSite=Strict, y la URL se limpia antes de continuar.

El mantenimiento anonimiza PII vencida, reclamaciones caducadas y payloads
terminales de outbox, preservando métricas y auditoría no personal.

## Persistencia y compatibilidad

Prisma mantiene `provider = "mysql"` y `mysql://` para MySQL y MariaDB. La
matriz soportada es MySQL 8.0.16, MySQL 8.4 y MariaDB 11.8 con
`check_constraint_checks=ON`.

Las migraciones nuevas son aditivas y forward-only:

1. añaden enums, columnas, tablas, índices, FKs y backfill;
2. cifran el token temporal de reclamación;
3. fijan el borrado en cascada de aportaciones al eliminar una emergencia.

El módulo `Need` y todos sus datos continúan disponibles. Ninguna migración
aplicada se edita y ninguna tabla histórica se renombra físicamente.

## Concurrencia, rendimiento y salud

Las colas usan paginación limitada e índices por tenant, estado, fecha, punto,
categoría y ETA. Los jobs usan locks con nombre y lotes acotados. La caché
pública se invalida al mutar contenido publicable.

`/api/health` verifica conexión, ledger de migraciones y una firma
representativa del esquema. `scripts/preflight-migrations.ts` comprueba tablas,
columnas, índices, FKs, checks, cascadas y consistencia del backfill antes de
permitir un despliegue.
