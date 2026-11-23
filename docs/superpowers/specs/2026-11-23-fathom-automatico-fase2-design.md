# Calls de Fathom que se bajan solas y alimentan la Fase 2 · diseño

Fecha: 2026-11-23 · Estado: borrador para revisión · Subproyecto 2 (se apoya en el 1: `2026-11-23-fathom-resumen-fase2-design.md` y su plan `docs/superpowers/plans/2026-11-23-fase2-fathom.md`, que hay que ejecutar antes).

## Objetivo

Que las calls de los clientes se bajen solas de Fathom a la app de Proyectos, queden vinculadas a su proyecto, y las de los proyectos **candidatos a Fase 2** se analicen automáticamente. Con todo ese contexto acumulado, cada proyecto muestra qué se dijo y cómo llevarlo a una Fase 2 (el plan del subproyecto 1), y el Recorrido avisa cuando una call nueva trae una señal de Fase 2 que nadie ofreció.

## Contexto (lo que hay hoy)

- `fathom-sync` corre **desde el navegador**: se dispara cada 5 minutos mientras alguien tiene abierta la pantalla de Calls (`src/InsightsApp.jsx`, `setInterval` en la vista de Calls). Si nadie la abre, no se baja nada.
- Ya hay un sync programado en el servidor como precedente: `mvp-sync` corre por `pg_cron` cada hora (`docs/migrations/2026-10-01-mvps.sql`).
- `fathom_calls` guarda solo metadata (título, fecha, `share_url`, tipo, `is_team`, cliente, proyecto, participantes externos). El resumen y la transcripción se quedan en Fathom.
- **Cada call lleva en el título el nombre del proyecto** (lo confirmó Nacho). `matchClientProject` en `fathom-sync` ya busca el nombre del proyecto dentro del título, así que el vínculo con el proyecto debería resolverse solo en casi todos los casos. Lo que no matchea queda con `project_id` vacío y se asigna a mano.
- Un punto débil del matcher actual: toma el **primer** proyecto cuyo nombre aparece en el título. Si un nombre contiene a otro (por ejemplo "Mi cupón" y "Mi cupón Pro"), puede asignar el equivocado.
- `fathom-sync` no valida `is_team()`: cualquier sesión autenticada puede invocarlo (ver Riesgos).
- `offerCandidates` (`src/lib/journey.js`) ya define candidatos a plan o Fase 2, pero depende del avance del plan calculado en el navegador.

## Decisiones tomadas

- **Se analizan automáticamente solo las calls de proyectos candidatos** (decisión de Nacho). El resto se guarda y se puede analizar a mano con el flujo del subproyecto 1.
- **Candidato a Fase 2** = proyecto vendible (no interno ni cancelado) en etapa `desarrollo`, `free` o `finalizado`, y sin Fase 2 aceptada o paga en `upsell`. La lista de etapas es una constante (`ETAPAS_CANDIDATAS`) para poder ajustarla sin tocar la lógica.
- Valores por defecto que se pueden cambiar al revisar: sync cada hora; hasta 5 análisis por corrida; texto mínimo de 400 caracteres para analizar; la transcripción completa solo la lee `is_team()` y el acceso `read` (Mati y Axel) ve únicamente el análisis.

## Alcance

Dentro:
1. Sync programado en el servidor (`pg_cron`, cada hora).
2. Vínculo más firme con el proyecto: el matcher elige el nombre de proyecto **más largo** que aparece en el título, y si el título nombra a dos proyectos distintos sin que uno contenga al otro, no asigna ninguno.
3. Guardar el contenido (resumen y transcripción) de las calls externas vinculadas a proyectos vendibles.
4. Análisis automático de las calls nuevas de proyectos candidatos, con tope por corrida y reintentos.
5. Bandeja de calls sin proyecto, como red de seguridad.
6. Marca "Habló de Fase 2" en el Recorrido/Oficina y en el panel del proyecto.

Fuera (etapas posteriores): aprender dominios de mail por cliente al asignar a mano; notificaciones por mail o WhatsApp; prellenar la propuesta; analizar calls de proyectos no candidatos de forma automática.

## 1. Sync en el servidor

- Migración que programa un job `pg_cron` cada hora que invoca `fathom-sync` con la acción `sync`, igual que `mvp-sync` (mismo mecanismo de `pg_net` y de secreto; se copia de `docs/migrations/2026-10-01-mvps.sql`).
- La pantalla de Calls mantiene el botón de sync manual y puede conservar el refresco de 5 minutos mientras está abierta, pero deja de ser la única fuente.
- `fathom-sync` pide `include_transcript=true` además del resumen que ya pide.

## 2. Vínculo con el proyecto

- `matchClientProject` se mueve a una función pura `proyectoDeLaCall(titulo, proyectos, cliente)` en `src/lib/fathomMatch.js` (la edge function la importa; hoy vive dentro de `index.ts` y no se puede testear):
  - Compara el título contra el nombre de cada proyecto sin distinguir mayúsculas ni tildes.
  - Entre los que aparecen, descarta los que están contenidos en el nombre de otro que también aparece, y se queda con el más largo.
  - Si quedan dos o más sin relación, no asigna (va a la bandeja).
  - Si no aparece ninguno, mantiene el comportamiento actual (empresa en el título o dominio de mail del cliente).
- Respeta, como hoy, lo asignado a mano: una call ya vinculada no se pisa en las corridas siguientes.

## 3. Contenido de las calls

Tabla nueva `public.fathom_call_contents` (migración propia con su ensayo):
- `call_id text primary key references public.fathom_calls(id) on delete cascade`, `resumen text`, `transcripcion text`, `tiene_transcripcion boolean`, `fetched_at timestamptz`.
- RLS activo y forzado: solo `is_team()` lee; sin escritura desde el cliente (escribe `fathom-sync` con service role). `anon` sin acceso.
- Se guarda solo para calls con `is_team = false` y con `project_id` de un proyecto vendible, con tope de 120.000 caracteres. Si una call se asigna a un proyecto después, el contenido se baja en la corrida siguiente.
- La limpieza de mails, teléfonos y claves (`limpiarTexto`, subproyecto 1) se aplica al mandar a la IA, no al guardar.

## 4. Análisis automático de candidatos

- `esCandidatoFase2(project)` (puro, en `src/lib/oportunidades.js` junto a `esVendible`; usa `projectStage` y `upsellState`) y `ETAPAS_CANDIDATAS`.
- Después de cada sync, la función toma las calls con contenido, vinculadas a un proyecto candidato, sin entrada en `project_fase2`. Crea la entrada con id determinístico `fc-<id de Fathom>` (idempotente: la misma call no se analiza dos veces), estado `analizando`, y la analiza con el mismo código del subproyecto 1 (`SISTEMA_CALL`, `normalizarAnalisis`).
- Tope de 5 análisis por corrida (el resto va en la siguiente); `intentos` por entrada, con máximo 3, y el error visible con "Probar de nuevo" como en el subproyecto 1.
- Función `definer` `fase2_crear_call_auto(p_id, p_project, p_data)` (solo service role) para crear la entrada sin pasar por el navegador.
- El plan del proyecto no se rehace solo: se marca "desactualizado" cuando entra una call nueva, como ya define el subproyecto 1.

## 5. Bandeja de calls sin proyecto

- En la pantalla de Calls, un bloque "Sin proyecto (N)" con las calls externas cuyo `project_id` está vacío: título, fecha, participantes externos y un selector de proyecto. Como los títulos llevan el nombre del proyecto, se espera que casi siempre esté vacío; sirve para los casos raros (título distinto, dos proyectos nombrados).
- Al asignar se guarda `project_id` y `client_id` en `fathom_calls` (ya es editable por el equipo) y la próxima corrida baja el contenido y, si el proyecto es candidato, la analiza.

## 6. Marca "Habló de Fase 2"

- Función pura `senalFase2(entradas, project)` en `src/lib/fase2.js`: verdadera si hay un análisis con algo en `implementar`, o señales de presupuesto o urgencia, de una call posterior a la última oferta de Fase 2 del proyecto, y la Fase 2 no está ofrecida, aceptada ni paga.
- Una marca en la tarjeta del proyecto del Recorrido/Oficina y en el panel, que lleva a la sección "Fase 2". Sin notificaciones externas en esta versión.

## Errores y pruebas

Errores:
- Una cuenta de Fathom que no responde no frena a las demás (ya es así); el error queda en el resultado del sync.
- Si la IA falla, la entrada queda en `error` con reintento; no se pierde el contenido bajado.
- Una call asignada a un proyecto no candidato se guarda y no se analiza.

Pruebas (`npm test`):
- `tests/fathom-match.test.js`: `proyectoDeLaCall` (nombre exacto, mayúsculas y tildes, un nombre dentro de otro elige el largo, dos proyectos sin relación no asigna, sin nombre cae a empresa o dominio, no pisa lo asignado a mano).
- `tests/fase2-auto.test.js`: `esCandidatoFase2` (etapas, interno, cancelado, Fase 2 cerrada), `senalFase2`, selección de calls a analizar (idempotencia por id, tope, texto mínimo, calls del equipo).
- Ensayo SQL de `fathom_call_contents` y de `fase2_crear_call_auto` (equipo lee, lector no lee el contenido, ajeno 0, anon bloqueado, función inaccesible para `authenticated`).
- Humo de `pg_cron`: una corrida a mano y verificar entradas creadas sin duplicados al repetirla.
- Navegador en modo local con calls y entradas sembradas: bandeja, marca en el Recorrido, a 1440 y 390, claro y oscuro.

## Riesgos y decisiones abiertas

- **Vínculo con el proyecto:** como los títulos llevan el nombre del proyecto, el riesgo es bajo. Quedan los casos de un nombre contenido en otro (cubierto por el matcher nuevo) y de títulos que no siguen la regla (bandeja). A confirmar: que el nombre en el título sea el mismo que el nombre del proyecto en la app.
- **Seguridad de `fathom-sync`:** hoy no valida `is_team()`. En este subproyecto se corrige: las acciones de usuario (`add_account`, `remove_account`, `list_accounts`, `sync`) exigen `is_team()`, y la acción del cron usa un secreto compartido guardado igual que el de `mvp-sync`.
- **Privacidad:** se concentra la transcripción de las calls de clientes en una tabla; queda solo para `is_team()`. A confirmar si Mati y Axel deben ver solo el análisis, como está definido.
- **Costo:** un análisis por call nueva de candidatos, con tope por corrida. Si el volumen real es alto, bajar el tope o analizar solo calls más largas.
- **A verificar con datos reales:** si la API de Fathom devuelve la transcripción (script de sondeo del plan 1) y cuántas calls externas hay por mes, para dimensionar costo.
