# Despliegue, verificación y recuperación

## Regla de release

Un push a `main` solo se considera desplegado cuando el proveedor ha terminado,
`/api/health` responde `200` con `version` igual al SHA enviado y los smokes
públicos y autenticados pasan sobre la URL real. Un workflow verde acredita el
artefacto, no el entorno alojado.

No ejecutar seed, tests destructivos, `prisma migrate dev` ni reset en staging o
producción.

## Variables mínimas

- `ANELLA_ENV=staging` o `production`.
- `DATABASE_URL` del destino, con TLS según proveedor.
- `NEXTAUTH_URL` y `APP_URL` iguales al origen HTTPS canónico.
- secretos distintos y estables para sesión, idempotencia y Server Actions.
- `SERVER_ACTION_ALLOWED_ORIGINS` limitado al host real.
- configuración exacta del proxy si se confían cabeceras reenviadas.
- responsable, base jurídica, contacto, encargado y retención reales.
- datos legales reales.

Para la primera release del nuevo dominio:

```text
DETECTION_CANDIDATE_AUTOMATION_ENABLED=false
DETECTION_NOTIFICATION_OUTBOX_ENABLED=false
NOTIFICATION_DELIVERY_ENABLED=false
NOTIFICATION_DRILL_MODE=true
CONTRIBUTION_ANTI_AUTOMATION_MODE=honeypot
```

La ingesta externa puede activarse por separado. Activar notificaciones exige
el gate de [Notificaciones](NOTIFICATIONS.md).

## Gate previo en CI

La matriz debe ejecutar, en MySQL 8.0.16, MySQL 8.4 y MariaDB 11.8:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:load
npm run test:e2e
npm run db:preflight
npm run db:restore-drill
npm audit --audit-level=low
npm audit --omit=dev --audit-level=low
```

En MariaDB verificar `SELECT @@check_constraint_checks` y exigir `1` en la
sesión usada por migraciones y aplicación.

## Migración segura

1. Anotar commit, motor y versión exacta.
2. Detener jobs mutantes si el proveedor no garantiza una ventana estable.
3. Crear dump consistente y checksum fuera del servidor de aplicación.
4. Restaurar el dump en una base aislada del mismo motor.
5. Ejecutar preflight antes de migrar la copia.
6. Ejecutar `npm run db:deploy` y preflight después.
7. Ejecutar la regresión de migración y comprobar recuentos/digests.
8. Aplicar `db:deploy` al destino; nunca seed.
9. Desplegar el artefacto ya probado.
10. Comprobar el ledger y borrar la copia solo tras cerrar el acta.

Los scripts directos no cargan `.env` automáticamente. En local:

```bash
npx dotenv -e .env -- npm run db:preflight
npx dotenv -e .env -- npm run db:restore-drill
```

El simulacro necesita `ANELLA_DRILL_ADMIN_DATABASE_URL` con permisos para crear
y eliminar exclusivamente la base efímera de restauración. El script exige
loopback y `ANELLA_ENV=development|test`, por lo que no puede ejecutarse contra
staging o producción.

## Build y arranque

```bash
npm ci
npm run build
npm start
```

Con `ANELLA_ENV=test|staging|production`, `npm run build` ejecuta primero
`prisma migrate deploy`. En desarrollo local lo omite para que una compilación
sin base activa siga siendo posible. Es deliberadamente idempotente y necesario
para los despliegues Git de Hostinger, cuyo pipeline solo invoca el script
`build`. Toda migración debe seguir siendo aditiva y compatible con el artefacto
anterior para que un fallo posterior de compilación no deje el servicio activo
en un esquema incompatible.

El proyecto usa el servidor Node de Next.js y requiere proceso persistente. No
debe servirse `.next` como contenido estático. El proveedor ha de conservar los
secretos durante build y runtime según los requisitos de Next.js, además de
reenviar tráfico al puerto del proceso.

## Verificación del entorno real

Automatizar tras cada despliegue:

1. `GET /api/health` devuelve `200`, versión esperada y base/esquema listos.
2. `/`, `/privacidad`, `/aviso-legal` y una 404 responden sin 500.
3. `/api/incidents` y `/api/fire-detections` devuelven JSON permitido, sin PII.
4. `/coordinacion` redirige a login sin sesión.
5. Login de una cuenta de smoke limitada funciona y se cierra después.
6. La consola no muestra errores de hidratación, CSP ni carga del mapa.
7. En móvil se abre mapa → emergencia → punto sin overflow.
8. No se crea una aportación real en smoke salvo que exista un escenario
   aislado y se limpie de forma auditada.

Si `/api/health` falla, el release no está desplegado aunque la página del
proveedor marque “completado”. Revisar primero conexión, ledger, versión de
Node, variables de URL/origen y firma de esquema. No ocultar el fallo cambiando
health a una respuesta estática.

El build de Git toma el SHA directamente del checkout, lo usa como identificador
de despliegue y lo incrusta como `ANELLA_BUILD_VERSION`; no se configura esa
variable a mano.
En un despliegue por archivo sin `.git`, `DEPLOYMENT_VERSION` es el fallback
inmutable y el acta debe compararlo explícitamente con el artefacto publicado.

## Observabilidad

Alertar sobre:

- health no `200`;
- reinicios o falta de proceso persistente;
- última ingesta y mantenimiento;
- fuentes degradadas o desactualizadas;
- outbox pendiente, fallida o locks obsoletos;
- errores 5xx y rechazos anómalos de rate limit;
- crecimiento de PII vencida;
- espacio, conexiones y latencia de base.

Los logs no deben contener formularios, correos, teléfonos, tokens, payloads de
outbox ni JSON bruto de detecciones.

## Rollback

1. desactivar ingesta, candidatas, outbox y entrega;
2. retirar tráfico del artefacto fallido;
3. preservar base y logs para diagnóstico;
4. restaurar el backup verificado en una base nueva;
5. apuntar el artefacto anterior compatible a esa base;
6. ejecutar preflight y health;
7. reabrir tráfico y documentar tiempos, pérdida máxima y causa.

No modificar manualmente `_prisma_migrations` ni revertir DDL aditivo con
comandos improvisados.

## Acta de despliegue

Registrar commit, fecha, operador, URL, proveedor, motor/versión, checksum del
backup, resultado de restore, preflight antes/después, ledger, health, smoke,
banderas de automatización, auditoría de dependencias y decisión final. Si
algún punto no está acreditado, marcar el release como parcial o bloqueado.
