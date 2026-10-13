# Modelo de amenazas

## Activos

- datos de contacto y consentimientos de aportaciones;
- credenciales y sesiones de coordinación;
- tokens privados de aportación y reclamación;
- coordenadas operativas, JSON de fuentes y auditoría;
- integridad de emergencias, puntos, avisos y estados de entrega;
- disponibilidad del mapa y de las colas operativas.

## Fronteras de confianza

1. navegador público ↔ rutas anónimas;
2. navegador autenticado ↔ Server Actions y DAL;
3. proveedores externos ↔ adaptadores de ingesta;
4. planificador ↔ base y outbox;
5. worker de notificaciones ↔ proveedor futuro;
6. aplicación ↔ MySQL/MariaDB y proxy del hosting.

## Amenazas y controles

### Suplantación y escalada

- Credenciales, sesión versionada, revocación y cambio forzado de contraseña.
- Roles y scope recalculados en servidor en cada lectura/escritura sensible.
- Coordinadores requieren entidad verificada, municipio y organización.
- Reclamación de entidad exige dominio configurado, email y revisión manual de
  superadministración; la aprobación no activa acceso por sí sola.

### Acceso cruzado entre tenants

- Consultas filtradas por rol, municipio, organización y municipios afectados.
- Identificadores enviados por el cliente nunca sustituyen el scope del DAL.
- Tests de autorización cubren lectura y mutación entre dos tenants.

### Falsificación de emergencias o avisos

- Una detección externa conserva identidad propia.
- Las candidatas automáticas quedan pendientes y sin proyección confirmada.
- Publicar emergencia, ubicación, punto o aviso exige acción humana auditada.
- Avisos rechazan coordenadas y expresiones tácticas.

### Exposición táctica

- DTO públicos mediante allowlist; sin `rawJson`, actores, medios ni posiciones
  de recursos.
- Coordenadas operativas separadas de coordenadas públicas generalizadas.
- Plantillas de outbox sin coordenadas.
- El mapa etiqueta huellas y círculos como aproximaciones, no perímetros.

### Robo o filtración de PII/tokens

- Contacto opcional y minimizado; consentimiento condicional.
- Cookies HttpOnly, Secure y SameSite=Strict.
- Token portable en fragmento, intercambio POST y limpieza de URL; nunca query.
- Hash de tokens y cifrado autenticado de reclamaciones.
- Errores/logs saneados; DTO y auditoría sin destinatarios ni contacto.
- Anonimización por expiración y redacción de outbox terminal.

### Spam, automatización y repetición

- Idempotency key vinculada al contenido.
- Rate limits por IP, punto/solicitud e identidad cuando existe.
- Honeypot configurable y obligatorio en producción mientras no se conecte un
  CAPTCHA alternativo.
- Límites de cuerpo, longitudes y parsing estricto.
- Outbox con clave única, cooldown, digest, lote, backoff y máximo de intentos.

### Condiciones de carrera

- Transacciones serializables y updates condicionales.
- Revisión optimista de aportaciones.
- Locks con nombre para ingesta, candidatas, retención y restore/preflight.
- Cantidad recibida monotónica; cierre bloqueado con operaciones pendientes.

### Dependencias y contenido externo

- CSP con nonce, `frame-ancestors 'none'`, cookies seguras y cabeceras de
  endurecimiento.
- Adaptadores con allowlist, límites de tamaño/tiempo/filas y degradación por
  fuente.
- Proxy EFFIS con parámetros cerrados y tesela transparente al fallar.
- Auditoría de dependencias obligatoria por release.

## Riesgos residuales y gates

- El honeypot reduce bots simples; un CAPTCHA accesible o control WAF puede ser
  necesario según abuso real.
- El proveedor de correo, rebotes y reputación no forman parte de esta entrega.
- OSM/EFFIS y fuentes oficiales tienen disponibilidad y latencia externas.
- El scope formal de acceso a PII y los plazos requieren aprobación del
  responsable legal real.
- La revisión humana visual, de teclado y operativa en el entorno desplegado no
  puede sustituirse por tests automáticos.

Ante duda, el sistema debe fallar cerrado: no publicar, no enviar y no ampliar
scope.
