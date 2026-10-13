# Privacidad y retención

## Datos ciudadanos

Una aportación puede registrarse sin nombre, teléfono ni correo. Si se facilita
alguno, se exige consentimiento explícito y se fija `piiExpiresAt` según
`PRIVACY_RETENTION_DAYS`. El consentimiento opcional de seguimiento se guarda
por separado y solo permite un agradecimiento o cierre relacionado con esa
emergencia; nunca marketing.

Los datos de contacto solo aparecen a personal autorizado dentro del scope de
la emergencia. No salen en DTO públicos, URLs, telemetría ni logs. La
cancelación usa una cookie privada; el código visible no autentica.

## Reclamaciones y outbox

Las reclamaciones contienen nombre y correo hasta su expiración operativa. El
mantenimiento los reemplaza por valores anónimos, elimina hash/ciphertext de
verificación y marca como expirada una solicitud abierta.

Los payloads terminales antiguos de notificación se reducen a metadatos no
personales. La auditoría conserva acción, actor interno, entidad, fecha y motivo
sin copiar destinatarios ni tokens.

## Mantenimiento

Ejecutar periódicamente:

```bash
npx dotenv -e .env -- npm run db:maintenance
```

El job usa lock de base, lotes acotados e idempotencia. Debe monitorizarse su
fecha de último éxito. En producción no debe ejecutarse desde una imagen con
variables de prueba ni junto al seed.

La página `/privacidad` obtiene responsable, base jurídica, encargado, contacto
y plazo desde variables obligatorias en producción. El despliegue se bloquea
si esos datos son ficticios o no han sido aprobados.
