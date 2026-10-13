# Puerta local de carga de colas

La prueba `tests/integration/queue-load.test.ts` valida las dos colas de
coordinación contra un motor SQL certificado real: MySQL >=8.0.16 o
MariaDB >=11.8. Prisma usa `mysql://` en ambos casos. Es una prueba opt-in:
`npm test` la descubre pero la omite, mientras que el comando dedicado la activa
de forma explícita.

## Ejecución

Arranca la base de datos de pruebas y ejecuta:

```bash
npm run db:up
npm run test:load
```

Esta secuencia levanta MySQL 8.4 mediante `db:up`. Para ejecutar la misma puerta
en MariaDB, prepara una instancia 11.8 aislada, mantén
`check_constraint_checks=ON` globalmente y en la sesión y proporciona a la
ejecución la `DATABASE_URL` de pruebas con protocolo `mysql://`; no reutilices
la base del hosting.

El comando carga `.env.test`, despliega las migraciones y no necesita el seed de
demo. No debe apuntarse a producción ni a una base compartida.

Cada ejecución crea un municipio aislado cuyo nombre empieza por
`TEST queue load tenant`, 1.000 incidentes y 1.000 aportaciones. Los timestamps,
el orden y la distribución de estados son deterministas; un token por ejecución
evita colisiones entre procesos. El `afterAll` elimina el municipio y todas sus
filas relacionadas, también cuando falla una aserción.

## SLO local y comprobaciones

La puerta usa por defecto 80 solicitudes, con concurrencia 20, después de un
calentamiento. El SLO local de referencia es:

- 0 errores;
- p95 menor o igual a 3.000 ms;
- p99 menor o igual a 5.000 ms.

Además recorre las 10 páginas completas de cada cola, comprueba 1.000 IDs
distintos y el total exacto, verifica que el tamaño de página no oculta filas,
compara el número de consultas para 10 y 100 resultados y exige los índices de
ordenación esperados mediante `EXPLAIN`.

La salida incluye una línea JSON con prefijo `[queue-load]` y p50, p95, p99,
máximo, throughput, tasa de error y desglose por cola. Conviene conservar esa
línea como artefacto del gate. Este SLO detecta regresiones en un equipo o runner
estable; no es una estimación de capacidad de producción.

## Acta local del parche — 2026-07-14

Sobre MariaDB 11.8.8, el gate pasó 4/4 con 1.000 incidentes + 1.000
aportaciones, 80 solicitudes y concurrencia 20: 113,73 req/s, 0 errores,
p95 663,68 ms y p99 703,17 ms. Este resultado pertenece al parche exacto y al
motor indicados; no se atribuye a MySQL ni mide la capacidad de Hostinger.

## Acta local histórica — 2026-07-13

El gate reproducido en el snapshot Git limpio pasó 4/4 con 1.000 incidentes +
1.000 aportaciones, concurrencia 20 y 80 solicitudes: 161,99 req/s, 0 errores,
p50 17,83 ms, p95 471,67 ms y p99/máximo 493,76 ms. Los recuentos de consultas
permanecieron en 9/9 para incidentes y 11/11 para aportaciones al comparar
páginas de 10 y 100 resultados; los planes de índices pasaron. Es evidencia
local reproducible, no capacidad del proveedor ni resultado de producción.

Los umbrales y el tamaño de la carga pueden endurecerse sin editar el test:

```bash
QUEUE_LOAD_CONCURRENCY=30 \
QUEUE_LOAD_REQUESTS=120 \
QUEUE_LOAD_P95_MS=2000 \
QUEUE_LOAD_P99_MS=3500 \
npm run test:load
```

La concurrencia no admite valores inferiores a 20. El número de solicitudes no
admite valores inferiores a 40 ni a la concurrencia solicitada; un valor no
válido falla de forma explícita.
