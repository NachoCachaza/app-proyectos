# Sección "Fase 2": link de Fathom → análisis y plan para el upsell · diseño

Fecha: 2026-11-23 · Estado: borrador para revisión · Reemplaza la versión del mismo día que usaba notas del servicio.

## Objetivo

Una sección propia **"Fase 2"** en cada proyecto donde Nacho:
1. Escribe notas libres sobre la Fase 2 del cliente.
2. Pega el **link de una call de Fathom** y el sistema baja la llamada, la resume y la "baja a tierra": insights, citas del cliente y todo lo que conviene saber para una posible Fase 2.
3. Recibe, a nivel proyecto, un **plan "Cómo llevarlo a Fase 2"** con ideas y recomendaciones para hacerlo de la manera más efectiva, que se rehace cada vez que suma una call o una nota.

La idea es seguir afinando la Fase 2 con cada call y proponerla como upsell.

## Contexto (lo que ya existe)

- `fathom_accounts` (API keys, solo service role) y `fathom_calls` (metadata: título, fecha, `share_url`, cliente, proyecto). `supabase/functions/fathom-sync` consulta `https://api.fathom.ai/external/v1/meetings` con `X-Api-Key` e `include_summary=true`. Hoy no guarda resumen ni transcripción.
- Oportunidades: `src/lib/oportunidades.js` (`armarContexto`, `MODELO`, esquema, prompt), edge function `oportunidades`, tabla por fila `project_opportunities`, flujo "La ofrecí" → tablero de Upsell de Speed Funnels. Desde el 19/11 la IA solo genera la categoría `mejora` ("Mejora para Fase 2").
- Patrón por fila de la app (`project_opportunities`, migración `2026-11-13-oportunidades.sql`): `id`, `data jsonb`, `updated_at`, `deleted_at`, `sync_at`, `project_id` generado, políticas con `pm_puede_ver()` y `is_team()`, funciones `definer` solo para service role.
- Notas del servicio (`project_service_notes`) quedan como están: tienen su propio tope de 8.000 caracteres y no se tocan.

## Alcance de esta versión

Dentro:
1. Sección "Fase 2" en el detalle del proyecto y en el panel del Recorrido/Oficina.
2. Notas libres de Fase 2.
3. Entrada por link de Fathom, resuelto contra las cuentas de Fathom ya conectadas; alternativa de pegar el texto si el link no se puede bajar.
4. Análisis por call.
5. Plan de proyecto "Cómo llevarlo a Fase 2".
6. "Pasar a oportunidad" desde los ítems del análisis y del plan.
7. Que "Buscar oportunidades" use el plan y los análisis.

Fuera (etapas posteriores):
- Prellenar la propuesta de Fase 2 (`Propuesta.jsx`).
- Alertas en el Recorrido ("habló de Fase 2 y no se ofreció").
- Cuentas de Fathom nuevas desde esta sección (se siguen cargando en "Cuentas de Fathom").
- Consolidar automáticamente ítems repetidos entre calls.
- Guardar objeciones en `project.upsell.objections` con un botón.

## 1. Datos

Migración nueva `docs/migrations/2026-11-23-fase2.sql` con su `.ensayo.sql` que la revierte y comprueba, mismo patrón que `project_opportunities`:

- Tabla `public.project_fase2`: `id text primary key`, `data jsonb`, `updated_at`, `deleted_at`, `sync_at` (trigger `tocar_sync_at`), `project_id text generated always as (data->>'projectId') stored`, índice parcial por proyecto donde `deleted_at is null`, publicada en `supabase_realtime`.
- RLS activo y forzado. `authenticated`: select, insert, update; sin delete (se borra con `deleted_at`). Lee quien cumple `pm_puede_ver_fase2()` (acceso completo y lectura) y escribe quien cumple `pm_puede_editar_fase2()` (acceso completo); las dos excluyen a cualquier miembro con rol developer aunque tenga acceso completo, porque `is_team()` mira el acceso y no el rol (decisión de Nacho: un developer no puede ver esta información). `service_role` con todo. `anon` sin acceso. Un cliente del portal no la lee.
- Funciones `definer` (`search_path=''`, execute solo `service_role`, sin `public`/`anon`/`authenticated`), únicas escrituras de la edge function:
  - `fase2_guardar_call(p_id, p_data)`: inserta o completa una entrada `call` (texto bajado y análisis).
  - `fase2_guardar_plan(p_project, p_plan)`: guarda el plan del proyecto.
  Ambas suben `updatedAt` por encima del anterior (mismo criterio que `oportunidad_sello`), para que un navegador con el reloj adelantado no ignore el resultado.

Forma de `data`:

```
// Nota libre
{ id, projectId, kind: 'nota', text, at, by, updatedAt, deletedAt }

// Call de Fathom
{ id, projectId, kind: 'call', at,                    // fecha de la call
  link,                                               // lo que pegó el usuario
  fathomId|null, titulo|null, origen: 'fathom'|'texto',
  texto,                                              // resumen y/o transcripción bajados (o pegados)
  estado: 'pendiente'|'bajando'|'analizando'|'lista'|'error', error|null,
  analisis: {
    version: 1, generadoAt, modelo,
    resumen,                                          // la llamada en pocas oraciones
    cargar:     [{ texto, cita }],                    // datos o contenido que faltan
    mejorar:    [{ texto, cita, oportunidadId|null }],
    implementar:[{ texto, cita, oportunidadId|null }],
    objeciones: [{ texto, cita }],
    senales:    [{ tipo: presupuesto|urgencia|decisor|fecha|otra, texto, cita }],
    pendientes: [{ texto, quien|null }]
  } | null,
  by, updatedAt, deletedAt }

// Plan del proyecto (una sola fila por proyecto)
{ id: 'plan-<projectId>', projectId, kind: 'plan', generadoAt, modelo, basadoEn: [ids de calls y notas],
  porQueAhora, queOfrecerPrimero: [{ titulo, razon, oportunidadId|null }],
  comoAbrirLaCharla, objecionesEsperadas: [{ objecion, respuesta }],
  antesDeOfrecer: [texto],                            // qué falta saber o cargar
  momento, riesgos: [texto], updatedAt }
```

Límites del normalizador: hasta 8 ítems por lista, `texto` hasta 240 caracteres, `cita` hasta 280; `texto` bajado hasta 120.000 caracteres (se recorta con aviso); notas libres hasta 8.000. Lo que no cumpla se descarta ítem por ítem; no se rechaza todo.

## 2. Pantalla

Sección "Fase 2" en el detalle del proyecto (debajo de Notas del servicio y de Oportunidades) y en el panel del Recorrido/Oficina:

- **Arriba, el plan** "Cómo llevarlo a Fase 2": por qué ahora, qué ofrecer primero (con "Pasar a oportunidad"), cómo abrir la charla, objeciones esperadas con su respuesta, qué falta antes de ofrecer, momento y riesgos. Se muestra con la fecha y de cuántas calls y notas se armó. Botón "Rehacer plan".
- **Una barra de entrada**: campo para pegar el link de Fathom y botón "Traer call"; al lado, "Nueva nota".
- **Línea de tiempo** de entradas (más reciente primero): notas y calls mezcladas.
  - Call: título, fecha, link; resumen; bloques Cargar / Mejorar / Implementar con citas; debajo objeciones, señales y pendientes. El texto bajado queda plegado.
  - Estados visibles por call: bajando, analizando, lista, error con "Probar de nuevo".
  - Si el link no se puede bajar: mensaje claro y opción "Pegar el texto de la call".
- **Skeleton dentro de la tarjeta**, nunca en toda la pantalla. El clic se refleja en el mismo frame (estado local que gana hasta que llega la fila), como en Oportunidades.
- Al sumar una call o nota nueva, el plan se marca "desactualizado" y se ofrece rehacerlo. No se rehace solo (cuesta una llamada a la IA).
- Permisos: el equipo escribe; el acceso `read` ve todo y no ve botones que modifiquen datos.
- Visual: mismos tokens, componentes y tonos que Oportunidades; claro y oscuro; en celular el detalle ocupa la pantalla.

## 3. Función y lógica

Módulo puro nuevo `src/lib/fase2.js` (sin dependencias de navegador, importable por la edge function como `oportunidades.js`): esquemas de respuesta (`ESQUEMA_CALL`, `ESQUEMA_PLAN`), prompts (`SISTEMA_CALL`, `SISTEMA_PLAN`), `normalizarEntrada`, `normalizarAnalisis`, `normalizarPlan`, `limpiarTexto` (quita mails, teléfonos, URLs con token y credenciales antes de ir a la IA), `resolverLink(url)` (valida host y forma del link de Fathom), `itemAOportunidad(item, { projectId, by, now })` idempotente por `oportunidadId`, `lineasFase2(entradas, { tope })` para el buscador de oportunidades.

Edge function nueva `fase2` (verify_jwt off; valida `is_team()` con el JWT de quien llama; lector o colaborador reciben 403). Mismas keys de Anthropic con respaldo y mismo `MODELO` que `oportunidades`. Acciones:

1. `analizar_call { proyecto, entrada }` (la pantalla ya creó la entrada: `bajando` con el link, o `analizando` con el texto pegado):
   - Lee la entrada con service role. Si `origen` es `fathom` y todavía no tiene texto, valida el link (`resolverLink`).
   - Busca la call por `share_url` en `fathom_calls`; si no está, consulta `meetings` de cada cuenta de `fathom_accounts` hasta encontrarla (el token nunca sale de la función).
   - Baja el resumen y, si la API lo ofrece, la transcripción; arma `texto`.
   - Asocia `fathom_calls.project_id` si estaba vacío (sin pisar una asignación manual).
   - Analiza con `SISTEMA_CALL` (texto limpiado) y guarda con `fase2_guardar_call`.
   - Si no encuentra la call: estado `error` con el motivo, y la UI ofrece pegar el texto.
2. El texto pegado no tiene acción aparte: `analizar_call` lo analiza sin consultar Fathom cuando la entrada ya trae `texto`.
3. `armar_plan { proyecto }`: lee las notas y los análisis del proyecto (sin transcripciones crudas), el contexto del proyecto vía `armarContexto` y las oportunidades previas (nuevas, ofrecidas, descartadas); genera el plan con `SISTEMA_PLAN` y lo guarda con `fase2_guardar_plan`.

Mismo manejo de error y salto a la key de respaldo que `oportunidades` (400 de saldo, 401, 403, 429). Despliegue: `supabase functions deploy fase2 --project-ref yzmtzyuncekspgtsetwk --use-api --no-verify-jwt --yes`.

`armarContexto` (en `oportunidades.js`) suma una sección "Fase 2" con el plan y los análisis más recientes, con tope de caracteres por entrada y total, para que "Buscar oportunidades" y "Volver a pensar" mejoren con cada call.

"Pasar a oportunidad": crea la oportunidad `mejora` (título del texto, `senal` = cita, `por_que` = texto, sin monto) por el camino que ya usa la app y guarda `oportunidadId` en el ítem. Antes revisa las oportunidades previas del proyecto para no duplicar un título casi igual.

## 4. Errores y pruebas

Errores:
- Link vacío o que no es de Fathom: se rechaza en el campo, sin crear nada.
- Call no encontrada en ninguna cuenta conectada, o Fathom responde error: la entrada queda en `error` con el motivo y la salida de pegar el texto. Nunca se pierde lo que escribiste.
- Falla la IA o la red: la entrada queda con su texto bajado y "Probar de nuevo".
- Respuesta de la IA mal formada: se descartan ítems inválidos; si no queda nada útil, es error.
- Un análisis o un plan existente no se pisa hasta que lo pidas ("Probar de nuevo", "Rehacer plan").
- Proyecto ajeno o entrada borrada: 403/404 sin revelar datos.

Pruebas (`npm test`, node --test):
- `tests/fase2.test.js`: `resolverLink`, `limpiarTexto`, normalizadores (límites, ítems inválidos, `version`), `itemAOportunidad` idempotente, `lineasFase2` con y sin plan, con tope.
- `tests/oportunidades.test.js`: `armarContexto` con la sección Fase 2.
- Ensayo SQL de `project_fase2`: equipo lee/crea/edita, lector lee y no escribe, ajeno 0 filas, anon 42501, sin DELETE, `fase2_guardar_*` inaccesibles para `authenticated`.
- Navegador en modo local (`app-proyectos-local`, puerto 5174, datos semilla, sin tocar producción ni gastar en la IA; entradas y plan de ejemplo sembrados en `localStorage`): traer call (estados), error con pegar texto, análisis, plan, "Pasar a oportunidad", a 1440 y 390, claro y oscuro.
- `npm run build` verde.

## Riesgos y decisiones abiertas

- **A verificar al empezar a implementar:** si el endpoint de reuniones de Fathom devuelve la transcripción completa o solo el resumen, y qué parámetro la pide. Se prueba con una llamada real y una cuenta cargada antes de escribir la función. Si solo hay resumen, el análisis se hace sobre el resumen de Fathom y el spec se ajusta.
- **Cobertura del link:** solo se pueden bajar calls de cuentas de Fathom cargadas en la app. Una call de otra cuenta exige pegar el texto.
- **Costo:** cada call es una llamada a `claude-opus-5-5`, y el plan otra. Ninguna se dispara sola.
- **Privacidad:** la transcripción queda en una tabla interna que leen el equipo y Mati/Axel (acceso lectura). Se limpia antes de ir a la IA. No viaja por `sf-puente` ni al portal.
- **Idioma:** Fathom puede traer calls en inglés; el análisis y el plan salen siempre en español.
