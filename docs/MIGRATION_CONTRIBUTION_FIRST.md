# Migración al modelo centrado en aportaciones

## Inventario y decisión

El modelo anterior encadenaba `Incident → Need → Contribution`. Se conservan
`Incident`, `ExternalDetection`, `SafePoint`, `Need`, sus rutas históricas y la
auditoría. Se adaptan aportaciones, organizaciones, puntos, avisos, navegación y
automatización. No se reescribe la persistencia ni se borran históricos.

## Migraciones

### `20260716130000_emergency_contribution_coordination`

- añade tipos de organización, verificación, categoría/origen de aportación,
  tipo/estado de punto, origen de emergencia, avisos, reclamaciones y outbox;
- añade relación directa `Contribution.incidentId` y convierte `needId` en
  opcional;
- rellena `incidentId`, `safePointId`, categoría, origen, descripción, unidad,
  consentimientos y expiración a partir de los registros antiguos;
- añade FKs compuestas e índices para las colas;
- conserva `Need` y `SafePoint` con nombres físicos estables.

### `20260716131500_claim_token_encryption`

Añade el ciphertext autenticado del token de reclamación. El hash sigue siendo
la única referencia de verificación. El texto en claro nunca se persiste.

### `20260716133000_contribution_incident_cascade`

Corrige la FK directa para que una eliminación controlada de emergencia pueda
eliminar sus aportaciones; las FKs de punto y necesidad continúan restringiendo
inconsistencias durante la vida de la emergencia.

## Compatibilidad temporal

- una aportación nueva puede tener `needId = NULL`;
- una aportación nueva puede vincular opcionalmente una solicitud;
- todos los registros antiguos reciben `incidentId` y punto mediante backfill;
- la UI pública no presenta solicitudes como paso obligatorio;
- coordinación mantiene **Solicitudes (legado)** como función secundaria;
- métricas de cantidades históricas se siguen actualizando cuando existe
  `needId`.

## Secuencia de despliegue

1. crear y verificar backup;
2. restaurarlo en una base aislada del mismo motor;
3. ejecutar `npm run db:preflight` antes de migrar;
4. ejecutar `npm run db:deploy` en la copia;
5. repetir preflight, tests de regresión y checks de consistencia;
6. desplegar código compatible con registros antiguos y nuevos;
7. migrar el destino sin seed;
8. comprobar `/api/health`, logs y recorridos públicos;
9. mantener automatización y entrega de correo desactivadas hasta aprobación
   operativa independiente.

## Rollback

No hay migración destructiva inversa. Ante un fallo se detiene tráfico y jobs,
se conserva la base para análisis y se restaura el backup en una base nueva. No
se ejecutan `DROP`, `reset` ni edición manual del ledger en el destino.

## Riesgos controlados

- Un `SafePoint` sigue llamándose así en SQL aunque sea “punto de entrega” en
  producto; renombrarlo ahora habría elevado el riesgo sin aportar seguridad.
- El secreto de idempotencia deriva el cifrado de tokens de reclamación; su
  rotación requiere vaciar o descartar de forma auditada las verificaciones
  pendientes antes del cambio.
- La outbox está preparada, pero activar un proveedor real requiere un gate
  operativo y de protección de datos separado.
