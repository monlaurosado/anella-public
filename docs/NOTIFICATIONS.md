# Notificaciones y outbox

## Estados y banderas

La planificación y la entrega son procesos independientes:

- `DETECTION_CANDIDATE_AUTOMATION_ENABLED`: crea candidatas internas.
- `DETECTION_NOTIFICATION_OUTBOX_ENABLED`: genera digests para entidades.
- `NOTIFICATION_DELIVERY_ENABLED`: permite que el worker procese la outbox.
- `NOTIFICATION_DRILL_MODE`: descarta de forma auditada sin enviar.

Los valores predeterminados son `false`, `false`, `false` y `true`. Así, una
configuración incompleta no envía correo ni crea emergencias públicas.

## Agrupación y deduplicación

Las señales se agrupan por distancia y tiempo. Para cada candidata se
identifican municipios cercanos y organizaciones `VERIFIED` con notificaciones
activas. Se crea como máximo un digest por organización, municipio, candidata y
ventana de cooldown. `idempotencyKey` es única incluso ante dos jobs
concurrentes.

El digest solo dice que existe una señal o aviso que debe revisarse en el
panel. No contiene coordenadas, posiciones de recursos, tácticas ni afirmación
de incendio confirmado.

## Entrega

El procesador reclama lotes acotados, recupera locks obsoletos y resuelve el
destinatario en el último momento. Un proveedor implementa una interfaz simple
de envío. Los fallos vuelven a `PENDING` con backoff exponencial hasta
`maxAttempts`; después pasan a `FAILED`. Mensajes inválidos o sin destinatario
pasan a `DISCARDED`. Cada intento genera auditoría sin correo del destinatario.

## Activación segura

1. mantener simulacro y usar un proveedor falso;
2. revisar plantillas y destinatarios con protección de datos;
3. comprobar cooldown, límites, rebotes y monitorización;
4. habilitar creación de outbox sin entrega;
5. revisar el lote resultante;
6. activar entrega en un entorno controlado;
7. documentar apagado de emergencia y rotación de credenciales.

No se incluye un proveedor real en esta entrega; la interfaz está preparada
para evitar que las pruebas envíen mensajes.
