# Roadmap

## Entregado en esta evolución

- Aportaciones directas a emergencia y punto, sin `needId` obligatorio.
- Solicitudes históricas conservadas como módulo legado.
- Categorías, origen, consentimientos separados y expiración de PII.
- Puntos de entrega con tipo, estado, entidad responsable y cierre seguro.
- Emergencias con origen, municipios afectados, avisos e historial.
- Agrupación espacial/temporal de señales en candidatas internas pendientes.
- Digest y outbox idempotente con cooldown, reintentos y simulacro.
- Reclamación de organizaciones con dominio configurado y revisión manual.
- Scopes de organización/municipio y auditoría de acciones sensibles.
- Navegación simplificada y recorrido público punto-primero.
- Marcadores por forma/icono/texto, accesibilidad del popup y minutos desde
  actualización.
- Migraciones aditivas, backfill y preflight ampliado.
- Tests unitarios, integración, migración y E2E de los recorridos nuevos.

## Antes de activar en producción

- Aprobación legal real de responsable, base, encargado, textos y retención.
- Revisión humana independiente de accesibilidad, teclado y móvil en el host.
- Validación de capacidad, backups del proveedor, RPO/RTO y alertas.
- Aprobación de uso/atribución y límites de OSM, EFFIS y cada fuente.
- Revisión de roles con acceso a PII y procedimiento de alta/activación.
- Configuración WAF o CAPTCHA accesible si el honeypot no basta frente al abuso.
- Proveedor de correo, plantillas, rebotes, opt-out operativo y apagado de
  emergencia; mantener entrega desactivada mientras falte cualquiera.
- Ensayo de migración sobre una copia reciente del entorno real.

## Siguiente iteración

- Panel de salud de outbox y fuentes con alertas operativas.
- Proveedor de notificaciones conectado detrás de la interfaz existente.
- Gestión de dominios institucionales con doble revisión y evidencias.
- Reasignación segura de aportaciones entre puntos del mismo scope.
- Cache distribuida e invalidación probada antes de escalar a varias réplicas.
- Adaptadores autonómicos adicionales solo con API oficial estable o acuerdo.
- Exportación auditada y minimizada para responsables de protección de datos.

## Fuera de alcance deliberado

- coordinación táctica de extinción;
- posiciones de bomberos, aeronaves o recursos;
- envío de voluntariado a la zona;
- confirmación automática de incendios;
- autorregistro de coordinadores;
- marketing a partir de correos ciudadanos;
- scraping frágil de redes sociales como fuente crítica.
