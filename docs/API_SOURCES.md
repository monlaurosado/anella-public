# Fuentes externas de incendios

Las integraciones externas crean señales pendientes para la gestión interna y
publican automáticamente en el mapa una proyección cartográfica segura. Nunca
activan aportaciones, crean un punto de entrega ni publican una emergencia o un
aviso sin validación humana. El estado comunicado por un proveedor se
conserva aparte del estado de revisión de Anella (`PENDING`, `LINKED` o
`DISMISSED`); ese estado interno no bloquea la visualización pública.

No se promete tiempo real estricto. El sistema consulta las fuentes cada cinco
minutos por defecto, pero la frescura final depende del satélite o del organismo
que publica el parte.

## Fuentes automáticas activas

### NASA FIRMS: detección satelital nacional

El job consulta en paralelo cuatro productos públicos de huellas KMZ para Europa
de las últimas 24 horas:

- MODIS Terra/Aqua Collection 6.1.
- VIIRS NOAA-21 Collection 2.
- VIIRS NOAA-20 Collection 2.
- VIIRS Suomi-NPP Collection 2.

Referencias oficiales:

- [API KML Fire Footprints de NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/kml_fire_footprints/)
- [Descripción y latencia de VIIRS NRT](https://firms.modaps.eosdis.nasa.gov/descriptions/FIRMS_VIIRS_Firehotspots.html)

Cada ejecución limita descarga, descompresión, filas, antigüedad y ámbito
geográfico; valida el KML; deduplica mediante una identidad estable; asigna la
señal al municipio operativo más cercano cuando está dentro del radio
configurado; y crea un `ExternalDetection` con estado `PENDING`. Un lock MySQL
evita dos sincronizaciones simultáneas.

La geometría guardada es la huella del píxel del sensor, no el perímetro real
del incendio ni el área quemada. La interfaz la etiqueta como aproximación
satelital. Nubes, humo, hora de paso y falsos positivos impiden prometer tiempo
real estricto; NASA describe para su distribución global NRT una latencia que
puede alcanzar varias horas.

### Catálogo municipal nacional

La asignación y los filtros usan los 8.132 municipios del **Nomenclátor
Geográfico de Municipios y Entidades de Población 2026** del IGN/CNIG. Cada
registro conserva el nombre oficial, provincia, comunidad autónoma y coordenada
ETRS89/REGCAN95 compatible con WGS84, y usa un identificador estable derivado
del código INE de cinco cifras (`es-CCMMM`).

- [Descarga oficial del NGMEP](https://centrodedescargas.cnig.es/CentroDescargas/nomenclator-geografico-municipios-entidades-poblacion)
- [Relación oficial de municipios y códigos del INE](https://www.ine.es/dyngs/INEbase/operacion.htm?c=Estadistica_C&cid=1254736177031&idp=1254734710990&menu=ultiDatos)

El catálogo viaja en una migración reproducible para que una instalación nueva
no arranque con un municipio provisional. Para regenerarlo cuando se publique
una edición nueva, descarga el ZIP oficial y ejecuta
`npm run catalog:municipalities -- /ruta/BD_Municipios-Entidades.zip
prisma/migrations/AAAAMMDDHHMMSS_catalogo/migration.sql`, revisa el recuento y
confirma la migración fechada nueva. Si se omite el segundo argumento, se
regenera de forma determinista la migración de la edición 2026. Obra derivada
de NGMEP CC-BY 4.0 ign.es.

### Bombers de la Generalitat · Catalunya

La ingesta consulta directamente la capa pública que alimenta el visor oficial
de actuaciones de Bombers y publica los avisos de incendios de vegetación
forestal, agrícola y urbana. Conserva la fase comunicada (`Actiu`,
`Estabilitzat`, `Controlat` o `Extingit`) y usa `UNKNOWN` cuando la fuente aún no
ha comunicado una fase.

- [Visor oficial de actuaciones de Bombers](https://interior.gencat.cat/ca/arees_dactuacio/bombers/actuacions-de-bombers/)

La consulta usa una lista cerrada de identificador, fechas, tipo, municipio,
fase y geometría. Excluye de forma expresa el número de dotaciones, medios
movilizados y cualquier otra información táctica. El círculo discontinuo del
mapa solo generaliza la localización del aviso y nunca se presenta como
perímetro afectado.

### Junta de Castilla y León

La ingesta consulta el catálogo oficial de incendios forestales, toma solo el
parte diario más reciente y normaliza sus estados a `DECLARED`, `ACTIVE`,
`STABILIZED`, `CONTROLLED`, `EXTINGUISHED` o `UNKNOWN`.

- [Catálogo y API de incendios forestales de Castilla y León](https://analisis.datosabiertos.jcyl.es/explore/dataset/incendios-forestales/api/?flg=es)

El adaptador usa una lista cerrada de campos: fecha, hora, municipio, provincia,
nivel, situación y coordenada del incidente. No solicita ni guarda medios de
extinción u otra información táctica. Si el catálogo más reciente tiene más de
72 horas, la fuente se marca como fallida en vez de presentar el parte como
actual.

### Plan INFOCA · Andalucía

La ingesta consulta la capa pública que alimenta el visor oficial, incorporando
incendios forestales abiertos y los extinguidos en las últimas 48 horas. Los
estados oficiales se normalizan sin modificar el estado de revisión humana de
Anella.

- [Situación de incendios forestales del Plan INFOCA](https://www.juntadeandalucia.es/organismos/ema/areas/incendios-forestales/situacion/incendios-activos.html)

También aquí se usa una lista cerrada: identificador, fecha, hora, municipio,
provincia, tipo, estado y geometría. No se importan recursos movilizados,
ubicaciones de equipos ni datos personales.

### CCINIF / MITECO · cobertura estatal

La ingesta consulta el parte provisional de actuaciones diarias del Centro de
Coordinación de la Información Nacional sobre Incendios Forestales. Este parte
añade avisos de cualquier comunidad autónoma cuando intervienen medios del
MITECO y complementa tanto las fuentes autonómicas como la detección nacional
de NASA FIRMS.

- [Actuaciones diarias del MITECO](https://www.miteco.gob.es/es/biodiversidad/temas/incendios-forestales/estadisticas-actuaciones.html)

El PDF oficial se descarga y procesa con límites estrictos de tamaño, páginas y
texto. Solo se conserva la fecha de actualización, el municipio, la provincia y
el estado. La posición pública es el centro aproximado del municipio del
catálogo IGN, nunca un perímetro afectado. Se descartan expresamente medios,
dotaciones, bases, notas operativas y cualquier otro contenido táctico del
parte. La fuente no pretende enumerar por sí sola todos los incendios del país:
solo incluye aquellos para los que el MITECO comunica una actuación.

## Ejecución, frescura y degradación

El proceso Node persistente inicia un planificador mediante la convención
`instrumentation.ts` de Next.js: primera sincronización a los 30 segundos y
después cada `FIRE_INGESTION_INTERVAL_MINUTES` (cinco minutos por defecto). El
endpoint protegido `POST /api/internal/fire-detections/sync` permite una
ejecución manual o un cron externo de respaldo.

Cada fuente guarda únicamente salud agregada: último intento, último éxito,
fallo, duración y recuentos de recibidas, rechazadas, nuevas, actualizadas y
cambios de estado. Los mapas público y de coordinación refrescan cada minuto y
muestran cada fuente como al día, degradada, desactualizada o pendiente. Una
fuente caída no bloquea las demás; si fallan todas, el endpoint devuelve error
de upstream.

Los partes oficiales abiertos solo aparecen como actuales si la fuente se ha
visto dentro de una ventana de al menos 20 minutos. Un estado `EXTINGUISHED` se
mantiene 24 horas en el radar para que coordinación vea la transición. Las
señales pendientes siguen en la cola humana hasta que alguien las vincule o las
descarte. La administración global abre por defecto el radar y la cola de toda
España; el filtro municipal sirve para acotar la gestión, no para habilitar la
visibilidad nacional.

La importación Area CSV con `NASA_FIRMS_MAP_KEY` se conserva como herramienta
manual de coordinación. La ingesta automática usa KMZ y fuentes públicas y no
necesita esa clave.

## Fuentes evaluadas y no conectadas

Se revisó la agregación de [incendiosespaña.es](https://xn--incendiosespaa-2nb.es/)
como referencia funcional. Además de FIRMS, reúne fuentes autonómicas y muestra
capas tácticas. Anella no replica posiciones de bomberos, aeronaves, APRS,
LoRa/meshtastic ni ADS-B: no son necesarias para coordinar ayuda ciudadana y
contravendrían la frontera de seguridad del producto.

EFFIS aporta como capa opcional los polígonos de área quemada del año en curso.
No es una dependencia de la detección ni equivale a un estado operativo en
directo: puede tener días de latencia, una resolución limitada y omitir
incendios pequeños. La interfaz permite ocultarla y la identifica por separado
de las huellas térmicas y de los avisos oficiales. El navegador solicita sus
teselas mediante `/api/map/effis`: el proxy solo admite la capa y parámetros
WMS declarados, limita tamaño y tiempo de respuesta, cachea las imágenes y
devuelve una tesela transparente si EFFIS está temporalmente indisponible.

- [Datos y servicios de EFFIS](https://forest-fire.emergency.copernicus.eu/applications/data-and-services)
- [Instrucciones de descarga de EFFIS](https://forest-fire.emergency.copernicus.eu/downloads-instructions)
- [Rapid Damage Assessment de EFFIS](https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/rapid-damage-assessment)

INFOCAM/FIDIAS, 112 Comunitat Valenciana y otras fuentes autonómicas quedan
preparadas como siguientes adaptadores, pero solo deben activarse cuando exista
una API pública documentada o un acuerdo estable. No se añadirá scraping frágil
a una ruta crítica ni se confundirá una publicación en redes sociales con
validación oficial.

## Regla de publicación

`GET /api/fire-detections` es anónimo y devuelve exclusivamente la proyección
segura usada por el mapa: geometría publicada por la fuente, tipo de sensor,
proveedor, momento observado, municipio aproximado y estado/frescura agregados.
No incluye JSON bruto, relaciones internas, actores, recursos movilizados ni
coordenadas operativas de equipos.

La detección se visualiza automáticamente, también cuando sigue `PENDING` o no
ha podido asignarse a un municipio. Solo coordinación puede descartarla,
vincularla a un incidente o crear un borrador; esas acciones organizan la cola
interna y no son una aprobación previa del marcador. Publicar una emergencia,
un aviso o un punto de entrega conserva validación humana y, cuando procede,
generalización de la ubicación pública. Una solicitud legado puede seguir
publicándose como contexto, pero no es requisito para aportar.
