# Anella

Anella coordina aportaciones ciudadanas voluntarias durante emergencias. El
mapa distingue detecciones externas, avisos oficiales, emergencias confirmadas
y puntos de entrega. Una persona puede comunicar qué material llevará a un
punto oficial activo sin registrarse y sin que exista una solicitud previa.

Anella **no sustituye al 112**, no dirige a la ciudadanía hacia incendios, no
coordina operaciones de extinción y no convierte automáticamente una detección
térmica en una emergencia confirmada. Nunca publica posiciones de equipos ni
información táctica.

## Recorridos principales

Ciudadanía:

1. abre el mapa nacional;
2. entra en una emergencia confirmada;
3. selecciona un punto de entrega habilitado;
4. indica qué puede aportar;
5. recibe un código y acceso privado para consultar o cancelar la aportación.

No hay cuenta ciudadana. Categoría y descripción son obligatorias; cantidad,
unidad, ETA y contacto son opcionales. Si se aporta contacto, el consentimiento
de privacidad pasa a ser obligatorio. El consentimiento de seguimiento es
independiente y no autoriza marketing.

Coordinación:

1. revisa una señal o una emergencia candidata;
2. valida la emergencia y su proyección pública no táctica;
3. habilita, edita o cierra puntos de entrega;
4. publica avisos oficiales;
5. gestiona aportaciones anunciadas, en camino, parciales, recibidas,
   canceladas o no presentadas;
6. cierra la emergencia cuando no quedan operaciones pendientes.

La navegación principal es: **Emergencias**, **Puntos de entrega**,
**Aportaciones**, **Avisos** y **Organización/Cuenta**. Las solicitudes
históricas (`Need`) continúan consultables como módulo legado, pero ya no son
requisito para aportar.

## Arquitectura

- Next.js App Router, React, TypeScript estricto y Tailwind CSS.
- Prisma 7 sobre MySQL 8.0.16+, MySQL 8.4 o MariaDB 11.8.
- Auth.js/NextAuth para personal autorizado.
- Leaflet y OpenStreetMap para la proyección pública.
- Server Components por defecto; componentes cliente solo para interacción.
- `src/services/incidents.ts` conserva la frontera entre UI y persistencia.

El cambio al modelo centrado en aportaciones es aditivo. `Contribution` se
relaciona directamente con `Incident` y `SafePoint` —semánticamente un punto de
entrega— y admite `needId = NULL`. Tres migraciones nuevas añaden el dominio,
protegen los tokens de reclamación y fijan el borrado en cascada desde la
emergencia sin modificar migraciones aplicadas.

Las detecciones próximas se agrupan en una candidata interna mediante una
ventana espacial/temporal determinista. La automatización y la entrega de
notificaciones están desactivadas por defecto. La cola `NotificationOutbox`
aplica idempotencia, digest, cooldown, reintentos limitados y modo simulacro;
las plantillas no contienen coordenadas tácticas.

Consulta [Arquitectura](docs/ARCHITECTURE.md),
[Migración](docs/MIGRATION_CONTRIBUTION_FIRST.md) y
[Modelo de amenazas](docs/THREAT_MODEL.md).

## Desarrollo local

Requisitos: Node.js 22, npm y Docker.

```bash
cp .env.example .env
npm ci
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Abre `http://localhost:3000`. Las credenciales de `.env.example` son solo para
desarrollo. `SEED_DEMO_DATA=true` crea datos rotulados como **SIMULACRO** y
está prohibido en producción.

Prisma usa `provider = "mysql"` y URLs `mysql://` también frente a MariaDB. En
MariaDB debe permanecer `check_constraint_checks=ON` globalmente y en cada
sesión.

## Variables nuevas del dominio

Todas fallan cerradas por defecto:

- `DETECTION_CANDIDATE_AUTOMATION_ENABLED=false`.
- `DETECTION_NOTIFICATION_OUTBOX_ENABLED=false`.
- `NOTIFICATION_DELIVERY_ENABLED=false`.
- `NOTIFICATION_DRILL_MODE=true`.
- `DETECTION_CANDIDATE_RADIUS_METERS=5000`.
- `DETECTION_CANDIDATE_WINDOW_MINUTES=120`.
- `DETECTION_CANDIDATE_MIN_THERMAL_SIGNALS=3`.
- `NOTIFICATION_OUTBOX_BATCH_SIZE=250`.
- `CONTRIBUTION_ANTI_AUTOMATION_MODE=honeypot`.

No actives entrega real hasta configurar un proveedor, revisar plantillas,
destinatarios, límites y monitorización. El modo `disabled` del control
antiautomatización se rechaza en producción.

## Calidad y operación

Con una base de pruebas local aislada:

```bash
npm run lint
npm run typecheck
npm test
npm run test:load
npm run test:e2e
npm run build
npm run db:preflight
npm run db:restore-drill
npm audit --audit-level=low
```

`npm test` y `npm run test:e2e` usan `.env.test`, migran y vuelven a cargar el
simulacro. Nunca deben apuntar a una base compartida o productiva. El despliegue
debe ejecutar migraciones sobre una copia restaurada, después sobre el destino,
y comprobar `/api/health` y recorridos públicos sin mutación. El procedimiento
completo está en [Despliegue](docs/DEPLOYMENT.md) y la evidencia exigida en
[Aceptación](docs/ACCEPTANCE.md).

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Fuentes oficiales y externas](docs/API_SOURCES.md)
- [Migración al modelo centrado en aportaciones](docs/MIGRATION_CONTRIBUTION_FIRST.md)
- [Reclamación de organizaciones](docs/ORGANIZATION_CLAIMS.md)
- [Notificaciones](docs/NOTIFICATIONS.md)
- [Privacidad y retención](docs/PRIVACY_RETENTION.md)
- [Modelo de amenazas](docs/THREAT_MODEL.md)
- [Terminología pública](docs/TERMINOLOGY.md)
- [Despliegue y recuperación](docs/DEPLOYMENT.md)
- [Matriz de aceptación](docs/ACCEPTANCE.md)
- [Inventario exacto del cambio](docs/CHANGESET_CONTRIBUTION_FIRST.md)
- [Roadmap](docs/ROADMAP.md)
