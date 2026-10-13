# Matriz de aceptación

Esta matriz define la evidencia por release. Un resultado anterior no acredita
un commit nuevo ni un despliegue. Registrar SHA, fecha, Node/npm, motor exacto y
salida de cada comando.

Acta local: 16/07/2026, Node 22.23.1, npm 10.9.8, rama `main` sobre
`25d59623df75e6c234606e3c40a4bebf936864df`. El árbol contiene la entrega aún
sin commit; esta evidencia acredita el código, no un despliegue de esta versión.

## Producto y seguridad

- [x] El mapa separa por forma, icono y texto detección térmica, aviso oficial,
      emergencia confirmada, punto de entrega y área EFFIS.
- [x] “Hace X minutos” aparece en cada aviso/detección reciente.
- [x] Un popup queda por encima de marcadores, controles y navegación.
- [x] Pellizco/trackpad amplía el mapa con límite y no toda la página.
- [x] Una detección no se presenta como incendio confirmado.
- [x] No se publican equipos, medios, táctica ni coordenadas operativas.
- [x] La ciudadanía solo recibe instrucciones hacia puntos habilitados.
- [x] El formulario funciona sin cuenta, contacto ni `needId`.
- [x] El consentimiento pasa a obligatorio al facilitar PII; seguimiento es
      independiente.
- [x] Código/tokens no aparecen en query, logs, DTO ni auditoría pública.
- [x] Cookies privadas son HttpOnly, Secure y SameSite=Strict.
- [x] Antiautomatización e idempotencia funcionan y fallan cerradas.
- [x] Cierre de punto/emergencia se bloquea con operaciones pendientes.

## Autorización

- [x] Rutas públicas permiten acceso anónimo y coordinación lo rechaza.
- [x] `SUPER_ADMIN`, `MUNICIPAL_ADMIN` y `COORDINATOR` respetan sus scopes.
- [x] Coordinador exige organización verificada.
- [x] Dos municipios y dos organizaciones no leen ni mutan datos cruzados.
- [x] La reclamación exige dominio configurado, email y revisión manual.
- [x] Aprobación, rechazo y dominio no permitido tienen tests.
- [x] Una cuenta aprobada queda limitada, inactiva y con cambio de clave.

## Automatización y privacidad

- [x] Varias señales próximas crean una candidata, no varias emergencias.
- [x] Señales insuficientes no crean candidata.
- [x] La candidata queda pendiente, sin ubicación pública ni verificación.
- [x] El digest respeta radio, cooldown e idempotencia por organización.
- [x] Dos planners concurrentes no generan tormenta de correos.
- [x] Entrega desactivada no contacta proveedores.
- [x] Simulacro descarta y audita sin enviar.
- [x] Reintentos, backoff, máximo y locks obsoletos están probados.
- [x] Retención anonimiza aportaciones/reclamaciones y redacta outbox terminal.
- [x] Ningún test usa un proveedor de correo real.

## Datos y migración

- [x] Las migraciones son nuevas, aditivas y forward-only.
- [x] Backfill conserva todos los registros y relaciones históricos.
- [x] Aportación directa, aportación con `needId` opcional y legado pasan.
- [x] Índices/FKs/checks/cascadas coinciden con el contrato.
- [x] Regresión desde el esquema previo pasa sin editar el ledger.
- [x] Base vacía y copia restaurada pasan deploy y preflight.
- [x] MariaDB reporta `check_constraint_checks=1`.

## E2E obligatorios

- [x] Móvil 390×844: mapa → emergencia → punto → “Voy a aportar” →
      confirmación.
- [x] Coordinación: alerta → emergencia → habilitar punto → revisar aportación
      → cerrar punto.
- [x] Cancelación ciudadana sin token en URL.
- [x] Consola sin `console.error`/`pageerror`.
- [x] Axe A/AA, teclado, foco, targets táctiles y ausencia de overflow.

## Gates técnicos

| Gate         | Comando                                  | Resultado de esta release                     |
| ------------ | ---------------------------------------- | --------------------------------------------- |
| Lint         | `npm run lint`                           | OK, 0 errores y 0 avisos                      |
| TypeScript   | `npm run typecheck`                      | OK                                            |
| Vitest       | `npm test`                               | OK, 442 pasan y 5 omitidos (447)              |
| Build        | `npm run build`                          | OK, Next.js 16.2.10                           |
| Arranque     | `npm run test:production-start`          | OK                                            |
| Playwright   | `npm run test:e2e`                       | OK, 11 pasan y 10 omitidos por viewport       |
| Carga        | `npm run test:load`                      | OK, 4/4; 0 errores, p95 < 0,55 s en la matriz |
| Preflight    | `npm run db:preflight`                   | OK en los tres motores                        |
| Restore      | `npm run db:restore-drill`               | OK en los tres motores                        |
| Dependencias | `npm audit --audit-level=low`            | 0 vulnerabilidades                            |
| Producción   | `npm audit --omit=dev --audit-level=low` | 0 vulnerabilidades                            |

Repetir la matriz en MySQL 8.0.16, MySQL 8.4 y MariaDB 11.8. La CI debe fijar
las versiones, no usar etiquetas flotantes sin registrar el digest.

| Motor certificado | Deploy/preflight                | Vitest | Carga | Playwright | Restore |
| ----------------- | ------------------------------- | ------ | ----- | ---------- | ------- |
| MySQL 8.0.16      | OK                              | OK     | 4/4   | 11 OK      | OK      |
| MySQL 8.4.10      | OK                              | 442 OK | 4/4   | 11 OK      | OK      |
| MariaDB 11.8.8    | OK, `check_constraint_checks=1` | OK     | 4/4   | 11 OK      | OK      |

## Gate de despliegue

- [ ] Backup y checksum verificados.
- [ ] Restore aislado y preflight antes/después.
- [ ] Migraciones aplicadas sin seed.
- [ ] `/api/health` devuelve `200` en la URL real.
- [ ] Home, APIs públicas, legales, 404, login y logout pasan smoke.
- [ ] Banderas de automatización y entrega constan en el acta.
- [ ] Revisión humana independiente en móvil/teclado.
- [ ] Plan de rollback, RPO/RTO, monitorización y responsable aprobados.

Si cualquier gate obligatorio falla o no se ejecuta, la release no se declara
lista ni desplegada.
