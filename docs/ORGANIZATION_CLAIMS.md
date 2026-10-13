# Reclamación de organizaciones

## Flujo

1. La persona abre el catálogo público en `/organizaciones`.
2. Selecciona una entidad precargada y facilita nombre y correo institucional.
3. Anella crea una reclamación `EMAIL_PENDING` y una notificación en outbox.
4. El enlace verifica únicamente la posesión del correo.
5. Si el dominio coincide con una entrada verificada de `OrganizationDomain`,
   la reclamación pasa a `PENDING_REVIEW`; si no, se rechaza el avance.
6. Un `SUPER_ADMIN` aprueba o rechaza con motivo.
7. La aprobación crea o vincula una cuenta limitada a entidad y municipio,
   inicialmente inactiva y con cambio de contraseña obligatorio.
8. La activación de la cuenta sigue el proceso administrativo existente.

## Garantías

- No existe autorregistro como coordinador.
- Un sufijo aparentemente público no es prueba suficiente: los dominios se
  configuran por entidad y se marcan como verificados.
- Email verificado no equivale a organización aprobada.
- Solo superadministración decide.
- Token aleatorio: hash SHA-256 para comparar y ciphertext AES-256-GCM para que
  el worker pueda construir el correo; nunca texto en claro.
- Reclamaciones duplicadas abiertas, expiradas o ya revisadas se rechazan.
- Solicitud, verificación, decisión y alta quedan en auditoría.
- Los datos se anonimizan al vencer `piiExpiresAt`.

## Operación

Antes de habilitar el catálogo público, cargar dominios desde una fuente
contractual o validación humana, comprobar el buzón de la entidad por un canal
independiente y documentar quién activa la cuenta. La aprobación no debe
automatizarse basándose solo en el dominio.
