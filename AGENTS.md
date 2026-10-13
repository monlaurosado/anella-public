<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Proyecto

Anella coordina ayuda ciudadana verificada durante emergencias. El MVP
empieza con incendios, pero el dominio debe mantenerse generico para inundaciones,
nevadas, busquedas u otros incidentes.

## Reglas de producto

- No enviar ciudadanos a zonas de riesgo.
- No publicar informacion tactica, ubicaciones de bomberos ni datos sensibles.
- Las APIs externas crean senales pendientes para gestion interna, pero su
  proyeccion cartografica no tactica se publica automaticamente.
- Las necesidades publicas siempre requieren validacion humana.
- Priorizar flujos moviles de pocas pulsaciones.

## Stack

- Next.js App Router
- TypeScript estricto
- Tailwind CSS
- Prisma 7 + MySQL
- Auth.js / NextAuth
- Leaflet + OpenStreetMap

## Convenciones

- Server Components por defecto.
- Client Components solo para mapa, formularios e interaccion.
- Mantener `src/services/incidents.ts` como frontera temporal entre UI y datos.
- Cuando se conecte MySQL, sustituir mocks por Prisma sin cambiar componentes.
