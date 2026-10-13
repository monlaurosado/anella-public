# Pruebas por rol, tenant y privacidad

Este documento define cómo comprobar autorización, aislamiento municipal y
acceso a datos personales en Anella. Es un **procedimiento de prueba**, no un
registro de resultados: su mera existencia no acredita que una release haya
pasado la matriz.

Debe ejecutarse sobre una base desechable de un motor certificado —MySQL
>=8.0.16 o MariaDB >=11.8— y una release identificada por un commit inmutable.
Prisma conserva `provider = "mysql"` y la conexión `mysql://` con ambos motores.
Nunca se ejecuta sobre un incidente real ni se copian
credenciales, tokens o datos personales en capturas, tickets o logs.

## Política que se comprueba

- La ciudadanía usa el flujo público sin cuenta. El enum `CITIZEN` no concede
  acceso a `/coordinacion` y una cuenta con ese rol debe ser rechazada por el
  proveedor de credenciales.
- `COORDINATOR` puede gestionar emergencias de su organización, candidatas
  locales aún no reclamadas, puntos de entrega, avisos y aportaciones. Requiere
  organización `VERIFIED` y municipio; no hereda recursos de otra entidad.
- `MUNICIPAL_ADMIN` tiene el mismo alcance operativo y además gestiona cuentas
  de coordinación de su municipio.
- `SUPER_ADMIN` puede trabajar con recursos de todos los municipios, gestionar
  cuentas existentes globalmente y aprovisionar cuentas nuevas. El alta y las
  demás operaciones con contexto municipal exigen seleccionar o aportar un
  municipio válido de forma explícita.
- Una cuenta operativa sin municipio falla de forma cerrada: no hereda señales,
  incidentes ni aportaciones globales.
- El código aplica actualmente acceso a la PII mínima de aportaciones para los
  tres roles operativos dentro de su alcance. Es una propuesta técnica: la
  entidad responsable debe aprobar expresamente qué roles la necesitan,
  incluido `SUPER_ADMIN`, antes de staging o producción. La ciudadanía solo ve
  su propia aportación cuando demuestra posesión del secreto privado.
- Ocultar un enlace en navegación no cuenta como autorización. Cada prueba debe
  cubrir también acceso directo y, para mutaciones, la Server Action real.

Hasta que exista esa aprobación, el gate de PII permanece **BLOQUEADO
EXTERNAMENTE**. Si la decisión difiere de la matriz actual, hay que cambiar
conjuntamente política, código y pruebas; no basta con modificar esta tabla.

## Matriz de capacidades propuesta

Las celdas de PII expresan el comportamiento actual que debe validarse, no una
autorización jurídica u organizativa ya concedida.

| Actor | Web pública | Login de coordinación | Operación | Alcance | PII de aportaciones | Gestión de cuentas |
| --- | --- | --- | --- | --- | --- | --- |
| Anónimo | Sí | No | Registrar, consultar y cancelar únicamente su propia aportación con secreto | Información pública validada y detecciones automáticas seguras | Solo su aportación privada | No |
| `CITIZEN` | Sí | Rechazado | Igual que anónimo; no existe panel ciudadano autenticado | Información pública validada y detecciones automáticas seguras | Solo mediante el secreto de su aportación | No |
| `COORDINATOR` | Sí | Sí | Emergencias de su entidad, candidatas locales, puntos, avisos y aportaciones | Su organización y municipio | Sí, solo dentro del scope | No |
| `MUNICIPAL_ADMIN` | Sí | Sí | Operación completa y administración de equipo | Su municipio | Sí, solo dentro de su municipio | Crear, activar, desactivar y restablecer cuentas de su municipio, salvo su propia cuenta |
| `SUPER_ADMIN` | Sí | Sí | Operación global con contexto municipal explícito | Todos los municipios | Sí, dentro del recurso seleccionado | Crear cuentas en un municipio seleccionado explícitamente y gestionar cuentas globalmente |

El formulario de alta de `SUPER_ADMIN` exige selección explícita de municipio y
solo acepta una organización perteneciente a ese municipio. La acción falla de
forma cerrada si falta el municipio o la organización cruza tenants.
`tests/integration/team-management.test.ts` cubre esos casos y el alta válida
en el municipio elegido; una administración municipal sigue derivando su
tenant de la sesión y no puede sobrescribirlo.

## Matriz de información sensible

| Información | Público/anónimo | Propietario del enlace privado | Rol operativo dentro de tenant | Rol operativo de otro tenant | `SUPER_ADMIN` |
| --- | --- | --- | --- | --- | --- |
| Resumen, municipio y área pública aprobada | Permitida | Permitida | Permitida | Permitida como información pública | Permitida |
| Coordenadas operativas del incidente | Prohibida | Prohibida | Permitida | Prohibida | Permitida |
| Geometría cartográfica comunicada por fuentes externas | Permitida mediante allowlist segura | Permitida mediante allowlist segura | Permitida dentro del tenant | Permitida mediante allowlist segura | Permitida con contexto municipal |
| Raw JSON de detecciones externas | Prohibido | Prohibido | Prohibido; no se selecciona ni expone en el producto | Prohibido | Prohibido; no se selecciona ni expone en el producto |
| QR interno del punto de entrega | Prohibido | Prohibido | Permitido dentro del tenant | Prohibido | Permitido |
| Nombre, teléfono, email, ETA y notas de otra aportación | Prohibidos | Prohibidos | Permitidos dentro del tenant | Prohibidos | Permitidos |
| Estado y destino de la aportación propia | Solo con secreto | Permitidos mientras el secreto sea válido | Permitidos dentro del tenant | Prohibidos | Permitidos |
| Identidad del personal validador y auditoría | Prohibida | Prohibida | Permitida dentro del tenant | Prohibida | Permitida |
| Token/hash de cancelación | Prohibido siempre | El secreto solo existe en fragmento/cookie; el hash nunca se muestra | Prohibido | Prohibido | Prohibido |

## Datos de prueba obligatorios

El seed de simulacro prepara el administrador y coordinador locales del mismo
municipio, pero no basta para esta matriz. Antes de probar deben existir, como
mínimo, los siguientes registros ficticios y claramente marcados `SIMULACRO`:

| Alias | Preparación |
| --- | --- |
| `tenant-A` | Municipio, organización verificada, emergencia, punto habilitado, aportación directa y detección pendiente |
| `tenant-B` | El mismo conjunto, con títulos y códigos distintos |
| `coord-A` / `coord-B` | `COORDINATOR` activo ligado al tenant correspondiente |
| `admin-A` / `admin-B` | `MUNICIPAL_ADMIN` activo ligado al tenant correspondiente |
| `super` | `SUPER_ADMIN` activo; documentar si tiene o no municipio propio |
| `coord-sin-tenant` | `COORDINATOR` activo con `municipalityId=null`, solo para probar fallo cerrado |
| `citizen-account` | Cuenta `CITIZEN` con credenciales válidas, solo para confirmar que el login operativo la rechaza |
| `aportacion-A` / `aportacion-B` | Una aportación pendiente por tenant con PII ficticia diferente y secreto privado conocido por el ejecutor |

La suite de integración ya crea `tenant-B`, `super`, `coord-sin-tenant` y
`citizen-account` en una base desechable. Esa fixture automatizada no prepara
por sí sola cuentas navegables para una revisión manual o staging: el acta debe
documentar su aprovisionamiento controlado y destrucción. No se usa SQL directo
para gestionar cuentas reales.

Las contraseñas manuales/staging deben ser temporales, diferentes entre actores
y guardarse fuera del repositorio. La única excepción son credenciales conocidas
de fixtures locales desechables, como `.env.test` y el seed loopback; nunca se
reutilizan fuera de local/test ni se copian al acta.

## Preparación de la ejecución

1. Registra commit, fecha, persona ejecutora, versión de Node, navegador y URL
   de pruebas. Confirma que el árbol está limpio.
2. Usa `ANELLA_ENV=test`, una conexión `mysql://` loopback y una base exclusiva
   que pueda borrarse. En MariaDB confirma antes
   `check_constraint_checks=ON` globalmente y en la sesión.
3. Aplica migraciones y carga el simulacro. Crea después las fixtures adicionales
   anteriores sin reutilizar datos de otra ejecución.
4. Abre contextos de navegador separados para cada actor. No compartas cookies
   ni storage entre roles.
5. Conserva una consulta de control con los IDs de ambos tenants y los estados
   iniciales, sin exportar PII. Servirá para demostrar que un intento denegado no
   modificó datos.
6. Activa captura de errores de consola y red. Una respuesta `200` no es prueba
   suficiente para una Server Action: comprueba también el estado persistido.

### Alcance de la automatización

`role-authorization-matrix.test.ts` ejecuta servicios y Server Actions reales
contra el motor SQL de pruebas, pero sustituye los helpers de autorización y
scope para simular el actor. Los casos de ciudadanía representan el acceso
anónimo, no un login real
con rol `CITIZEN`. `account-security.test.ts` simula de forma equivalente parte
del DAL. Por tanto, esos tests no acreditan por sí solos la cadena
cookie → JWT → DAL → base, el acceso directo a rutas ni las redirecciones. Esos
casos permanecen en el recorrido manual/E2E de una release identificada.

## Casos comunes de autenticación

Ejecuta estos casos antes de los flujos específicos:

| ID | Acción | Resultado esperado |
| --- | --- | --- |
| `AUTH-01` | Anónimo abre `/coordinacion`, `/coordinacion/incidentes` y `/coordinacion/aportaciones` directamente | Redirección a login; ningún dato operativo en HTML o respuesta RSC |
| `AUTH-02` | `citizen-account` intenta iniciar sesión | Credenciales rechazadas; no se crea sesión operativa |
| `AUTH-03` | Cuenta operativa con `mustChangePassword=true` inicia sesión e intenta abrir rutas directas | Solo puede usar `/coordinacion/cuenta`; el resto redirige o falla cerrado |
| `AUTH-04` | La cuenta cambia correctamente la clave temporal | Se incrementa `sessionVersion`, se elimina el flag temporal y la sesión actual queda revocada; debe iniciar sesión de nuevo |
| `AUTH-05` | Se intenta reutilizar la contraseña anterior | Login rechazado |
| `AUTH-06` | Una cuenta desactivada intenta login y reutiliza una sesión ya abierta | Login rechazado y siguiente petición de la sesión anterior sin acceso |
| `AUTH-07` | Administración restablece una contraseña | Sesiones previas revocadas y cambio obligatorio en el siguiente acceso |
| `AUTH-08` | Login/logout normal | Tras logout, volver a una URL privada no recupera el panel ni datos en caché |

## Flujo anónimo y `CITIZEN`

1. Abre `/`, un incidente público y `GET /api/incidents`.
   - Solo aparecen incidentes activos/en seguimiento, verificados y con
     ubicación pública aprobada.
   - Solo aparecen puntos de entrega activos y validados. Las solicitudes
     legado, si existen, son contexto y no condicionan el formulario.
   - `GET /api/fire-detections` responde sin sesión y las detecciones vigentes se
     dibujan automáticamente en el mapa nacional.
   - Busca de forma negativa coordenadas de equipos, relaciones internas, QR,
     PII, tokens, raw JSON e identidad de validadores.
2. Registra una aportación sin cuenta y sin `needId`.
   - Categoría y descripción son obligatorias; cantidad, unidad, ETA, nombre,
     teléfono, email y notas permanecen opcionales.
   - Si hay contacto se exige consentimiento; seguimiento usa otro checkbox.
   - Se muestra el punto de entrega y el aviso de no acudir a la zona de
     intervención/llamar al 112.
3. Comprueba el enlace devuelto.
   - El secreto está en el fragmento `#token=`, nunca en query.
   - Tras el intercambio same-origin, URL e historial quedan limpios.
   - La cookie es `HttpOnly`, `Secure`, `SameSite=Strict`, host-only y la
     respuesta usa `no-store` y `no-referrer`.
4. Sin cookie/secreto, intenta abrir `aportacion-A` y un código inexistente.
   Ambos deben ofrecer una respuesta indistinguible y no revelar existencia.
5. Con el secreto de `aportacion-A`, verifica su estado y cancélala con
   confirmación. No debe aparecer PII de `aportacion-B`.
6. Desactiva en la fixture su punto y vuelve al enlace.
   Debe ocultar dirección y mostrar inequívocamente que no se desplace.

## Flujo `COORDINATOR`

Ejecuta con `coord-A` y repite simétricamente con `coord-B`:

1. El listado de incidentes, aportaciones, QR y detecciones solo contiene
   recursos de su tenant, incluidos filtros, totales y opciones de selección.
2. Puede reconocer una candidata, configurar una ubicación pública separada,
   habilitar un punto, publicar un aviso y procesar una aportación directa
   parcial/completa sin crear una solicitud.
   - En la recepción móvil cada cantidad conserva la unidad comunicada por la
     persona aportante.
3. Puede ver PII ficticia de `aportacion-A` porque la coordinación de entregas
   es una función autorizada; no puede buscar ni obtener PII de `aportacion-B`.
4. Abrir `/coordinacion/equipo` directamente redirige fuera de esa sección.
   Invocar las acciones de equipo debe devolver `FORBIDDEN` o no mutar datos.
5. Cada mutación permitida produce una entrada `AuditLog` con actor, tenant,
   entidad, acción y datos operativos relevantes, sin contraseña ni token.

## Flujo `MUNICIPAL_ADMIN`

Ejecuta con `admin-A` y repite simétricamente con `admin-B`:

1. Repite todos los permisos operativos de `COORDINATOR` y sus límites tenant.
2. En `/coordinacion/equipo`, crea una cuenta temporal de coordinación y otra de
   administración municipal.
   - Ambas quedan ligadas al municipio/organización de la persona administradora.
   - Ambas exigen cambio de contraseña al primer acceso.
3. Restablece, desactiva y reactiva una cuenta subordinada usando motivo y
   confirmación. Comprueba incremento de versión de sesión y auditoría.
4. Confirma que no puede desactivar, restablecer ni editar su propia cuenta desde
   esa gestión.
5. Sustituye el ID objetivo por una cuenta del otro tenant e invoca la acción
   real. Debe responder como no encontrada/no modificable; la cuenta B y sus
   sesiones permanecen intactas y no aparece un audit de éxito.

## Flujo `SUPER_ADMIN`

1. Los listados globales muestran recursos autorizados de A y B con sus tenants
   identificables; los filtros y totales no mezclan identidades.
2. En detecciones y creación de incidente, intenta actuar sin municipio. La UI
   debe exigir selección. Después selecciona A y confirma que la acción queda
   ligada a A; repite con B.
3. Abre directamente incidentes, aportaciones, QR y detecciones de ambos tenants
   y realiza una mutación segura de simulacro en cada uno. Comprueba auditoría.
4. La cola de equipo puede listar y gestionar cuentas existentes de A y B.
5. En el alta de equipo, selecciona explícitamente A, crea una cuenta y comprueba
   tenant, organización, cambio obligatorio de contraseña y auditoría. Repite
   con B. Después intenta enviar el formulario sin municipio y con una
   organización de otro tenant: ambos intentos deben fallar sin crear la cuenta.

## Matriz de aislamiento directo

Para cada celda denegada no basta con observar que el recurso no aparece en la
lista. Usa el ID conocido de la fixture contraria y comprueba lectura y mutación:

| Recurso B con sesión A | `COORDINATOR A` | `MUNICIPAL_ADMIN A` | `SUPER_ADMIN` |
| --- | --- | --- | --- |
| `/coordinacion/incidentes/<id-B>` | Denegado/not found | Denegado/not found | Permitido |
| Filtro/listado de aportaciones B | Cero resultados | Cero resultados | Permitido |
| `/coordinacion/puntos/<qr-B>` | Denegado/not found | Denegado/not found | Permitido |
| Cola/acción de detección B | Denegada | Denegada | Permitida con tenant B explícito |
| Actualizar emergencia/aviso/punto B por Server Action | Sin mutación | Sin mutación | Permitido |
| Actualizar/reasignar aportación B | Sin mutación y sin PII | Sin mutación y sin PII | Permitido |
| Restablecer/desactivar cuenta B | Prohibido por rol | No encontrada/no modificable | Permitido sobre cuenta existente |

Repite también con `coord-sin-tenant`: todos los recursos operativos deben quedar
vacíos o inaccesibles. No se le asigna implícitamente un tenant.

## Comprobación de PII y proyección

Para cada página/API examinada, inspecciona DOM, respuesta RSC/JSON, URL,
historial, cookies y errores de consola. Busca valores canario únicos preparados
en `aportacion-A` y `aportacion-B`.

- En público no debe aparecer ninguno.
- En el enlace privado A solo puede aparecer la información necesaria de A y
  nunca identidad/contacto de otra aportación.
- En coordinación A puede aparecer el canario A y nunca el B.
- En coordinación B puede aparecer el canario B y nunca el A.
- En superadministración ambos pueden aparecer únicamente dentro de los
  recursos operativos correspondientes.
- `cancelTokenHash`, secreto en claro, contraseña/hash y raw JSON nunca se
  muestran a ningún rol.

Las capturas deben redactar la PII ficticia aunque no pertenezca a personas
reales, para que el procedimiento sea reutilizable sin fomentar malas prácticas.

## Acta automatizada del candidato fusionado y revisión humana externa pendiente

El commit técnico `b3e1668d91364d0d1f163d6dc0cb8e95df15d6f5` pasó el
[run 29325006501](https://github.com/monlaurosado/anella/actions/runs/29325006501)
en MySQL 8.0.16, MySQL 8.4.10 y MariaDB 11.8.8. Cada job registró 44 archivos
Vitest PASS + 1 skip, 347 tests PASS + 4 skips y Playwright 16 PASS + 2 skips
intencionales. También pasaron `npm ci`, lint, typecheck, build, `test:load`,
`db:preflight` y `db:restore-drill`; las auditorías npm dieron 0
vulnerabilidades.

Playwright comprueba Axe, teclado/foco, overflow, objetivos táctiles, reflow
equivalente a zoom 200 %/400 % y redimensionado de texto al 200 %. Los dos skips
evitan repetir en móvil/tablet el ciclo operativo largo que pasa en escritorio.
La lista siguiente sigue siendo una validación humana independiente sobre la
release desplegada; no consta como ejecutada por una persona o entidad externa.
La auditoría local final renovó, sin PII real, las capturas de
[público móvil](screenshots/anella-public-mobile-390x844.jpg),
[incidente en tablet](screenshots/anella-incident-tablet-768x1024.jpg) y
[coordinación en escritorio](screenshots/anella-coordination-desktop-1280x720.jpg).
No se atribuyen al run de CI ni al dominio temporal.

Por orden del usuario no se ha desplegado esta release en Hostinger y se
mantiene el dominio temporal. La aprobación real de la matriz PII y los valores
legales/privacidad del «punto 3» siguen diferidos; por eso ningún PASS de CI se
presenta como aprobación organizativa o de producción.

En al menos 390×844, 768×1024 y 1280×720:

1. Recorre login, navegación, cola, pestañas, filtros, formularios, confirmaciones
   y logout solo con teclado.
2. Comprueba foco visible, orden lógico, skip link, Escape en el menú móvil y que
   el foco vuelve al control que lo abrió.
3. Contrasta zoom 200 % y 400 %/reflow y texto al 200 % con los artefactos
   automatizados, sin controles cortados ni acciones ocultas.
4. Fuerza errores, éxito, conflicto optimista y estado vacío; los mensajes deben
   ser perceptibles, asociados y comprensibles.
5. Confirma nombres accesibles de marcadores y objetivos táctiles de 44×44 px.

La salida de Axe y el gate automatizado complementan esta revisión, pero no
permiten atribuir una aprobación humana externa que no se haya registrado.

## Evidencia y criterio de aprobación

Usa una fila por caso, sin secretos ni PII:

| Campo | Valor a registrar |
| --- | --- |
| Release | Commit completo y confirmación de árbol limpio |
| Entorno | URL, base desechable, versión de Node/motor SQL/navegador; en MariaDB, estado global y de sesión de `check_constraint_checks` |
| Caso | ID de este documento y actor/tenant usados |
| Esperado/observado | Resultado, estado HTTP visible y cambio persistido agregado |
| Evidencia | Test, captura redactada o log sin datos sensibles |
| Resultado | `PASS`, `FAIL` o `BLOCKED`, con incidencia enlazada |
| Ejecutor/fecha | Persona responsable y timestamp UTC |
| Aprobación PII | Responsable, versión aprobada de la matriz y fecha; sin PII ni secretos |

La matriz solo aprueba si todos los casos permitidos funcionan, todos los casos
denegados dejan la base sin cambios, no hay PII cruzada, no aparecen errores de
consola y el responsable ha aprobado la matriz de acceso. Un caso no ejecutado
o una aprobación externa ausente es `BLOCKED`, nunca `PASS`.

El estado honesto de cobertura automatizada y los gates pendientes se mantienen
en [Aceptación](ACCEPTANCE.md).
