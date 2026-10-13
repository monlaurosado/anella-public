# Design QA — panel simplificado y zona segura

- Fuente seleccionada: `/Users/webpilots/.codex/generated_images/019f6a58-7502-7c50-b5a8-96a0c3e31bf5/exec-d170878d-8d49-4437-a24c-0e4607a88149.png`
- Implementación: `http://127.0.0.1:3100/coordinacion/incidentes/nuevo`
- Captura final: `/tmp/anella-option3-implemented-selected-final.jpg`
- Comparación conjunta: `/tmp/anella-design-qa-comparison-final.jpg`
- Comprobación enfocada de zona segura: `/tmp/anella-safe-point-picker-selected-final.jpg`
- Viewport principal: escritorio, 1440 × 1024 px
- Viewport responsive: móvil, 390 × 844 px
- Estado comparado: formulario abierto, ubicación seleccionada y radio visible

## Resultado visual

- Se conserva la estructura de la opción 3: navegación lateral, mapa dominante,
  formulario compacto superpuesto y acción fija al pie.
- El formulario limita los campos a municipio, título, prioridad y resumen
  opcional; el incendio queda fijado sin selector redundante.
- Tras seleccionar una ubicación, el mapa acerca el contexto sin animación y
  mantiene visible el círculo de 1,5 km de la ubicación interna.
- La zona segura se comprueba por separado a escala de edificio: empieza en
  30 m, admite de 10 a 200 m y el círculo cambia en el mapa al instante.
- En móvil no hay desbordamiento horizontal; formulario, mapa y acción mantienen
  el orden de lectura y objetivos táctiles de al menos 44 × 44 px.

## Historial de iteración

1. La primera captura dejaba el punto seleccionado a escala nacional.
2. Se añadió acercamiento contextual al seleccionar: zoom 11 para el incendio
   y zoom 17 para un edificio habilitado.
3. Se corrigieron el nombre accesible de «Usar centro» y el área táctil del
   control de radio; Axe WCAG 2.2 A/AA pasó en los tres viewports.

No quedan diferencias P0, P1 ni P2 respecto a la referencia. Las diferencias
menores —sin acción secundaria y con texto operativo real— corresponden a la
simplificación solicitada.

final result: passed
