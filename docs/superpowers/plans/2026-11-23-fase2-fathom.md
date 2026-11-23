# Sección "Fase 2" (link de Fathom → análisis y plan para el upsell) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una sección "Fase 2" en cada proyecto donde se escriben notas, se pega un link de Fathom, se baja y analiza la call, y se arma un plan "Cómo llevarlo a Fase 2" que alimenta las oportunidades de upsell.

**Architecture:** Tabla por fila nueva `project_fase2` (mismo patrón que `project_opportunities`) con entradas `nota`, `call` y `plan`. Lógica pura en `src/lib/fase2.js` (sin red ni navegador), edge function nueva `fase2` que baja la call con las cuentas de `fathom_accounts` y llama a Claude, y una sección React `Fase2Section` montada en el detalle del proyecto y en el panel del Recorrido. `armarContexto` de oportunidades suma lo de Fase 2.

**Tech Stack:** React 18 + Vite, `node --test`, Supabase (Postgres + Edge Functions en Deno), `npm:@anthropic-ai/sdk@1.7.0`, modelo `MODELO` de `src/lib/oportunidades.js`.

**Spec:** `docs/superpowers/specs/2026-11-23-fathom-resumen-fase2-design.md` (leerlo antes de empezar).

## Global Constraints

- Repo y raíz de git: `/Users/nachocachaza/Downloads/app-proyectos-main`. Todos los comandos se corren desde esa carpeta.
- Tests: `npm test` (es `node --test "src/**/*.test.js" "tests/**/*.test.js"`). Build: `npm run build`. Los dos tienen que quedar en verde.
- Texto de la interfaz y de los prompts en español de Argentina (voseo), claro y sin tecnicismos.
- Modelo de IA: `MODELO` exportado por `src/lib/oportunidades.js` (`claude-opus-5-5`). Las keys son los secrets `ANTHROPIC_API_KEY` y `ANTHROPIC_API_KEY_RESPALDO`; el salto a la de respaldo ocurre con 400 de saldo, 401, 403 y 429.
- Límites: hasta 8 ítems por lista, `texto` de ítem hasta 240 caracteres, `cita` hasta 280; nota libre hasta 8.000; texto bajado de una call hasta 120.000; pegado a mano mínimo 200 caracteres.
- Categoría de lo que se pasa a oportunidad: siempre `mejora` (desde el 19/11 la IA solo propone mejoras para Fase 2).
- El token de Fathom nunca sale de la edge function. El texto de la call nunca viaja del navegador a la IA: la función lo lee de la base. Antes de ir a la IA se pasa por `limpiarTexto`.
- Sin DELETE físico: se borra con `deletedAt`/`deleted_at`. Escribe `is_team()`; lee `pm_puede_ver()`; el acceso `read` no ve botones que modifiquen datos.
- Visual: solo tokens y clases que ya usa la sección Oportunidades (`--card`, `--border`, `--accent`, etc.); claro y oscuro; sin scroll horizontal a 390 px.
- **No aplicar migraciones a producción, no desplegar funciones y no commitear sin que Nacho lo confirme en ese momento.** Los pasos "Commit" y "Desplegar" son propuestas: se piden antes de ejecutarlos.
- Proyecto de Supabase: `yzmtzyuncekspgtsetwk`. Despliegue: `supabase functions deploy fase2 --project-ref yzmtzyuncekspgtsetwk --use-api --no-verify-jwt --yes`.

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `scripts/fathom-probe.mjs` | Crear | Diagnóstico de solo lectura: qué devuelve la API de Fathom (transcripción sí/no) |
| `src/lib/fase2.js` | Crear | Lógica pura: links, limpieza, normalizadores, esquemas y prompts, vistas, ítem → oportunidad, contexto |
| `tests/fase2.test.js` | Crear | Tests de `fase2.js` |
| `src/lib/oportunidades.js` | Modificar | `armarContexto` acepta `fase2` y suma la sección |
| `tests/oportunidades.test.js` | Modificar | Test de la sección Fase 2 en el contexto |
| `docs/migrations/2026-11-23-fase2.sql` | Crear | Tabla, políticas, funciones `definer` |
| `docs/migrations/2026-11-23-fase2.ensayo.sql` | Crear | Ensayo de permisos (termina en `raise exception`, revierte todo) |
| `supabase/functions/fase2/index.ts` | Crear | Edge function: `analizar_call`, `armar_plan` |
| `supabase/functions/oportunidades/index.ts` | Modificar | Pasa las entradas de Fase 2 a `armarContexto` |
| `src/fase2/Fase2.jsx` | Crear | Sección React `Fase2Section` |
| `src/InsightsApp.jsx` | Modificar | `fase2Store`, contexto, montaje de la sección |
| `src/journey/ProjectPanel.jsx` | Modificar | Montaje compacto en el panel |
| `docs/PROGRESS.md` | Modificar | Entrada del cambio |

---

### Task 1: Sondeo de la API de Fathom

Averigua si el endpoint de reuniones devuelve la transcripción. No bloquea nada: `textoDeReunion` (Task 2) acepta ambos casos.

**Files:**
- Create: `scripts/fathom-probe.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: la decisión "hay transcripción / solo resumen", que se anota en `docs/PROGRESS.md` (Task 8).

- [ ] **Step 1: Crear el script**

```js
// Diagnóstico de solo lectura: qué forma tiene la respuesta de la API de Fathom.
// Uso:  FATHOM_API_KEY=... node scripts/fathom-probe.mjs
// No imprime contenido de las reuniones, sólo nombres de campos y tipos.
const key = process.env.FATHOM_API_KEY
if (!key) { console.error('Falta FATHOM_API_KEY en el entorno.'); process.exit(1) }

const url = new URL('https://api.fathom.ai/external/v1/meetings')
url.searchParams.set('include_summary', 'true')
url.searchParams.set('include_transcript', 'true')
url.searchParams.set('created_after', new Date(Date.now() - 30 * 86400000).toISOString())

const r = await fetch(url, { headers: { 'X-Api-Key': key } })
console.log('status', r.status)
if (!r.ok) { console.log((await r.text()).slice(0, 200)); process.exit(1) }

const data = await r.json()
const items = data.items || data.meetings || data.data || []
console.log('reuniones:', items.length, '· claves de la respuesta:', Object.keys(data))
const m = items[0]
if (!m) { console.log('Sin reuniones en los últimos 30 días.'); process.exit(0) }
console.log('claves de una reunión:', Object.keys(m))
console.log('share_url:', typeof m.share_url, '· url:', typeof m.url, '· recording_id:', typeof m.recording_id)
console.log('default_summary:', m.default_summary ? Object.keys(m.default_summary) : null)
const t = m.transcript
console.log('transcript:', Array.isArray(t) ? `array de ${t.length}, primera línea con claves ${t[0] ? Object.keys(t[0]) : '-'}` : typeof t)
```

- [ ] **Step 2: Correrlo con una key real (lo hace Nacho en su terminal, la key no se pega en el chat)**

Run: `FATHOM_API_KEY=<key de Fathom → Settings → API> node scripts/fathom-probe.mjs`
Expected: `status 200` y la lista de claves. Anotar si `transcript` aparece como `array` o como `undefined`.
- Si es `array`: el análisis usa transcripción + resumen.
- Si es `undefined`: el análisis usa solo el resumen; no hay que cambiar código.
- Si `share_url` y `url` salen `undefined`: avisar antes de seguir (la resolución del link de Task 6 depende de uno de los dos).

- [ ] **Step 3: Commit (pedir confirmación antes)**

```bash
git add scripts/fathom-probe.mjs
git commit -m "chore: script de sondeo de la API de Fathom (solo lectura)"
```

---

### Task 2: `fase2.js` — links, limpieza de texto y texto de la reunión

**Files:**
- Create: `src/lib/fase2.js`
- Create: `tests/fase2.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (todas exportadas desde `src/lib/fase2.js`):
  - Constantes: `MAX_NOTA = 8000`, `MAX_TEXTO_CALL = 120000`, `MIN_TEXTO_PEGADO = 200`, `MAX_ITEMS = 8`, `ESTADOS_CALL`.
  - `resolverLink(raw) → { ok: true, url, tipo: 'share'|'calls', clave } | { ok: false, error }`
  - `mismaCall(link, meeting) → boolean` (`link` es el resultado ok de `resolverLink`)
  - `limpiarTexto(texto) → string`
  - `textoDeReunion(meeting, { max? }) → { texto, recortado, tieneTranscripcion }`
  - `idNuevo() → string`

- [ ] **Step 1: Escribir los tests que fallan** (`tests/fase2.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverLink, mismaCall, limpiarTexto, textoDeReunion } from '../src/lib/fase2.js'

test('resolverLink acepta share y calls de fathom.video y normaliza el link', () => {
  const a = resolverLink('  https://fathom.video/share/AbC123?tab=summary#x ')
  assert.equal(a.ok, true)
  assert.equal(a.url, 'https://fathom.video/share/AbC123')
  assert.equal(a.tipo, 'share')
  assert.equal(a.clave, 'AbC123')
  const b = resolverLink('fathom.video/calls/98765/')
  assert.equal(b.ok, true)
  assert.equal(b.url, 'https://fathom.video/calls/98765')
  assert.equal(b.tipo, 'calls')
  assert.equal(b.clave, '98765')
  const c = resolverLink('https://www.fathom.video/share/h/tok_en')
  assert.equal(c.ok, true)
  assert.equal(c.url, 'https://fathom.video/share/h/tok_en')
  assert.equal(c.clave, 'tok_en')
})

test('resolverLink rechaza lo que no es una call de Fathom', () => {
  for (const malo of [
    '', '   ', 'https://evil.com/share/abc', 'https://fathom.video.evil.com/share/abc',
    'https://fathom.video/', 'https://fathom.video/share', 'https://fathom.video/pricing/abc',
    'javascript:alert(1)', 'no es un link', 'x'.repeat(600),
  ]) {
    const r = resolverLink(malo)
    assert.equal(r.ok, false, `debería rechazar: ${malo.slice(0, 40)}`)
    assert.ok(typeof r.error === 'string' && r.error.length > 0)
  }
  assert.equal(resolverLink(null).ok, false)
  assert.equal(resolverLink(undefined).ok, false)
})

test('mismaCall compara por la última parte del share_url / url o por el id de la grabación', () => {
  const share = resolverLink('https://fathom.video/share/AbC123')
  assert.equal(mismaCall(share, { share_url: 'https://fathom.video/share/AbC123' }), true)
  assert.equal(mismaCall(share, { url: 'https://fathom.video/share/AbC123/' }), true)
  assert.equal(mismaCall(share, { share_url: 'https://fathom.video/share/otra' }), false)
  const calls = resolverLink('https://fathom.video/calls/777')
  assert.equal(mismaCall(calls, { recording_id: 777 }), true)
  assert.equal(mismaCall(calls, { recording_id: 778, share_url: 'https://fathom.video/share/x' }), false)
  assert.equal(mismaCall({ ok: false }, { share_url: 'https://fathom.video/share/AbC123' }), false)
  assert.equal(mismaCall(share, null), false)
})

test('limpiarTexto saca mails, teléfonos, claves y contraseñas pero deja fechas y horas', () => {
  const s = limpiarTexto(
    'Escribile a eli@micupon.com o llamá al +54 11 5555 0101. Fue el 2026-11-23 a las 10:30. '
    + 'Contraseña: abc123 y la key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV. Mirá https://x.com/a?token=zzz999',
  )
  assert.ok(!s.includes('eli@micupon.com'))
  assert.ok(s.includes('[mail]'))
  assert.ok(!s.includes('5555'))
  assert.ok(s.includes('[tel]'))
  assert.ok(s.includes('2026-11-23'))
  assert.ok(s.includes('10:30'))
  assert.ok(!s.includes('abc123'))
  assert.ok(!s.includes('ABCDEFGH'))
  assert.ok(!s.includes('zzz999'))
  assert.equal(limpiarTexto(null), '')
})

test('textoDeReunion arma resumen y transcripción, y avisa cuando solo hay resumen', () => {
  const m = {
    default_summary: { markdown_formatted: '## Puntos\n- Quiere un panel' },
    transcript: [
      { speaker: { display_name: 'Eli' }, text: 'Necesito ver las ventas por comercio', timestamp: '00:01:10' },
      { speaker: { display_name: 'Nacho' }, text: '   ', timestamp: '00:01:20' },
      { text: 'Sin nombre', timestamp: '00:01:30' },
    ],
  }
  const r = textoDeReunion(m)
  assert.equal(r.tieneTranscripcion, true)
  assert.equal(r.recortado, false)
  assert.ok(r.texto.includes('# Resumen de Fathom'))
  assert.ok(r.texto.includes('[00:01:10] Eli: Necesito ver las ventas por comercio'))
  assert.ok(r.texto.includes('[00:01:30] Sin nombre'))
  assert.ok(!r.texto.includes('Nacho'))

  const s = textoDeReunion({ default_summary: { markdown_formatted: 'Solo resumen' } })
  assert.equal(s.tieneTranscripcion, false)
  assert.ok(s.texto.includes('Solo resumen'))

  const c = textoDeReunion({ transcript: 'x'.repeat(50) }, { max: 20 })
  assert.equal(c.texto.length, 20)
  assert.equal(c.recortado, true)

  assert.deepEqual(textoDeReunion(null), { texto: '', recortado: false, tieneTranscripcion: false })
})
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `node --test tests/fase2.test.js`
Expected: FAIL (`Cannot find module '../src/lib/fase2.js'`).

- [ ] **Step 3: Implementar** (`src/lib/fase2.js`)

```js
/*
 * Sección "Fase 2" del proyecto (spec 2026-11-23-fathom-resumen-fase2-design.md): notas libres y calls
 * de Fathom analizadas por la IA, más un plan "Cómo llevarlo a Fase 2".
 *
 * Puro, sin navegador ni red y con `now` inyectable: lo usan la sección del detalle del proyecto, la
 * edge function `fase2` y los tests (tests/fase2.test.js). No importa nada: oportunidades.js importa
 * de acá. Si cambia este archivo hay que redesplegar las funciones `fase2` y `oportunidades`.
 *
 * Al modelo no viajan mails, teléfonos, links con token, claves ni contraseñas (limpiarTexto).
 */

export const MAX_NOTA = 8000
export const MAX_TEXTO_CALL = 120000
export const MIN_TEXTO_PEGADO = 200
export const MAX_ITEMS = 8
export const ESTADOS_CALL = ['pendiente', 'bajando', 'analizando', 'lista', 'error']

const clip = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const txt = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const iso = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d.toISOString()
}
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s)
const idStr = (v) => (idOk(v) ? v : null)
const idLoose = (v) => (typeof v === 'string' && v ? v.slice(0, 80) : null)
const dia = (v) => { const t = iso(v); return t ? t.slice(0, 10) : null }

export const idNuevo = () => (globalThis.crypto && globalThis.crypto.randomUUID
  ? globalThis.crypto.randomUUID()
  : Math.random().toString(36).slice(2, 10) + Date.now().toString(36))

/* ─────────────────────────── Link de Fathom ─────────────────────────── */

export function resolverLink(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { ok: false, error: 'Pegá el link de la call de Fathom.' }
  if (s.length > 500) return { ok: false, error: 'Ese link es demasiado largo.' }
  let u
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return { ok: false, error: 'Ese link no se entiende.' } }
  const host = u.hostname.toLowerCase()
  if (host !== 'fathom.video' && !host.endsWith('.fathom.video')) return { ok: false, error: 'Tiene que ser un link de fathom.video.' }
  const partes = u.pathname.split('/').filter(Boolean)
  const tipo = partes[0]
  if ((tipo !== 'share' && tipo !== 'calls') || partes.length < 2) {
    return { ok: false, error: 'No parece el link de una call (fathom.video/share/… o fathom.video/calls/…).' }
  }
  return { ok: true, url: `https://fathom.video/${partes.join('/')}`, tipo, clave: partes[partes.length - 1] }
}

const ultimoTramo = (u) => {
  try { const p = new URL(u).pathname.split('/').filter(Boolean); return p[p.length - 1] || '' } catch { return '' }
}

export function mismaCall(link, m) {
  if (!link || link.ok !== true || !m || typeof m !== 'object') return false
  if (ultimoTramo(m.share_url) === link.clave || ultimoTramo(m.url) === link.clave) return true
  return link.tipo === 'calls' && String(m.recording_id ?? m.id ?? '') === link.clave
}

/* ───────────────────── Limpieza antes de ir a la IA ───────────────────── */

export function limpiarTexto(texto) {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[mail]')
    .replace(/https?:\/\/\S*[?&](?:token|key|secret|sig|signature|access_token|password)=\S*/gi, '[link]')
    .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, '[clave]')
    .replace(/\b(contraseña|password|clave|pass)\s*[:=]\s*\S+/gi, '$1: [oculto]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[tel]' : m))
}

/* ───────────────── Texto de una reunión de la API de Fathom ───────────────── */

export function textoDeReunion(m, { max = MAX_TEXTO_CALL } = {}) {
  const x = m && typeof m === 'object' ? m : {}
  const resumen = x.default_summary && typeof x.default_summary.markdown_formatted === 'string'
    ? x.default_summary.markdown_formatted.trim()
    : ''
  let trans = ''
  if (Array.isArray(x.transcript)) {
    trans = x.transcript.map((l) => {
      const t = l && typeof l.text === 'string' ? l.text.trim() : ''
      if (!t) return ''
      const quien = (l.speaker && (l.speaker.display_name || l.speaker.name)) || ''
      return `${l.timestamp ? `[${l.timestamp}] ` : ''}${quien ? `${quien}: ` : ''}${t}`
    }).filter(Boolean).join('\n')
  } else if (typeof x.transcript === 'string') {
    trans = x.transcript.trim()
  }
  const texto = [resumen && `# Resumen de Fathom\n${resumen}`, trans && `# Transcripción\n${trans}`].filter(Boolean).join('\n\n')
  return { texto: texto.slice(0, max), recortado: texto.length > max, tieneTranscripcion: !!trans }
}
```

- [ ] **Step 4: Correr los tests y ver que pasan**

Run: `node --test tests/fase2.test.js`
Expected: PASS (5 tests). Si falla el de `limpiarTexto` por el teléfono, revisar que la regla del teléfono corra DESPUÉS de las de mail, link, clave y contraseña (el orden del archivo es el correcto).

- [ ] **Step 5: Commit (pedir confirmación antes)**

```bash
git add src/lib/fase2.js tests/fase2.test.js
git commit -m "feat(fase2): links de Fathom, limpieza de texto y texto de la reunión"
```

---

### Task 3: `fase2.js` — normalizadores, esquemas y prompts

**Files:**
- Modify: `src/lib/fase2.js` (agregar al final)
- Modify: `tests/fase2.test.js` (agregar al final)

**Interfaces:**
- Consumes: helpers privados de Task 2 (`clip`, `txt`, `iso`, `idStr`, `idLoose`, `idOk`, `MAX_ITEMS`, `MAX_NOTA`, `MAX_TEXTO_CALL`, `ESTADOS_CALL`).
- Produces:
  - `normalizarAnalisis(a, { now?, modelo? }) → analisis | null` con `{ version: 1, generadaAt, modelo, resumen, cargar: [{texto,cita}], mejorar: [{texto,cita,oportunidadId}], implementar: [{texto,cita,oportunidadId}], objeciones: [{texto,cita}], senales: [{tipo,texto,cita}], pendientes: [{texto,quien}] }`
  - `normalizarPlan(p, { projectId?, basadoEn?, now?, modelo? }) → plan | null` con `{ id: 'plan-<projectId>', projectId, generadoAt, modelo, basadoEn: string[], porQueAhora, queOfrecerPrimero: [{titulo,razon,oportunidadId}], comoAbrirLaCharla, objecionesEsperadas: [{objecion,respuesta}], antesDeOfrecer: string[], momento, riesgos: string[] }`
  - `normalizarEntrada(e, { now? }) → entrada | null` (`kind` `nota` | `call` | `plan`)
  - `normalizarEntradaStore(e) → entrada` (nunca null: lo que no se entiende queda como nota vacía, que la vista filtra)
  - `ESQUEMA_CALL`, `ESQUEMA_PLAN`, `SISTEMA_CALL`, `SISTEMA_PLAN`

- [ ] **Step 1: Agregar los tests que fallan** (al final de `tests/fase2.test.js`)

```js
import {
  normalizarAnalisis, normalizarPlan, normalizarEntrada, normalizarEntradaStore,
  ESQUEMA_CALL, ESQUEMA_PLAN, SISTEMA_CALL, SISTEMA_PLAN, MAX_ITEMS,
} from '../src/lib/fase2.js'

const NOW = new Date('2026-11-23T15:00:00.000Z')

test('normalizarAnalisis recorta, descarta lo inválido y devuelve null si no queda nada', () => {
  const muchos = Array.from({ length: 12 }, (_, i) => ({ texto: `Idea ${i}`, cita: 'x'.repeat(400) }))
  const a = normalizarAnalisis({
    resumen: '  Quiere ver ventas por comercio.  ',
    cargar: [{ texto: 'Logo en alta', cita: '' }, { texto: '   ', cita: 'vacío' }, null, 'suelto'],
    mejorar: muchos,
    implementar: [{ texto: 'Panel de ventas', cita: 'Necesito ver las ventas', oportunidadId: 'op1' }],
    objeciones: [{ texto: 'Espera al lanzamiento', cita: '' }],
    senales: [{ tipo: 'presupuesto', texto: 'Tiene USD 3000', cita: '' }, { tipo: 'inventado', texto: 'Otra', cita: '' }],
    pendientes: [{ texto: 'Mandar el logo', quien: 'Eli' }, { texto: 'Revisar', quien: 5 }],
  }, { now: NOW, modelo: 'claude-opus-5-5' })
  assert.equal(a.version, 1)
  assert.equal(a.generadaAt, NOW.toISOString())
  assert.equal(a.modelo, 'claude-opus-5-5')
  assert.equal(a.resumen, 'Quiere ver ventas por comercio.')
  assert.deepEqual(a.cargar, [{ texto: 'Logo en alta', cita: '' }])
  assert.equal(a.mejorar.length, MAX_ITEMS)
  assert.equal(a.mejorar[0].cita.length, 280)
  assert.equal(a.mejorar[0].oportunidadId, null)
  assert.equal(a.implementar[0].oportunidadId, 'op1')
  assert.deepEqual(a.senales.map((s) => s.tipo), ['presupuesto', 'otra'])
  assert.deepEqual(a.pendientes, [{ texto: 'Mandar el logo', quien: 'Eli' }, { texto: 'Revisar', quien: null }])
  assert.equal(normalizarAnalisis({ resumen: '', cargar: [] }, { now: NOW }), null)
  assert.equal(normalizarAnalisis('basura'), null)
})

test('normalizarAnalisis conserva generadaAt y modelo ya guardados', () => {
  const a = normalizarAnalisis({ resumen: 'Algo', generadaAt: '2026-11-20T10:00:00Z', modelo: 'otro-modelo' }, { now: NOW, modelo: 'nuevo' })
  assert.equal(a.generadaAt, '2026-11-20T10:00:00.000Z')
  assert.equal(a.modelo, 'otro-modelo')
})

test('normalizarPlan arma el id por proyecto, recorta y devuelve null si no hay nada útil', () => {
  const p = normalizarPlan({
    porQueAhora: '  Terminó el MVP y ya vende.  ',
    queOfrecerPrimero: [
      { titulo: 'Panel de ventas', razon: 'Lo pidió dos veces' },
      { titulo: '   ', razon: 'sin título' },
      ...Array.from({ length: 8 }, (_, i) => ({ titulo: `Extra ${i}`, razon: '' })),
    ],
    comoAbrirLaCharla: 'Contale lo que vimos en su panel',
    objecionesEsperadas: [{ objecion: 'Es caro', respuesta: 'Se paga con lo que ahorra' }, { objecion: '', respuesta: 'x' }],
    antesDeOfrecer: ['Confirmar presupuesto', '  ', 'Ver quién decide'],
    momento: 'Después del lanzamiento',
    riesgos: ['Se enfría si esperamos'],
  }, { projectId: 'p1', basadoEn: ['n1', 'c1', 'mal id!'], now: NOW, modelo: 'm' })
  assert.equal(p.id, 'plan-p1')
  assert.equal(p.projectId, 'p1')
  assert.equal(p.generadoAt, NOW.toISOString())
  assert.deepEqual(p.basadoEn, ['n1', 'c1'])
  assert.equal(p.porQueAhora, 'Terminó el MVP y ya vende.')
  assert.equal(p.queOfrecerPrimero.length, 5)
  assert.deepEqual(p.queOfrecerPrimero[0], { titulo: 'Panel de ventas', razon: 'Lo pidió dos veces', oportunidadId: null })
  assert.deepEqual(p.objecionesEsperadas, [{ objecion: 'Es caro', respuesta: 'Se paga con lo que ahorra' }])
  assert.deepEqual(p.antesDeOfrecer, ['Confirmar presupuesto', 'Ver quién decide'])
  assert.equal(normalizarPlan({ porQueAhora: '', queOfrecerPrimero: [] }, { projectId: 'p1', now: NOW }), null)
  assert.equal(normalizarPlan(null), null)
})

test('normalizarEntrada reconoce nota, call y plan; normalizarEntradaStore nunca devuelve null', () => {
  const n = normalizarEntrada({ id: 'n1', projectId: 'p1', kind: 'nota', text: '  Quiere app móvil  ', at: '2026-11-20T10:00:00Z', by: 'u1' })
  assert.equal(n.text, 'Quiere app móvil')
  assert.equal(n.updatedAt, '2026-11-20T10:00:00.000Z')
  assert.equal(normalizarEntrada({ id: 'n2', projectId: 'p1', kind: 'nota', text: '   ' }), null)

  const c = normalizarEntrada({ id: 'c1', projectId: 'p1', kind: 'call', link: 'https://fathom.video/share/abc', estado: 'rarísimo', origen: 'texto', texto: 'hola' })
  assert.equal(c.estado, 'pendiente')
  assert.equal(c.origen, 'texto')
  assert.equal(c.analisis, null)
  assert.equal(c.error, null)

  const p = normalizarEntrada({ kind: 'plan', projectId: 'p1', porQueAhora: 'Terminó el MVP', id: 'plan-p1' })
  assert.equal(p.kind, 'plan')
  assert.equal(p.id, 'plan-p1')
  assert.equal(normalizarEntrada({ kind: 'otra' }), null)

  for (const raro of [null, undefined, 5, {}, { kind: 'nota', text: '' }, { kind: 'plan' }]) {
    const x = normalizarEntradaStore(raro)
    assert.ok(x && typeof x === 'object')
    assert.equal(x.deletedAt, null)
  }
  assert.equal(normalizarEntradaStore({ id: 'n1', projectId: 'p1', kind: 'nota', text: 'ok' }).text, 'ok')
})

test('los esquemas piden todo y los prompts explican las tres listas', () => {
  for (const e of [ESQUEMA_CALL, ESQUEMA_PLAN]) {
    assert.equal(e.additionalProperties, false)
    assert.deepEqual([...e.required].sort(), Object.keys(e.properties).sort())
  }
  for (const k of ['cargar', 'mejorar', 'implementar', 'cita']) assert.ok(SISTEMA_CALL.includes(k), k)
  assert.ok(SISTEMA_PLAN.includes('Fase 2'))
  assert.ok(SISTEMA_PLAN.includes('queOfrecerPrimero'))
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `node --test tests/fase2.test.js`
Expected: FAIL (los imports nuevos no existen).

- [ ] **Step 3: Implementar** (agregar al final de `src/lib/fase2.js`)

```js
/* ─────────────────────────── Normalizadores ─────────────────────────── */

const TIPOS_SENAL = ['presupuesto', 'urgencia', 'decisor', 'fecha', 'otra']

const itemsCT = (arr, conOportunidad) => (Array.isArray(arr) ? arr : [])
  .map((i) => {
    if (!i || typeof i !== 'object') return null
    const texto = clip(i.texto, 240)
    if (!texto) return null
    const out = { texto, cita: clip(i.cita, 280) }
    if (conOportunidad) out.oportunidadId = idStr(i.oportunidadId)
    return out
  })
  .filter(Boolean)
  .slice(0, MAX_ITEMS)

const LISTAS = ['cargar', 'mejorar', 'implementar', 'objeciones', 'senales', 'pendientes']

export function normalizarAnalisis(a, { now = new Date(), modelo = null } = {}) {
  if (!a || typeof a !== 'object') return null
  const out = {
    version: 1,
    generadaAt: iso(a.generadaAt) || iso(now),
    modelo: clip(a.modelo, 80) || modelo,
    resumen: clip(a.resumen, 900),
    cargar: itemsCT(a.cargar, false),
    mejorar: itemsCT(a.mejorar, true),
    implementar: itemsCT(a.implementar, true),
    objeciones: itemsCT(a.objeciones, false),
    senales: (Array.isArray(a.senales) ? a.senales : [])
      .map((s) => {
        if (!s || typeof s !== 'object') return null
        const texto = clip(s.texto, 240)
        if (!texto) return null
        return { tipo: TIPOS_SENAL.includes(s.tipo) ? s.tipo : 'otra', texto, cita: clip(s.cita, 280) }
      })
      .filter(Boolean)
      .slice(0, MAX_ITEMS),
    pendientes: (Array.isArray(a.pendientes) ? a.pendientes : [])
      .map((p) => {
        if (!p || typeof p !== 'object') return null
        const texto = clip(p.texto, 240)
        return texto ? { texto, quien: clip(p.quien, 80) || null } : null
      })
      .filter(Boolean)
      .slice(0, MAX_ITEMS),
  }
  return !out.resumen && !LISTAS.some((k) => out[k].length) ? null : out
}

const lista = (arr, max, f) => (Array.isArray(arr) ? arr : []).map(f).filter(Boolean).slice(0, max)

export function normalizarPlan(p, { projectId = null, basadoEn = null, now = new Date(), modelo = null } = {}) {
  if (!p || typeof p !== 'object') return null
  const proyecto = projectId || idStr(p.projectId)
  const base = Array.isArray(basadoEn) ? basadoEn : Array.isArray(p.basadoEn) ? p.basadoEn : []
  const out = {
    id: proyecto ? `plan-${proyecto}` : idStr(p.id),
    projectId: proyecto,
    generadoAt: iso(p.generadoAt) || iso(now),
    modelo: clip(p.modelo, 80) || modelo,
    basadoEn: base.filter(idOk).slice(0, 200),
    porQueAhora: clip(p.porQueAhora, 700),
    queOfrecerPrimero: lista(p.queOfrecerPrimero, 5, (i) => (i && typeof i === 'object' && clip(i.titulo, 120)
      ? { titulo: clip(i.titulo, 120), razon: clip(i.razon, 400), oportunidadId: idStr(i.oportunidadId) }
      : null)),
    comoAbrirLaCharla: clip(p.comoAbrirLaCharla, 500),
    objecionesEsperadas: lista(p.objecionesEsperadas, 6, (i) => (i && typeof i === 'object' && clip(i.objecion, 200)
      ? { objecion: clip(i.objecion, 200), respuesta: clip(i.respuesta, 400) }
      : null)),
    antesDeOfrecer: lista(p.antesDeOfrecer, 8, (s) => clip(s, 240) || null),
    momento: clip(p.momento, 300),
    riesgos: lista(p.riesgos, 6, (s) => clip(s, 240) || null),
  }
  return out.porQueAhora || out.queOfrecerPrimero.length ? out : null
}

export function normalizarEntrada(e, { now = new Date() } = {}) {
  if (!e || typeof e !== 'object') return null
  const kind = ['nota', 'call', 'plan'].includes(e.kind) ? e.kind : null
  if (!kind) return null
  const at = iso(e.at)
  const base = {
    id: idStr(e.id), projectId: idStr(e.projectId), kind, at, by: idLoose(e.by),
    updatedAt: iso(e.updatedAt) || at, deletedAt: iso(e.deletedAt),
  }
  if (kind === 'nota') {
    const text = txt(e.text, MAX_NOTA)
    return text ? { ...base, text } : null
  }
  if (kind === 'call') {
    return {
      ...base,
      link: clip(e.link, 500),
      fathomId: idLoose(e.fathomId),
      titulo: clip(e.titulo, 160) || null,
      origen: e.origen === 'texto' ? 'texto' : 'fathom',
      texto: txt(e.texto, MAX_TEXTO_CALL),
      estado: ESTADOS_CALL.includes(e.estado) ? e.estado : 'pendiente',
      error: clip(e.error, 300) || null,
      analisis: normalizarAnalisis(e.analisis, { now }),
    }
  }
  const plan = normalizarPlan(e, { projectId: base.projectId, now })
  return plan ? { ...base, ...plan, kind: 'plan' } : null
}

/* Para el store por fila: `normalize` nunca puede devolver null. Lo que no se entiende queda como
 * una nota vacía, que las vistas descartan. */
export function normalizarEntradaStore(e) {
  return normalizarEntrada(e) || {
    id: idStr(e && e.id), projectId: idStr(e && e.projectId), kind: 'nota', text: '',
    at: iso(e && e.at), by: null, updatedAt: iso(e && e.updatedAt), deletedAt: iso(e && e.deletedAt),
  }
}

/* ───────────────────── Esquemas de respuesta de la IA ───────────────────── */

const ITEM_CT = {
  type: 'object',
  additionalProperties: false,
  required: ['texto', 'cita'],
  properties: {
    texto: { type: 'string', description: 'Qué es, en una oración concreta (hasta 240 caracteres).' },
    cita: { type: 'string', description: 'Frase corta del cliente que lo sostiene, en español. Vacía si no hay una clara.' },
  },
}

export const ESQUEMA_CALL = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'cargar', 'mejorar', 'implementar', 'objeciones', 'senales', 'pendientes'],
  properties: {
    resumen: { type: 'string', description: 'La llamada en 3 a 5 oraciones, lo importante para el negocio.' },
    cargar: { type: 'array', items: ITEM_CT },
    mejorar: { type: 'array', items: ITEM_CT },
    implementar: { type: 'array', items: ITEM_CT },
    objeciones: { type: 'array', items: ITEM_CT },
    senales: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'texto', 'cita'],
        properties: {
          tipo: { type: 'string', enum: TIPOS_SENAL },
          texto: { type: 'string' },
          cita: { type: 'string' },
        },
      },
    },
    pendientes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['texto', 'quien'],
        properties: {
          texto: { type: 'string' },
          quien: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Quién se comprometió, o null.' },
        },
      },
    },
  },
}

export const ESQUEMA_PLAN = {
  type: 'object',
  additionalProperties: false,
  required: ['porQueAhora', 'queOfrecerPrimero', 'comoAbrirLaCharla', 'objecionesEsperadas', 'antesDeOfrecer', 'momento', 'riesgos'],
  properties: {
    porQueAhora: { type: 'string', description: 'Por qué este cliente está listo para una Fase 2 ahora, en 2 o 3 oraciones.' },
    queOfrecerPrimero: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'razon'],
        properties: {
          titulo: { type: 'string', description: 'Qué se ofrece, en pocas palabras (hasta 70 caracteres).' },
          razon: { type: 'string', description: 'Por qué va primero, apoyado en lo que dijo el cliente.' },
        },
      },
    },
    comoAbrirLaCharla: { type: 'string', description: 'Cómo abrir la conversación, en 2 o 3 oraciones, rioplatense y cálido.' },
    objecionesEsperadas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['objecion', 'respuesta'],
        properties: { objecion: { type: 'string' }, respuesta: { type: 'string' } },
      },
    },
    antesDeOfrecer: { type: 'array', items: { type: 'string' }, description: 'Qué falta saber o cargar antes de ofrecer.' },
    momento: { type: 'string', description: 'Cuándo conviene ofrecerlo y por qué.' },
    riesgos: { type: 'array', items: { type: 'string' } },
  },
}

/* ─────────────────────────────── Prompts ─────────────────────────────── */

export const SISTEMA_CALL = `Sos parte del equipo de Insights, una agencia que construye apps y sistemas a medida para dueños de negocio. Te pasamos una llamada con un cliente que ya nos compró (el resumen de Fathom y, si hay, la transcripción) y lo que sabemos de su proyecto. Tu trabajo es bajarla a tierra: qué se dijo y qué podemos hacer con eso para una Fase 2.

Cómo hacerlo:
- resumen: la llamada en 3 a 5 oraciones, lo que importa para el negocio.
- cargar: datos o contenido que el cliente tiene que darnos, o que falta cargar en el proyecto, para poder avanzar (textos, fotos, accesos, listados).
- mejorar: algo que ya existe en el producto y se puede pulir o ampliar según lo que dijo.
- implementar: cosas nuevas que pidió o que la charla deja a la vista, y que serían una Fase 2.
- objeciones: dudas, frenos o reparos que mostró (plata, tiempo, confianza, prioridad).
- senales: señales de compra (presupuesto, urgencia, quién decide, fechas). tipo es uno de: presupuesto, urgencia, decisor, fecha, otra.
- pendientes: compromisos que quedaron de la call, de ellos o nuestros. quien es el nombre o null.
- cita: una frase del cliente, corta, que sostiene el ítem. Si no hay una frase clara, dejala vacía. No inventes citas.
- Todo sale de lo que se dijo. Si algo no está en la llamada, no lo propongas. Si una lista no tiene nada, devolvela vacía.
- No repitas lo que el proyecto ya tiene hecho.
- Escribí en español de Argentina, claro y sin tecnicismos, aunque la llamada sea en inglés: las citas van traducidas.
- Ignorá los datos marcados como [mail], [tel], [link] o [clave].`

export const SISTEMA_PLAN = `Sos parte del equipo de Insights, una agencia que construye apps y sistemas a medida para dueños de negocio. Te pasamos todo lo que sabemos de un proyecto de un cliente que ya nos compró, incluyendo las calls y las notas de Fase 2 (sección "Fase 2: calls y notas con el cliente"). Tenés que armar el plan para llevar ese proyecto a una Fase 2 de la manera más efectiva.

Cómo pensarlo:
- porQueAhora: por qué este cliente está listo ahora, apoyado en datos concretos de las calls y del proyecto.
- queOfrecerPrimero: de 1 a 4 cosas, en orden. Cada una sale de algo que el cliente dijo o que el proyecto deja a la vista. Si no hay un dato que la sostenga, no la propongas. Solo mejoras para una Fase 2 de lo que ya construimos: nada de planes de mantenimiento, marketing, ciberseguridad ni sistemas nuevos.
- comoAbrirLaCharla: cómo abrir la conversación con él, rioplatense, cálido, corto, sin signos de apertura (nada de ¿ ni ¡), sin sonar a vendedor y sin prometer plazos ni precios.
- objecionesEsperadas: las que ya mostró o las que se ven venir, cada una con una respuesta honesta.
- antesDeOfrecer: lo que falta saber o cargar antes de ofrecer.
- momento: cuándo conviene ofrecerlo y por qué.
- riesgos: lo que puede hacer que se enfríe o se pierda.
- No repitas lo que ya se le ofreció ni lo que el equipo descartó: está en la sección "Ya ofrecido o descartado".
- Escribí todo en español de Argentina, claro y sin tecnicismos innecesarios.`
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `node --test tests/fase2.test.js`
Expected: PASS (10 tests en total).

- [ ] **Step 5: Commit (pedir confirmación antes)**

```bash
git add src/lib/fase2.js tests/fase2.test.js
git commit -m "feat(fase2): normalizadores, esquemas de respuesta y prompts"
```

---

### Task 4: `fase2.js` — entradas, vista, ítem → oportunidad y contexto; integración con `armarContexto`

**Files:**
- Modify: `src/lib/fase2.js` (agregar al final)
- Modify: `tests/fase2.test.js` (agregar al final)
- Modify: `src/lib/oportunidades.js` (import en la línea 19 y `armarContexto`, líneas 102 y 164-167)
- Modify: `tests/oportunidades.test.js` (agregar un test al final)

**Interfaces:**
- Consumes: `normalizarEntradaStore`, `normalizarAnalisis`, `idNuevo`, helpers privados de Task 2.
- Produces (exportadas desde `fase2.js`):
  - `nuevaNota({ projectId, text, by, now?, nuevoId? }) → entrada nota`
  - `nuevaCall({ projectId, link?, texto?, by, now?, nuevoId? }) → entrada call` (`estado: 'bajando'` con link, `'analizando'` con texto; `origen` `'fathom'` o `'texto'`)
  - `marcarBorrada(entrada, now?) → entrada`
  - `vincularItem(entrada, lista, indice, oportunidadId) → entrada` (`lista`: `'mejorar'`/`'implementar'` en una call, `'queOfrecerPrimero'` en un plan)
  - `itemAOportunidad(item, { projectId, by?, now?, nuevoId?, frase? }) → objeto oportunidad (sin normalizar)`
  - `hayParecida(titulo, previas) → boolean`
  - `entradasParaPlan(entradas) → entrada[]`
  - `vistaFase2(items, projectId) → { plan, entradas, elegibles, planDesactualizado }`
  - `lineasFase2(items, { tope? }) → string[]`
- En `oportunidades.js`: `armarContexto({ ..., fase2 = [] })` suma la sección `## Fase 2: calls y notas con el cliente`.

- [ ] **Step 1: Agregar los tests que fallan** (al final de `tests/fase2.test.js`)

```js
import {
  nuevaNota, nuevaCall, marcarBorrada, vincularItem, itemAOportunidad, hayParecida,
  entradasParaPlan, vistaFase2, lineasFase2,
} from '../src/lib/fase2.js'

test('nuevaNota y nuevaCall arman entradas listas para guardar', () => {
  const n = nuevaNota({ projectId: 'p1', text: '  Quiere app móvil  ', by: 'u1', now: NOW, nuevoId: () => 'n-1' })
  assert.deepEqual(n, {
    id: 'n-1', projectId: 'p1', kind: 'nota', text: 'Quiere app móvil',
    at: NOW.toISOString(), by: 'u1', updatedAt: NOW.toISOString(), deletedAt: null,
  })
  const c = nuevaCall({ projectId: 'p1', link: 'https://fathom.video/share/abc', by: 'u1', now: NOW, nuevoId: () => 'c-1' })
  assert.equal(c.kind, 'call')
  assert.equal(c.estado, 'bajando')
  assert.equal(c.origen, 'fathom')
  assert.equal(c.texto, '')
  assert.equal(c.analisis, null)
  const t = nuevaCall({ projectId: 'p1', texto: 'a'.repeat(300), by: 'u1', now: NOW, nuevoId: () => 'c-2' })
  assert.equal(t.estado, 'analizando')
  assert.equal(t.origen, 'texto')
  assert.equal(t.link, '')
})

test('marcarBorrada pone deletedAt y sube updatedAt', () => {
  const n = nuevaNota({ projectId: 'p1', text: 'x', now: NOW, nuevoId: () => 'n-1' })
  const b = marcarBorrada(n, new Date('2026-11-24T10:00:00.000Z'))
  assert.equal(b.deletedAt, '2026-11-24T10:00:00.000Z')
  assert.equal(b.updatedAt, '2026-11-24T10:00:00.000Z')
})

test('itemAOportunidad arma una mejora con la cita como señal', () => {
  const op = itemAOportunidad(
    { texto: 'Panel de ventas por comercio. Que lo vea por semana.', cita: 'Necesito ver las ventas' },
    { projectId: 'p1', by: 'u1', now: NOW, nuevoId: () => 'op-1' },
  )
  assert.equal(op.id, 'op-1')
  assert.equal(op.projectId, 'p1')
  assert.equal(op.categoria, 'mejora')
  assert.equal(op.estado, 'nueva')
  assert.equal(op.titulo, 'Panel de ventas por comercio')
  assert.equal(op.porQue, 'Panel de ventas por comercio. Que lo vea por semana.')
  assert.equal(op.senal, 'Necesito ver las ventas')
  assert.equal(op.montoUsd, null)
  assert.equal(op.cobro, 'unico')
  assert.equal(op.lote, 'fase2')
  assert.equal(op.generadaAt, NOW.toISOString())
  assert.equal(op.generadaPor, 'u1')
  const sinCita = itemAOportunidad({ texto: 'Más reportes', cita: '' }, { projectId: 'p1', now: NOW, nuevoId: () => 'op-2' })
  assert.equal(sinCita.senal, 'Salió de lo que hablaron en las calls de Fase 2')
  const delPlan = itemAOportunidad({ titulo: 'App móvil', razon: 'Sus clientes compran desde el celular' }, { projectId: 'p1', now: NOW, nuevoId: () => 'op-3', frase: 'Contale lo del celular' })
  assert.equal(delPlan.titulo, 'App móvil')
  assert.equal(delPlan.porQue, 'Sus clientes compran desde el celular')
  assert.equal(delPlan.frase, 'Contale lo del celular')
})

test('hayParecida detecta títulos casi iguales y no se confunde con los cortos', () => {
  assert.equal(hayParecida('Panel de ventas por comercio', [{ titulo: 'Panel de ventas por comercio.' }]), true)
  assert.equal(hayParecida('Panel de ventas', [{ titulo: 'Panel de ventas por comercio' }]), true)
  assert.equal(hayParecida('App móvil', [{ titulo: 'App móvil para comercios' }]), false)
  assert.equal(hayParecida('', [{ titulo: 'x' }]), false)
  assert.equal(hayParecida('Algo', []), false)
})

test('vincularItem guarda el id de la oportunidad en el ítem y no pisa uno ya vinculado', () => {
  const call = normalizarEntrada({
    id: 'c1', projectId: 'p1', kind: 'call', estado: 'lista',
    analisis: { resumen: 'x', implementar: [{ texto: 'Panel', cita: '' }, { texto: 'Alertas', cita: '' }] },
  })
  const v = vincularItem(call, 'implementar', 1, 'op-9')
  assert.equal(v.analisis.implementar[0].oportunidadId, null)
  assert.equal(v.analisis.implementar[1].oportunidadId, 'op-9')
  assert.equal(vincularItem(v, 'implementar', 1, 'otra').analisis.implementar[1].oportunidadId, 'op-9')
  assert.equal(vincularItem(call, 'cargar', 0, 'op-9'), call)
  const plan = normalizarEntrada({ id: 'plan-p1', projectId: 'p1', kind: 'plan', porQueAhora: 'x', queOfrecerPrimero: [{ titulo: 'A', razon: '' }] })
  assert.equal(vincularItem(plan, 'queOfrecerPrimero', 0, 'op-8').queOfrecerPrimero[0].oportunidadId, 'op-8')
})

const ENTRADAS = [
  { id: 'n1', projectId: 'p1', kind: 'nota', text: 'Quiere app', at: '2026-11-20T10:00:00.000Z' },
  {
    id: 'c1', projectId: 'p1', kind: 'call', at: '2026-11-22T10:00:00.000Z', estado: 'lista', titulo: 'Seguimiento',
    analisis: { resumen: 'Habló de ventas', generadaAt: '2026-11-22T11:00:00.000Z', implementar: [{ texto: 'Panel', cita: 'q' }] },
  },
  { id: 'c2', projectId: 'p1', kind: 'call', at: '2026-11-21T10:00:00.000Z', estado: 'error' },
  { id: 'n9', projectId: 'p2', kind: 'nota', text: 'Otro proyecto', at: '2026-11-22T10:00:00.000Z' },
  { id: 'n8', projectId: 'p1', kind: 'nota', text: 'Borrada', at: '2026-11-22T09:00:00.000Z', deletedAt: '2026-11-22T11:00:00.000Z' },
]
const PLAN = (extra = {}) => ({
  id: 'plan-p1', projectId: 'p1', kind: 'plan', porQueAhora: 'Cerró el MVP', generadoAt: '2026-11-23T00:00:00.000Z',
  basadoEn: ['n1', 'c1'], queOfrecerPrimero: [{ titulo: 'Panel de ventas', razon: 'Lo pidió' }], ...extra,
})

test('vistaFase2 ordena, filtra por proyecto y detecta el plan desactualizado', () => {
  const v = vistaFase2([...ENTRADAS, PLAN({ basadoEn: ['n1'], generadoAt: '2026-11-21T00:00:00.000Z' })], 'p1')
  assert.deepEqual(v.entradas.map((e) => e.id), ['c1', 'c2', 'n1'])
  assert.equal(v.plan.id, 'plan-p1')
  assert.equal(v.elegibles, 2)
  assert.equal(v.planDesactualizado, true)

  const fresco = vistaFase2([...ENTRADAS, PLAN()], 'p1')
  assert.equal(fresco.planDesactualizado, false)

  const reanalizada = ENTRADAS.map((e) => (e.id === 'c1' ? { ...e, analisis: { ...e.analisis, generadaAt: '2026-11-24T00:00:00.000Z' } } : e))
  assert.equal(vistaFase2([...reanalizada, PLAN()], 'p1').planDesactualizado, true)

  const sinPlan = vistaFase2(ENTRADAS, 'p1')
  assert.equal(sinPlan.plan, null)
  assert.equal(sinPlan.planDesactualizado, false)
  assert.deepEqual(entradasParaPlan(ENTRADAS.map(normalizarEntradaStore)).map((e) => e.id).sort(), ['c1', 'n1', 'n9'])
})

test('lineasFase2 resume plan, calls y notas, y respeta el tope', () => {
  const L = lineasFase2([...ENTRADAS, PLAN()].filter((e) => e.projectId === 'p1'))
  const t = L.join('\n')
  assert.ok(t.includes('- Plan de Fase 2 (2026-11-23): Cerró el MVP'))
  assert.ok(t.includes('Ofrecer primero: Panel de ventas'))
  assert.ok(t.includes('- Call del 2026-11-22 (Seguimiento): Habló de ventas'))
  assert.ok(t.includes('Para implementar: Panel ("q")'))
  assert.ok(t.includes('- Nota de Fase 2 (2026-11-20): Quiere app'))
  assert.ok(!t.includes('Borrada'))
  assert.ok(lineasFase2([...ENTRADAS, PLAN()], { tope: 60 }).join('\n').length <= 60)
  assert.deepEqual(lineasFase2([]), [])
  assert.deepEqual(lineasFase2(null), [])
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `node --test tests/fase2.test.js`
Expected: FAIL (los imports nuevos no existen).

- [ ] **Step 3: Implementar** (agregar al final de `src/lib/fase2.js`)

```js
/* ───────────────────────────── Entradas nuevas ───────────────────────────── */

export function nuevaNota({ projectId, text, by = null, now = new Date(), nuevoId = idNuevo } = {}) {
  const at = iso(now)
  return { id: nuevoId(), projectId, kind: 'nota', text: txt(text, MAX_NOTA), at, by: idLoose(by), updatedAt: at, deletedAt: null }
}

export function nuevaCall({ projectId, link = '', texto = '', by = null, now = new Date(), nuevoId = idNuevo } = {}) {
  const at = iso(now)
  const pegada = txt(texto, MAX_TEXTO_CALL)
  return {
    id: nuevoId(), projectId, kind: 'call', at, by: idLoose(by), updatedAt: at, deletedAt: null,
    link: pegada ? '' : clip(link, 500), fathomId: null, titulo: null,
    origen: pegada ? 'texto' : 'fathom', texto: pegada,
    estado: pegada ? 'analizando' : 'bajando', error: null, analisis: null,
  }
}

export function marcarBorrada(e, now = new Date()) {
  const t = iso(now)
  return { ...e, deletedAt: t, updatedAt: t }
}

/* Deja anotado en el ítem qué oportunidad nació de él. No pisa un vínculo ya hecho. */
export function vincularItem(entrada, lista, indice, oportunidadId) {
  if (!entrada || !idOk(oportunidadId)) return entrada
  const poner = (arr) => (Array.isArray(arr)
    ? arr.map((it, i) => (i === indice && it && !it.oportunidadId ? { ...it, oportunidadId } : it))
    : arr)
  if (entrada.kind === 'call' && entrada.analisis && (lista === 'mejorar' || lista === 'implementar')) {
    return { ...entrada, analisis: { ...entrada.analisis, [lista]: poner(entrada.analisis[lista]) } }
  }
  if (entrada.kind === 'plan' && lista === 'queOfrecerPrimero') return { ...entrada, queOfrecerPrimero: poner(entrada.queOfrecerPrimero) }
  return entrada
}

/* ───────────────────────── Ítem → oportunidad ───────────────────────── */

const tituloDe = (s) => {
  const t = clip(s, 240)
  const corte = t.search(/[.;:]\s/)
  const p = corte > 20 ? t.slice(0, corte) : t
  return p.length > 90 ? `${p.slice(0, 87).trimEnd()}…` : p
}

/* Devuelve la oportunidad cruda: quien la guarda la pasa por normalizeOpportunity (el store ya lo hace). */
export function itemAOportunidad(item, { projectId, by = null, now = new Date(), nuevoId = idNuevo, frase = '' } = {}) {
  const x = item && typeof item === 'object' ? item : {}
  const at = iso(now)
  return {
    id: nuevoId(),
    projectId,
    titulo: tituloDe(x.titulo || x.texto),
    porQue: clip(x.razon || x.texto, 600),
    senal: clip(x.cita, 300) || 'Salió de lo que hablaron en las calls de Fase 2',
    frase: clip(frase, 400),
    categoria: 'mejora',
    montoUsd: null,
    cobro: 'unico',
    estado: 'nueva',
    orden: 0,
    lote: 'fase2',
    modelo: null,
    generadaAt: at,
    generadaPor: idLoose(by),
    createdAt: at,
    updatedAt: at,
  }
}

const llave = (s) => clip(s, 200).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export function hayParecida(titulo, previas = []) {
  const a = llave(titulo)
  if (!a) return false
  return (previas || []).some((o) => {
    const b = llave(o && o.titulo)
    return !!b && (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a))))
  })
}

/* ─────────────────────────────── Vistas ─────────────────────────────── */

export const entradasParaPlan = (entradas) => (entradas || [])
  .filter((e) => e && !e.deletedAt && ((e.kind === 'nota' && e.text) || (e.kind === 'call' && e.analisis)))

const masNueva = (a, b) => String(b.at || b.updatedAt || '').localeCompare(String(a.at || a.updatedAt || ''))

export function vistaFase2(items, projectId) {
  const mias = (items || []).map(normalizarEntradaStore).filter((e) => e.projectId === projectId && !e.deletedAt)
  const plan = mias.find((e) => e.kind === 'plan') || null
  const entradas = mias.filter((e) => (e.kind === 'nota' && e.text) || e.kind === 'call').sort(masNueva)
  const elegibles = entradasParaPlan(mias)
  let planDesactualizado = false
  if (plan) {
    const ids = new Set(elegibles.map((e) => e.id))
    planDesactualizado = elegibles.some((e) => !plan.basadoEn.includes(e.id)
      || (e.kind === 'call' && String(e.analisis.generadaAt || '') > String(plan.generadoAt || '')))
      || plan.basadoEn.some((id) => !ids.has(id))
  }
  return { plan, entradas, elegibles: elegibles.length, planDesactualizado }
}

/* Las líneas que `armarContexto` agrega al pedido de oportunidades: el plan, las últimas calls ya
 * analizadas y las notas. Nunca la transcripción cruda. Con tope de caracteres. */
export function lineasFase2(items, { tope = 7000 } = {}) {
  const mias = (items || []).map(normalizarEntradaStore).filter((e) => !e.deletedAt)
  const plan = mias.find((e) => e.kind === 'plan')
  const calls = mias.filter((e) => e.kind === 'call' && e.analisis).sort(masNueva).slice(0, 6)
  const notas = mias.filter((e) => e.kind === 'nota' && e.text).sort(masNueva).slice(0, 8)
  const L = []
  if (plan) {
    L.push(`- Plan de Fase 2 (${dia(plan.generadoAt) || 's/f'}): ${plan.porQueAhora}`)
    if (plan.queOfrecerPrimero.length) L.push(`  Ofrecer primero: ${plan.queOfrecerPrimero.map((i) => i.titulo).join('; ')}`)
    if (plan.objecionesEsperadas.length) L.push(`  Objeciones esperadas: ${plan.objecionesEsperadas.map((i) => i.objecion).join('; ')}`)
  }
  const fila = (rotulo, arr, n) => {
    if (arr.length) L.push(`  ${rotulo}: ${arr.slice(0, n).map((i) => (i.cita ? `${i.texto} ("${i.cita}")` : i.texto)).join('; ')}`)
  }
  for (const c of calls) {
    const a = c.analisis
    L.push(`- Call del ${dia(c.at) || 's/f'}${c.titulo ? ` (${c.titulo})` : ''}: ${a.resumen}`)
    fila('Para implementar', a.implementar, 4)
    fila('Para mejorar', a.mejorar, 3)
    fila('Objeciones', a.objeciones, 3)
    fila('Señales', a.senales, 3)
  }
  for (const n of notas) L.push(`- Nota de Fase 2 (${dia(n.at) || 's/f'}): ${clip(n.text, 600)}`)
  const out = []
  let usado = 0
  for (const l of L) {
    if (usado + l.length + 1 > tope) break
    out.push(l)
    usado += l.length + 1
  }
  return out
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `node --test tests/fase2.test.js`
Expected: PASS (17 tests en total).

- [ ] **Step 5: Test que falla del contexto** (agregar al final de `tests/oportunidades.test.js`)

```js
test('armarContexto suma la sección Fase 2 con el plan, las calls y las notas; sin ellas no aparece', () => {
  const fase2 = [
    { id: 'plan-p1', projectId: 'p1', kind: 'plan', porQueAhora: 'Cerró el MVP', generadoAt: daysAgo(1), basadoEn: [], queOfrecerPrimero: [{ titulo: 'Panel de ventas', razon: 'Lo pidió' }] },
    { id: 'c1', projectId: 'p1', kind: 'call', at: daysAgo(3), estado: 'lista', titulo: 'Seguimiento', analisis: { resumen: 'Habló de ventas', implementar: [{ texto: 'Alertas por mail', cita: 'Quiero enterarme al toque' }] } },
    { id: 'n1', projectId: 'p1', kind: 'nota', text: 'Quiere sumar una segunda marca', at: daysAgo(5) },
  ]
  const con = armarContexto({ ...base(), now: NOW, fase2 })
  assert.ok(con.includes('## Fase 2: calls y notas con el cliente'))
  assert.ok(con.includes('Plan de Fase 2'))
  assert.ok(con.includes('Alertas por mail ("Quiero enterarme al toque")'))
  assert.ok(con.includes('Quiere sumar una segunda marca'))
  const sin = armarContexto({ ...base(), now: NOW })
  assert.ok(!sin.includes('Fase 2: calls y notas con el cliente'))
})
```

- [ ] **Step 6: Correr y ver que falla**

Run: `node --test tests/oportunidades.test.js`
Expected: FAIL en el test nuevo (la sección no existe todavía). Los demás tests siguen en verde.

- [ ] **Step 7: Implementar en `src/lib/oportunidades.js`**

Agregar el import debajo de `import { openCloserNotes } from './closerNotes.js'` (línea 19):

```js
import { lineasFase2 } from './fase2.js'
```

Cambiar la firma de `armarContexto` (línea 102):

```js
export function armarContexto({ project, client, plan, tasks = [], notes = [], previas = [], fase2 = [], now = new Date() } = {}) {
```

Agregar la sección justo después de la de "Notas del servicio (onboarding y calls)" y antes de `seccion('Para el closer', ...)`:

```js
    seccion('Fase 2: calls y notas con el cliente', lineasFase2(fase2)),
```

- [ ] **Step 8: Correr toda la suite**

Run: `npm test`
Expected: PASS (todos los tests, los 134 de antes más los nuevos).

- [ ] **Step 9: Commit (pedir confirmación antes)**

```bash
git add src/lib/fase2.js src/lib/oportunidades.js tests/fase2.test.js tests/oportunidades.test.js
git commit -m "feat(fase2): entradas, vista, ítem a oportunidad y contexto para el buscador"
```

---

### Task 5: Migración y ensayo de la tabla `project_fase2`

**Files:**
- Create: `docs/migrations/2026-11-23-fase2.sql`
- Create: `docs/migrations/2026-11-23-fase2.ensayo.sql`

**Interfaces:**
- Consumes: de la base ya existente `public.tocar_sync_at()`, `public.pm_puede_ver()`, `public.is_team()`, `public.oportunidad_sello(text)`.
- Produces: tabla `public.project_fase2` (`id`, `data`, `updated_at`, `deleted_at`, `sync_at`, `project_id` generado), `public.fase2_guardar_call(p_id text, p_patch jsonb) → jsonb` y `public.fase2_guardar_plan(p_project text, p_plan jsonb) → jsonb` (solo `service_role`).

- [ ] **Step 1: Escribir la migración** (`docs/migrations/2026-11-23-fase2.sql`)

```sql
-- Sección "Fase 2" por proyecto (spec 2026-11-23-fathom-resumen-fase2-design.md).
--
-- Una fila por entrada (nota, call de Fathom o plan del proyecto), mismo patrón por fila que
-- project_opportunities: id, data, updated_at, deleted_at, sync_at; project_id sale del JSON.
-- Lee quien ve el equipo (pm_puede_ver: Mati y Axel también); escribe el equipo (is_team).
-- La edge function `fase2` escribe con service role por las dos funciones de abajo.
-- Sin DELETE: se borra con deleted_at.

create table if not exists public.project_fase2 (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_at timestamptz not null default clock_timestamp(),
  project_id text generated always as (data->>'projectId') stored,
  constraint project_fase2_kind check (coalesce(data->>'kind', '') in ('nota', 'call', 'plan'))
);

create index if not exists project_fase2_project_idx
  on public.project_fase2 (project_id) where deleted_at is null;
create index if not exists project_fase2_sync_at on public.project_fase2 (sync_at);

drop trigger if exists tocar_sync_at on public.project_fase2;
create trigger tocar_sync_at before insert or update on public.project_fase2
  for each row execute function public.tocar_sync_at();

alter table public.project_fase2 enable row level security;
alter table public.project_fase2 force row level security;
revoke all on table public.project_fase2 from public, anon, authenticated;
grant select, insert, update on table public.project_fase2 to authenticated;
grant select, insert, update, delete on table public.project_fase2 to service_role;

drop policy if exists project_fase2_equipo_select on public.project_fase2;
drop policy if exists project_fase2_equipo_insert on public.project_fase2;
drop policy if exists project_fase2_equipo_update on public.project_fase2;
create policy project_fase2_equipo_select on public.project_fase2
  for select to authenticated using ((select public.pm_puede_ver()));
create policy project_fase2_equipo_insert on public.project_fase2
  for insert to authenticated with check ((select public.is_team()));
create policy project_fase2_equipo_update on public.project_fase2
  for update to authenticated using ((select public.is_team())) with check ((select public.is_team()));

do $$ begin
  alter publication supabase_realtime add table public.project_fase2;
exception when duplicate_object then null; end $$;

-- Mezcla un parche en una call viva (texto bajado, estado, análisis…). No deja cambiar id, proyecto
-- ni tipo. Reusa oportunidad_sello: updatedAt siempre sube por encima del anterior, para que un
-- navegador con el reloj adelantado no ignore el resultado.
create or replace function public.fase2_guardar_call(p_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'PATCH_INVALIDO' using errcode = '22023';
  end if;
  update public.project_fase2
     set data = data || (p_patch - 'id' - 'projectId' - 'kind')
                     || jsonb_build_object('updatedAt', public.oportunidad_sello(data->>'updatedAt')),
         updated_at = now()
   where id = p_id and deleted_at is null and data->>'kind' = 'call'
  returning data into v;
  return v;
end $$;
revoke all on function public.fase2_guardar_call(text, jsonb) from public, anon, authenticated;
grant execute on function public.fase2_guardar_call(text, jsonb) to service_role;

-- Una sola fila de plan por proyecto (id 'plan-<proyecto>'): la crea o la reemplaza.
create or replace function public.fase2_guardar_plan(p_project text, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_id text := 'plan-' || coalesce(p_project, '');
begin
  if coalesce(p_project, '') !~ '^[A-Za-z0-9_-]{1,80}$' or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'PLAN_INVALIDO' using errcode = '22023';
  end if;
  insert into public.project_fase2 (id, data, updated_at)
  values (
    v_id,
    (p_plan - 'id' - 'projectId' - 'kind')
      || jsonb_build_object('id', v_id, 'projectId', p_project, 'kind', 'plan', 'updatedAt', public.oportunidad_sello(null)),
    now()
  )
  on conflict (id) do update
    set data = excluded.data
               || jsonb_build_object('updatedAt', public.oportunidad_sello(public.project_fase2.data->>'updatedAt')),
        updated_at = now(),
        deleted_at = null
  returning data into v;
  return v;
end $$;
revoke all on function public.fase2_guardar_plan(text, jsonb) from public, anon, authenticated;
grant execute on function public.fase2_guardar_plan(text, jsonb) to service_role;
```

- [ ] **Step 2: Escribir el ensayo** (`docs/migrations/2026-11-23-fase2.ensayo.sql`)

```sql
-- Ensayo de 2026-11-23-fase2.sql: se corre concatenado DESPUÉS de la migración, en un solo lote
-- por la Management API. Termina en raise exception, así que todo se revierte (tabla incluida); los
-- resultados vienen en el mensaje del error. Ningún PERMITIDO es OK y todo conteo de alguien de
-- afuera del equipo tiene que dar 0.
do $t$
declare
  res jsonb := '{}';
  n int;
  v jsonb;
  ext uuid := gen_random_uuid();
  man uuid; lec uuid;
  p1 text;
begin
  select id into man from auth.users where lower(email) = 'manuelnavarro@insightsapps.tech';
  select u.id into lec from public.team_members t join auth.users u on lower(u.email) = lower(t.data->>'email')
   where t.deleted_at is null and t.data->>'access' = 'read' and t.data->>'status' = 'approved' limit 1;
  select id into p1 from public.projects where deleted_at is null limit 1;
  insert into auth.users(id, instance_id, aud, role, email, email_confirmed_at) values
    (ext, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ext-ensayo-fase2@example.com', now());

  -- Funciones del service role (corre como dueño: sin set role todavía).
  insert into public.project_fase2 (id, data) values
    ('ens-c1', jsonb_build_object('id', 'ens-c1', 'projectId', p1, 'kind', 'call', 'estado', 'bajando', 'updatedAt', '2099-01-01T00:00:00.000Z')),
    ('ens-n1', jsonb_build_object('id', 'ens-n1', 'projectId', p1, 'kind', 'nota', 'text', 'x'));
  v := public.fase2_guardar_call('ens-c1', jsonb_build_object('estado', 'lista', 'projectId', 'pisado', 'kind', 'nota', 'texto', 'hola'));
  res := res || jsonb_build_object('s1_mezcla_sin_pisar_id_ni_tipo',
    v->>'estado' = 'lista' and v->>'texto' = 'hola' and v->>'projectId' = p1 and v->>'kind' = 'call',
    's2_sello_sube_sobre_reloj_adelantado', v->>'updatedAt' > '2099-01-01T00:00:00.000Z',
    's3_no_toca_una_nota', public.fase2_guardar_call('ens-n1', '{"text":"y"}') is null,
    '_rls_forzado', (select relforcerowsecurity from pg_class where oid = 'public.project_fase2'::regclass),
    '_en_realtime', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'project_fase2'),
    '_project_id', (select project_id from public.project_fase2 where id = 'ens-c1') = p1);

  v := public.fase2_guardar_plan(p1, jsonb_build_object('porQueAhora', 'Uno', 'id', 'pisado', 'kind', 'nota'));
  res := res || jsonb_build_object('s4_plan_crea', v->>'id' = 'plan-' || p1 and v->>'kind' = 'plan' and v->>'porQueAhora' = 'Uno');
  v := public.fase2_guardar_plan(p1, jsonb_build_object('porQueAhora', 'Dos'));
  res := res || jsonb_build_object('s5_plan_reemplaza_y_una_sola_fila',
    v->>'porQueAhora' = 'Dos'
    and (select count(*) from public.project_fase2 where id = 'plan-' || p1) = 1);
  begin perform public.fase2_guardar_plan('malo id!', '{}'); res := res || jsonb_build_object('s6_plan_proyecto_invalido', 'PERMITIDO');
  exception when others then res := res || jsonb_build_object('s6_plan_proyecto_invalido', 'bloqueado'); end;
  begin insert into public.project_fase2 (id, data) values ('ens-mal', jsonb_build_object('projectId', p1, 'kind', 'otra')); res := res || jsonb_build_object('s7_kind_invalido', 'PERMITIDO');
  exception when others then res := res || jsonb_build_object('s7_kind_invalido', 'bloqueado'); end;

  -- Equipo (Manuel).
  perform set_config('request.jwt.claims', json_build_object('sub', man, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.project_fase2 where id like 'ens-%'; res := res || jsonb_build_object('t1_equipo_lee', n);
  update public.project_fase2 set data = data || '{"estado":"error"}' where id = 'ens-c1'; get diagnostics n = row_count; res := res || jsonb_build_object('t2_equipo_edita', n);
  begin insert into public.project_fase2(id, data) values ('ens-d', jsonb_build_object('projectId', p1, 'kind', 'nota', 'text', 'z')); res := res || jsonb_build_object('t3_equipo_crea', 'ok'); exception when others then res := res || jsonb_build_object('t3_equipo_crea', 'BLOQUEADO ' || sqlerrm); end;
  begin delete from public.project_fase2 where id = 'ens-c1'; res := res || jsonb_build_object('t4_delete_fisico', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('t4_delete_fisico', 'bloqueado'); end;
  begin perform public.fase2_guardar_call('ens-c1', '{}'); res := res || jsonb_build_object('t5_sesion_guarda_call', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('t5_sesion_guarda_call', 'bloqueado'); end;
  begin perform public.fase2_guardar_plan(p1, '{}'); res := res || jsonb_build_object('t6_sesion_guarda_plan', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('t6_sesion_guarda_plan', 'bloqueado'); end;
  execute 'reset role';

  -- Lector (acceso read): lee, no escribe.
  if lec is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', lec, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.project_fase2 where id like 'ens-%'; res := res || jsonb_build_object('l1_lector_lee', n);
    update public.project_fase2 set data = data || '{"estado":"lista"}' where id = 'ens-c1'; get diagnostics n = row_count; res := res || jsonb_build_object('l2_lector_edita', n);
    begin insert into public.project_fase2(id, data) values ('ens-e', jsonb_build_object('projectId', p1, 'kind', 'nota', 'text', 'z')); res := res || jsonb_build_object('l3_lector_crea', 'PERMITIDO'); exception when others then res := res || jsonb_build_object('l3_lector_crea', 'bloqueado'); end;
    execute 'reset role';
  else
    res := res || jsonb_build_object('l0_lector', 'no hay lector con cuenta');
  end if;

  -- Alguien de afuera del equipo.
  perform set_config('request.jwt.claims', json_build_object('sub', ext, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.project_fase2; res := res || jsonb_build_object('o1_ajeno_lee', n);
  update public.project_fase2 set data = '{}'; get diagnostics n = row_count; res := res || jsonb_build_object('o2_ajeno_edita', n);
  execute 'reset role';

  -- Sin sesión.
  execute 'set local role anon';
  begin select count(*) into n from public.project_fase2; res := res || jsonb_build_object('a1_anon_lee', 'PERMITIDO ' || n); exception when others then res := res || jsonb_build_object('a1_anon_lee', 'bloqueado'); end;
  execute 'reset role';

  raise exception 'ENSAYO %', res;
end $t$;
```

- [ ] **Step 3: Revisar que el ensayo coincide con el patrón existente**

Run: `diff <(sed -n 1,12p docs/migrations/2026-11-13-oportunidades.ensayo.sql) <(sed -n 1,12p docs/migrations/2026-11-23-fase2.ensayo.sql)`
Expected: solo difieren el nombre de la migración y el mail del usuario ajeno. Si el ensayo viejo cambió de forma, ajustar el nuevo en el mismo sentido.

- [ ] **Step 4: Correr el ensayo (pedir confirmación a Nacho: toca la base de producción, aunque se revierte solo)**

Hace falta `SUPABASE_ACCESS_TOKEN` en el entorno. El lote concatenado crea la tabla, corre el ensayo y revierte todo por el `raise exception`:

```bash
cat docs/migrations/2026-11-23-fase2.sql docs/migrations/2026-11-23-fase2.ensayo.sql | jq -Rs '{query: .}' | curl -sS -X POST "https://api.supabase.com/v1/projects/yzmtzyuncekspgtsetwk/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @-
```

Expected: una respuesta de error cuyo mensaje es `ENSAYO {...}` con este resultado:
- `s1` a `s5` en `true`; `_rls_forzado`, `_en_realtime`, `_project_id` en `true`.
- `s6_plan_proyecto_invalido` y `s7_kind_invalido` en `"bloqueado"`.
- `t1_equipo_lee` mayor que 0; `t2_equipo_edita` en 1; `t3_equipo_crea` en `"ok"`; `t4`, `t5`, `t6` en `"bloqueado"`.
- `l1_lector_lee` mayor que 0; `l2_lector_edita` en 0; `l3_lector_crea` en `"bloqueado"` (o `l0_lector` si no hay lector con cuenta).
- `o1_ajeno_lee` y `o2_ajeno_edita` en 0; `a1_anon_lee` en `"bloqueado"`.
Si algo da `PERMITIDO` o un conteo de ajeno distinto de 0, corregir la migración antes de seguir.

- [ ] **Step 5: Aplicar la migración (pedir confirmación a Nacho: cambia producción)**

```bash
jq -Rs '{query: .}' docs/migrations/2026-11-23-fase2.sql | curl -sS -X POST "https://api.supabase.com/v1/projects/yzmtzyuncekspgtsetwk/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data @-
```

Expected: respuesta sin error. Verificar: `select count(*) from public.project_fase2;` devuelve 0.

- [ ] **Step 6: Commit (pedir confirmación antes)**

```bash
git add docs/migrations/2026-11-23-fase2.sql docs/migrations/2026-11-23-fase2.ensayo.sql
git commit -m "feat(fase2): tabla project_fase2 con políticas, funciones del service role y ensayo"
```

---

### Task 6: Edge function `fase2` y contexto de Fase 2 en `oportunidades`

**Files:**
- Create: `supabase/functions/fase2/index.ts`
- Modify: `supabase/functions/oportunidades/index.ts` (comentario de cabecera, líneas 17 y 102-121)

**Interfaces:**
- Consumes: de `src/lib/fase2.js` `resolverLink`, `mismaCall`, `limpiarTexto`, `textoDeReunion`, `normalizarEntrada`, `normalizarAnalisis`, `normalizarPlan`, `entradasParaPlan`, `ESQUEMA_CALL`, `ESQUEMA_PLAN`, `SISTEMA_CALL`, `SISTEMA_PLAN`; de `src/lib/oportunidades.js` `armarContexto`, `normalizeOpportunity`, `quedaAlRepensar`, `MODELO`; de la base `fase2_guardar_call`, `fase2_guardar_plan` y las tablas `fathom_accounts`, `fathom_calls`, `project_fase2`.
- Produces: `POST /functions/v1/fase2` con `{ accion: 'analizar_call', proyecto, entrada }` → `{ ok: true, entrada }` o `{ error, entrada? }`; y `{ accion: 'armar_plan', proyecto }` → `{ ok: true, plan }` o `{ error }`.

- [ ] **Step 1: Crear la función** (`supabase/functions/fase2/index.ts`)

```ts
// ============================================================================
// fase2 — Supabase Edge Function (Deno)
// La sección "Fase 2" del detalle del proyecto (spec 2026-11-23).
//
// POST {accion:"analizar_call", proyecto, entrada} → la pantalla ya creó la entrada (kind "call").
//   Si es de Fathom y todavía no tiene texto, baja la call con las cuentas de fathom_accounts; después
//   la analiza con Claude y guarda el resultado en la fila (fase2_guardar_call).
// POST {accion:"armar_plan", proyecto}              → Claude arma "Cómo llevarlo a Fase 2" con las
//   notas y los análisis del proyecto; lo guarda en la fila 'plan-<proyecto>' (fase2_guardar_plan).
//
// Sólo el equipo con acceso completo: is_team() con el JWT de quien llama. Un lector (Mati, Axel)
// ve la sección por RLS pero acá recibe 403. El token de Fathom nunca sale de acá y el texto de la
// call nunca viaja del navegador a la IA: se lee de la base y se limpia antes (limpiarTexto).
//
// La lógica pura vive en src/lib/fase2.js y src/lib/oportunidades.js. Se despliega desde la raíz:
//   supabase functions deploy fase2 --project-ref yzmtzyuncekspgtsetwk --use-api --no-verify-jwt --yes
// y hay que redesplegarla si cambian fase2.js, oportunidades.js, journey.js, stages.js, lifecycle.js,
// progress.js, stores.js, serviceNotes.js o closerNotes.js.
//
// Secrets: ANTHROPIC_API_KEY (principal) y ANTHROPIC_API_KEY_RESPALDO. 400 de saldo, 401, 403 y 429
// pasan a la de respaldo; 5xx y red no.
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  resolverLink, mismaCall, limpiarTexto, textoDeReunion, normalizarEntrada, normalizarAnalisis, normalizarPlan,
  entradasParaPlan, ESQUEMA_CALL, ESQUEMA_PLAN, SISTEMA_CALL, SISTEMA_PLAN,
} from '../../../src/lib/fase2.js'
import { armarContexto, normalizeOpportunity, quedaAlRepensar, MODELO } from '../../../src/lib/oportunidades.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } })

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const db = createClient(URL_BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const CLAVE_RE = /^[A-Za-z0-9_-]{1,120}$/
const ESPERA_PLAN_MS = 30_000
const DIA = 86_400_000

type Yo = { id: string | null; nombre: string }

async function quienLlama(req: Request): Promise<Yo | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const comoEl = createClient(URL_BASE, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const [{ data: user }, { data: esEquipo, error }] = await Promise.all([comoEl.auth.getUser(token), comoEl.rpc('is_team')])
  if (error || esEquipo !== true || !user?.user?.email) return null
  const email = user.user.email.toLowerCase()
  const { data: filas } = await db.from('team_members').select('id, data').is('deleted_at', null).eq('data->>email', email).limit(1)
  const m = filas && filas[0]
  return { id: m?.id ?? null, nombre: String(m?.data?.name || email.split('@')[0]).slice(0, 80) }
}

function errorDeCuenta(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false
  if (e.status === 401 || e.status === 403 || e.status === 429) return true
  return e.status === 400 && /credit|billing/i.test(e.message)
}

async function pensar(sistema: string, esquema: unknown, usuario: string) {
  const keys = [Deno.env.get('ANTHROPIC_API_KEY'), Deno.env.get('ANTHROPIC_API_KEY_RESPALDO')].filter((k): k is string => !!k)
  if (!keys.length) throw new Error('sin_key')
  let ultimo: unknown = null
  for (const apiKey of keys) {
    const client = new Anthropic({ apiKey, timeout: 140_000, maxRetries: 1 })
    try {
      const pedido = {
        model: MODELO,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: { type: 'json_schema', schema: esquema } },
        system: sistema,
        messages: [{ role: 'user', content: usuario }],
      }
      // `as never`: el SDK fijado no tipa todavía fallbacks: "default".
      const msg = await client.beta.messages.stream(pedido as never).finalMessage()
      if (msg.stop_reason === 'refusal') throw new Error('rechazo')
      if (msg.stop_reason === 'max_tokens') throw new Error('cortada')
      const texto = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
      return { datos: JSON.parse(texto), modelo: msg.model }
    } catch (e) {
      ultimo = e
      if (!errorDeCuenta(e)) break
      console.warn('[fase2] la key no anduvo, pruebo la de respaldo:', (e as Error).message)
    }
  }
  throw ultimo
}

/** Mensaje para el usuario según cómo falló la IA. */
function errorIA(e: unknown): { msg: string; status: number } {
  const m = (e as Error)?.message || String(e)
  if (m === 'sin_key') { console.error('[fase2] falta ANTHROPIC_API_KEY'); return { msg: 'Falta configurar la IA. Avisale a Manuel.', status: 503 } }
  if (m === 'rechazo') return { msg: 'La IA no quiso responder con este contenido. Probá de nuevo más tarde.', status: 502 }
  console.error('[fase2] Claude falló:', m)
  return { msg: 'La IA no respondió. Probá de nuevo en un rato.', status: 502 }
}

/** El contexto del proyecto, igual que en `oportunidades`: proyecto, plan, tareas, notas y lo ya ofrecido. */
async function contextoDelProyecto(proyecto: string, fase2: unknown[]) {
  const { data: p } = await db.from('projects').select('id, data').eq('id', proyecto).is('deleted_at', null).maybeSingle()
  if (!p) return null
  const [cli, plan, tareas, notas, previas] = await Promise.all([
    p.data?.clientId ? db.from('clients').select('id, data').eq('id', p.data.clientId).is('deleted_at', null).maybeSingle() : Promise.resolve({ data: null }),
    p.data?.planId ? db.from('plans').select('id, data').eq('id', p.data.planId).is('deleted_at', null).maybeSingle() : Promise.resolve({ data: null }),
    db.from('tasks').select('id, data').is('deleted_at', null).eq('data->>projectId', proyecto).limit(200),
    db.from('project_service_notes').select('type, body, noted_at').eq('project_id', proyecto).is('deleted_at', null).order('noted_at', { ascending: false }).limit(30),
    db.from('project_opportunities').select('id, data').eq('project_id', proyecto).is('deleted_at', null),
  ])
  return armarContexto({
    project: p, client: cli.data, plan: plan.data, tasks: tareas.data ?? [],
    notes: (notas.data ?? []).map((n) => ({ type: n.type, body: n.body, notedAt: n.noted_at })),
    previas: (previas.data ?? []).map((r) => normalizeOpportunity(r.data)).filter(quedaAlRepensar),
    fase2,
    now: new Date(),
  })
}

/* ───────────────────────────── Fathom ───────────────────────────── */

async function reunionesDe(apiKey: string, desde: string, hasta: string | null) {
  const out: any[] = []
  let cursor: string | null = null
  for (let pagina = 0; pagina < 10; pagina++) {
    const url = new URL('https://api.fathom.ai/external/v1/meetings')
    url.searchParams.set('include_summary', 'true')
    url.searchParams.set('include_transcript', 'true')
    url.searchParams.set('created_after', desde)
    if (hasta) url.searchParams.set('created_before', hasta)
    if (cursor) url.searchParams.set('cursor', cursor)
    const r = await fetch(url.toString(), { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(60_000) })
    if (!r.ok) throw new Error(`Fathom ${r.status}`)
    const data = await r.json()
    const items = data.items || data.meetings || data.data || []
    out.push(...items)
    cursor = data.next_cursor || data.cursor || null
    if (!cursor || items.length === 0) break
  }
  return out
}

/** Busca la reunión del link en las cuentas de Fathom: primero la de la call ya sincronizada. */
async function buscarReunion(link: { ok: true; clave: string; tipo: string; url: string }) {
  if (!CLAVE_RE.test(link.clave)) return null
  const { data: conocida } = await db.from('fathom_calls').select('id, account_id, call_date, project_id').ilike('share_url', `%${link.clave}%`).limit(1).maybeSingle()
  const { data: cuentas } = await db.from('fathom_accounts').select('id, api_key')
  if (!cuentas?.length) return null
  const ordenadas = [...cuentas].sort((a, b) => Number(b.id === conocida?.account_id) - Number(a.id === conocida?.account_id))
  const fecha = conocida?.call_date ? Date.parse(conocida.call_date) : NaN
  const desde = Number.isFinite(fecha) ? new Date(fecha - 2 * DIA).toISOString() : new Date(Date.now() - 400 * DIA).toISOString()
  const hasta = Number.isFinite(fecha) ? new Date(fecha + 2 * DIA).toISOString() : null
  for (const c of ordenadas) {
    try {
      const m = (await reunionesDe(c.api_key, desde, hasta)).find((x) => mismaCall(link, x))
      if (m) return { meeting: m, fathomCallId: conocida?.id ?? null, yaTieneProyecto: !!conocida?.project_id }
    } catch (e) {
      console.warn('[fase2] una cuenta de Fathom no respondió:', (e as Error).message)
    }
  }
  return null
}

/* ───────────────────────────── Acciones ───────────────────────────── */

const guardarCall = async (id: string, patch: Record<string, unknown>) => {
  const { data, error } = await db.rpc('fase2_guardar_call', { p_id: id, p_patch: patch })
  if (error) console.error('[fase2] no pude guardar la call:', error.message)
  return data
}

/** La falla queda anotada en la fila y vuelve a la pantalla junto con ella. */
async function fallaCall(id: string, msg: string, status: number): Promise<Response> {
  const fila = await guardarCall(id, { estado: 'error', error: msg })
  return json({ error: msg, entrada: fila ?? null }, status)
}

async function analizarCall(proyecto: string, entradaId: string): Promise<Response> {
  const { data: fila } = await db.from('project_fase2').select('id, data').eq('id', entradaId).eq('project_id', proyecto).is('deleted_at', null).maybeSingle()
  const e = fila ? normalizarEntrada({ ...fila.data, id: fila.id }) : null
  if (!e || e.kind !== 'call') return json({ error: 'No encontré esa call.' }, 404)

  let texto = e.texto
  const parche: Record<string, unknown> = {}
  if (e.origen === 'fathom' && !texto) {
    const link = resolverLink(e.link)
    if (!link.ok) return await fallaCall(e.id, link.error, 400)
    const hallada = await buscarReunion(link)
    if (!hallada) {
      return await fallaCall(e.id, 'No encontré esa call en las cuentas de Fathom cargadas. Pegá el texto de la call para analizarla igual.', 422)
    }
    const m = hallada.meeting
    const t = textoDeReunion(m)
    if (!t.texto) return await fallaCall(e.id, 'La call no trae resumen ni transcripción todavía. Probá de nuevo en unos minutos.', 422)
    texto = t.texto
    const cuando = m.recording_start_time || m.scheduled_start_time || m.created_at || null
    Object.assign(parche, {
      texto, titulo: String(m.title || m.meeting_title || '').slice(0, 160) || null,
      fathomId: String(m.recording_id ?? m.id ?? '') || null,
      ...(cuando ? { at: new Date(cuando).toISOString() } : {}),
    })
    if (hallada.fathomCallId && !hallada.yaTieneProyecto) {
      await db.from('fathom_calls').update({ project_id: proyecto }).eq('id', hallada.fathomCallId).is('project_id', null)
    }
  }
  await guardarCall(e.id, { ...parche, estado: 'analizando', error: null })

  const contexto = await contextoDelProyecto(proyecto, [])
  if (contexto == null) return await fallaCall(e.id, 'No encontré el proyecto.', 404)

  let r
  try {
    r = await pensar(
      SISTEMA_CALL, ESQUEMA_CALL,
      `Este es el proyecto:\n\n${contexto}\n\n---\n\nEsta es la llamada con el cliente:\n\n${limpiarTexto(texto)}\n\nBajá la llamada a tierra.`,
    )
  } catch (err) {
    const f = errorIA(err)
    return await fallaCall(e.id, f.msg, f.status)
  }
  const analisis = normalizarAnalisis(r.datos, { now: new Date(), modelo: r.modelo })
  if (!analisis) return await fallaCall(e.id, 'La IA no encontró nada concreto en esta llamada.', 422)
  const guardada = await guardarCall(e.id, { estado: 'lista', error: null, analisis })
  if (!guardada) return json({ error: 'No pude guardar el análisis.' }, 500)
  return json({ ok: true, entrada: guardada })
}

async function armarPlan(proyecto: string): Promise<Response> {
  const { data: filas, error } = await db.from('project_fase2').select('id, data').eq('project_id', proyecto).is('deleted_at', null).limit(300)
  if (error) return json({ error: 'No pude leer la sección Fase 2.' }, 500)
  const entradas = (filas ?? []).map((f) => normalizarEntrada({ ...f.data, id: f.id })).filter(Boolean) as Array<Record<string, any>>
  const previo = entradas.find((x) => x.kind === 'plan')
  if (previo?.generadoAt && Date.now() - Date.parse(previo.generadoAt) < ESPERA_PLAN_MS) {
    return json({ error: 'Recién se armó el plan para este proyecto. Esperá unos segundos.' }, 429)
  }
  const base = entradas.filter((x) => x.kind !== 'plan')
  const elegibles = entradasParaPlan(base)
  if (!elegibles.length) return json({ error: 'Sumá una nota o analizá una call antes de armar el plan.' }, 422)

  const contexto = await contextoDelProyecto(proyecto, base)
  if (contexto == null) return json({ error: 'No encontré el proyecto.' }, 404)

  let r
  try {
    r = await pensar(SISTEMA_PLAN, ESQUEMA_PLAN, `Este es el proyecto:\n\n${contexto}\n\nArmá el plan para llevarlo a una Fase 2.`)
  } catch (err) {
    const f = errorIA(err)
    return json({ error: f.msg }, f.status)
  }
  const plan = normalizarPlan(r.datos, { projectId: proyecto, basadoEn: elegibles.map((x) => x.id), now: new Date(), modelo: r.modelo })
  if (!plan) return json({ error: 'La IA no encontró nada concreto para proponer. Sumá más notas o calls y probá de nuevo.' }, 422)
  const { data: guardado, error: e2 } = await db.rpc('fase2_guardar_plan', { p_project: proyecto, p_plan: plan })
  if (e2) {
    console.error('[fase2] no pude guardar el plan:', e2.message)
    return json({ error: 'No pude guardar el plan.' }, 500)
  }
  return json({ ok: true, plan: guardado })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  try {
    const yo = await quienLlama(req)
    if (!yo) return json({ error: 'Sólo el equipo con acceso completo puede hacer esto.' }, 403)
    const b = await req.json().catch(() => ({}))
    const proyecto = String(b.proyecto || '')
    if (!ID_RE.test(proyecto)) return json({ error: 'Falta el proyecto.' }, 400)
    if (b.accion === 'analizar_call') {
      const entrada = String(b.entrada || '')
      if (!ID_RE.test(entrada)) return json({ error: 'Falta la call.' }, 400)
      return await analizarCall(proyecto, entrada)
    }
    if (b.accion === 'armar_plan') return await armarPlan(proyecto)
    return json({ error: 'Acción desconocida.' }, 400)
  } catch (e) {
    console.error('[fase2]', (e as Error).message)
    return json({ error: 'Algo falló. Probá de nuevo.' }, 500)
  }
})
```

- [ ] **Step 2: Pasar las entradas de Fase 2 a `oportunidades`** (`supabase/functions/oportunidades/index.ts`)

En el comentario de cabecera (línea 17), agregar `fase2.js` a la lista de archivos que obligan a redesplegar:

```ts
// progress.js, stores.js, serviceNotes.js, closerNotes.js o fase2.js.
```

En `generar`, dentro del `Promise.all` (línea 102), cambiar la desestructuración y sumar la consulta al final:

```ts
  const [cli, plan, tareas, notas, previas, fase2] = await Promise.all([
```

```ts
    db.from('project_opportunities').select('id, data').eq('project_id', proyecto).is('deleted_at', null),
    db.from('project_fase2').select('id, data').eq('project_id', proyecto).is('deleted_at', null).limit(300),
  ])
```

Y en la llamada a `armarContexto` (línea 116), agregar el argumento:

```ts
    previas: filasPrevias.filter(quedaAlRepensar),
    fase2: (fase2.data ?? []).map((r) => ({ ...r.data, id: r.id })),
    now: new Date(),
```

- [ ] **Step 3: Chequear que las dos funciones compilan**

Run: `deno check supabase/functions/fase2/index.ts supabase/functions/oportunidades/index.ts`
Expected: sin errores de tipos. Si `deno` no está instalado, usar `npx supabase functions serve fase2 --no-verify-jwt` y mirar que arranque sin error de importación. Los errores del SDK sobre `fallbacks` ya se evitan con `as never`.

- [ ] **Step 4: Correr la suite**

Run: `npm test`
Expected: PASS (la función no tiene tests propios: su lógica pura ya está cubierta en `tests/fase2.test.js` y `tests/oportunidades.test.js`).

- [ ] **Step 5: Desplegar (pedir confirmación a Nacho: cambia producción; la migración de Task 5 tiene que estar aplicada)**

```bash
supabase functions deploy fase2 --project-ref yzmtzyuncekspgtsetwk --use-api --no-verify-jwt --yes
supabase functions deploy oportunidades --project-ref yzmtzyuncekspgtsetwk --use-api --no-verify-jwt --yes
```

Expected: las dos se despliegan sin error. Humo sin tocar datos: una llamada sin sesión tiene que dar 403.

```bash
curl -sS -X POST "https://yzmtzyuncekspgtsetwk.supabase.co/functions/v1/fase2" -H "Content-Type: application/json" -d '{"accion":"armar_plan","proyecto":"x"}'
```

Expected: `{"error":"Sólo el equipo con acceso completo puede hacer esto."}`

- [ ] **Step 6: Commit (pedir confirmación antes)**

```bash
git add supabase/functions/fase2/index.ts supabase/functions/oportunidades/index.ts
git commit -m "feat(fase2): edge function para bajar y analizar calls y armar el plan"
```

---

### Task 7: Store y sección `Fase2Section` en la pantalla

**Files:**
- Create: `src/fase2/Fase2.jsx`
- Modify: `src/InsightsApp.jsx` (líneas 63, 65, 7356, 9488, 9507, 9511)
- Modify: `src/journey/ProjectPanel.jsx` (import y línea 379)

**Interfaces:**
- Consumes: de `src/lib/fase2.js` `vistaFase2`, `nuevaNota`, `nuevaCall`, `marcarBorrada`, `vincularItem`, `itemAOportunidad`, `hayParecida`, `resolverLink`, `normalizarEntradaStore`, `MIN_TEXTO_PEGADO`, `MAX_NOTA`, `MAX_TEXTO_CALL`; `useApp()` con `data`, `myId`, `supabase`, `fase2Store`, `opportunityStore`; `fmtDay` de `../lib/stores.js`; `esSoloLectura` de `../lib/soloLectura.js`; `I2` de `../ui/icons2.jsx`; `normalizeOpportunity` de `../lib/oportunidades.js`; función `fase2` del Task 6.
- Produces: `export function Fase2Section({ project, compact = false })` y `fase2Store` (`useRowCollection` sobre `project_fase2`, clave `rc_fase2_v1`) disponible en `useApp()`.

- [ ] **Step 1: Cablear el store en `src/InsightsApp.jsx`**

Imports, debajo de `import { normalizeOpportunity } from './lib/oportunidades.js'` (línea 65) y de `import { OportunidadesSection } from './oportunidades/Oportunidades.jsx'` (línea 63):

```js
import { Fase2Section } from './fase2/Fase2.jsx'
import { normalizarEntradaStore } from './lib/fase2.js'
```

Store, debajo de la línea del `opportunityStore` (9488):

```js
  const fase2Store = useRowCollection({ table: 'project_fase2', normalize: normalizarEntradaStore, seed: () => [], cacheKey: 'rc_fase2_v1' })
```

Línea 9507 (`collectionStores`) y línea 9511 (`allStores`): agregar `fase2Store` al final de cada lista:

```js
  const collectionStores = { projectStore, clientStore, teamStore, callStore, activityStore, sopCatStore, sopProcStore, chatStore, videoStore, agencyAccountStore, mvpStore, opportunityStore, fase2Store }
```

```js
  const allStores = [projectStore, clientStore, teamStore, callStore, activityStore, sopCatStore, sopProcStore, chatStore, videoStore, agencyAccountStore, mvpStore, opportunityStore, fase2Store]
```

Montaje en el detalle del proyecto, debajo de la línea 7356 (`<OportunidadesSection project={project} />`):

```jsx
        {project.kind !== 'interno' && <Fase2Section project={project} />}
```

- [ ] **Step 2: Montaje compacto en `src/journey/ProjectPanel.jsx`**

Import, junto al de `OportunidadesSection` (línea 14):

```js
import { Fase2Section } from '../fase2/Fase2.jsx'
```

Debajo del bloque de Oportunidades (línea 379, después del `</section>` que lo cierra):

```jsx
      <section className="jp-sec">
        <div className="jp-k">Fase 2 <span>calls, notas y plan para ofrecerla</span></div>
        <Fase2Section project={p} compact />
      </section>
```

- [ ] **Step 3: Crear la sección** (`src/fase2/Fase2.jsx`)

```jsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useApp } from '../ui.jsx'
import { I2 } from '../ui/icons2.jsx'
import { fmtDay } from '../lib/stores.js'
import { esSoloLectura } from '../lib/soloLectura.js'
import { normalizeOpportunity } from '../lib/oportunidades.js'
import {
  vistaFase2, nuevaNota, nuevaCall, marcarBorrada, vincularItem, itemAOportunidad, hayParecida,
  resolverLink, MIN_TEXTO_PEGADO, MAX_NOTA, MAX_TEXTO_CALL,
} from '../lib/fase2.js'

/*
 * "Fase 2" del proyecto (spec 2026-11-23): notas libres y calls de Fathom analizadas por la IA, y un
 * plan "Cómo llevarlo a Fase 2". La pantalla crea la entrada (así aparece al instante y no se pierde
 * lo escrito) y después le pide a la función `fase2` que baje y analice la call. Las notas se
 * escriben sin red; todo lo que usa la IA necesita la app en línea.
 */

const CSS = `
.f2-sec{margin:0 0 26px}
.f2-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
.f2-bar .input{flex:1 1 260px;min-width:0;height:38px}
.f2-lead{margin:0 0 12px;font-size:12.5px;color:var(--text-dim);line-height:1.5;max-width:68ch}
.f2-box{display:flex;flex-direction:column;gap:10px;margin:0 0 14px;padding:14px 15px;border-radius:16px;background:var(--card);box-shadow:inset 0 0 0 1px var(--border)}
.f2-box textarea{width:100%;min-height:120px;resize:vertical}
.f2-box .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.f2-box .row small{margin-right:auto;font-size:11.5px;color:var(--text-faint)}
.f2-plan{--oc:var(--violet);position:relative;display:flex;flex-direction:column;gap:12px;margin:0 0 16px;padding:16px 17px;border-radius:16px;background:var(--card);box-shadow:inset 0 0 0 1px var(--border);overflow:hidden}
.f2-plan::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:var(--oc);opacity:.85}
.f2-plan h3{margin:0;font-size:15px;letter-spacing:-.018em}
.f2-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--text-faint)}
.f2-meta .sp{margin-left:auto}
.f2-k{margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint)}
.f2-p{margin:0;font-size:13px;line-height:1.55;color:var(--text)}
.f2-ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.f2-ul li{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;font-size:13px;line-height:1.5;color:var(--text)}
.f2-ul li > span{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}
.f2-ul li small{display:block;margin-top:2px;font-size:11.5px;color:var(--text-faint)}
.f2-ul li q{display:block;margin-top:2px;font-size:12px;color:var(--text-dim);quotes:'«' '»'}
.f2-stale{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 11px;border-radius:11px;font-size:12.5px;color:var(--text);background:var(--bg-elevated);box-shadow:inset 0 0 0 1px var(--yellow)}
.f2-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.f2-call{display:flex;flex-direction:column;gap:12px;padding:15px 16px;border-radius:16px;background:var(--card);box-shadow:inset 0 0 0 1px var(--border);min-width:0}
.f2-call h3{margin:0;font-size:14.5px;letter-spacing:-.015em;overflow-wrap:anywhere}
.f2-tag{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:650;color:var(--text);background:var(--bg-elevated);box-shadow:inset 0 0 0 1px var(--border)}
.f2-tag.err{box-shadow:inset 0 0 0 1px var(--red)}
.f2-tag.ok{box-shadow:inset 0 0 0 1px var(--green)}
.f2-feed{display:flex;flex-direction:column;gap:12px}
.f2-nota{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--border)}
.f2-nota p{margin:0;flex:1;min-width:0;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.f2-nota small{display:block;margin-bottom:3px;font-size:11.5px;color:var(--text-faint)}
.f2-link{background:none;border:0;padding:0;color:var(--accent);font:inherit;font-size:12.5px;font-weight:650;cursor:pointer}
.f2-link:disabled{opacity:.5;cursor:default}
.f2-raw{margin:0;max-height:260px;overflow:auto;padding:10px 12px;border-radius:12px;background:var(--bg-elevated);box-shadow:inset 0 0 0 1px var(--border);font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--text-dim)}
.f2-sec.compact .f2-cols{grid-template-columns:1fr}
@media (max-width:760px){.f2-cols{grid-template-columns:1fr}.f2-bar .op-go{width:100%;justify-content:center;height:44px}}
`

async function llamarFase2(supabase, body) {
  if (!supabase) return { error: 'Sin conexión con la base: esto anda con la app en línea.', servidor: false }
  const { data, error } = await supabase.functions.invoke('fase2', { body })
  if (!error) return { data }
  let msg = 'No pudimos hablar con el servidor. Probá de nuevo.'
  let entrada = null
  let servidor = false
  try {
    const b = await error.context.json()
    servidor = true
    if (b && b.error) msg = b.error
    if (b && b.entrada) entrada = b.entrada
  } catch { /* sin cuerpo: no llegó a la función */ }
  return { error: msg, entrada, servidor }
}

const ESTADO_TXT = { bajando: 'Bajando la call de Fathom…', analizando: 'Analizando la call…' }

function Items({ titulo, items, onOportunidad, puede, lista, entrada }) {
  if (!items || !items.length) return null
  return (
    <div>
      <p className="f2-k">{titulo}</p>
      <ul className="f2-ul">
        {items.map((it, i) => (
          <li key={`${lista}-${i}`}>
            <span>{it.texto}{it.cita && <q>{it.cita}</q>}</span>
            {onOportunidad && (it.oportunidadId
              ? <small>Ya es oportunidad</small>
              : puede && <button type="button" className="op-again" onClick={() => onOportunidad(entrada, lista, i)}>Pasar a oportunidad</button>)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Llamada({ e, puede, puedeIA, onReintentar, onBorrar, onOportunidad }) {
  const [verTexto, setVerTexto] = useState(false)
  const a = e.analisis
  const enCurso = e.estado === 'bajando' || e.estado === 'analizando'
  return (
    <article className="f2-call" aria-busy={enCurso}>
      <div className="f2-meta">
        <span className={`f2-tag${e.estado === 'error' ? ' err' : e.estado === 'lista' ? ' ok' : ''}`}>
          {e.estado === 'lista' ? 'Call analizada' : e.estado === 'error' ? 'No se pudo' : 'Call en proceso'}
        </span>
        {e.at && <span>{fmtDay(e.at)}</span>}
        {e.origen === 'texto' && <span>texto pegado</span>}
        {puede && <button type="button" className="f2-link sp" onClick={() => onBorrar(e)}>Borrar</button>}
      </div>
      {e.titulo && <h3>{e.titulo}</h3>}
      {enCurso && <p className="f2-lead" role="status">{ESTADO_TXT[e.estado]} Tarda alrededor de medio minuto.</p>}
      {e.estado === 'error' && (
        <div className="f2-stale" role="alert">
          <I2.alert width={14} height={14} /><span style={{ flex: 1, minWidth: 0 }}>{e.error || 'Algo falló.'}</span>
          {puedeIA && <button type="button" className="op-again" onClick={() => onReintentar(e)}>Probar de nuevo</button>}
        </div>
      )}
      {a && (
        <>
          {a.resumen && <p className="f2-p">{a.resumen}</p>}
          <div className="f2-cols">
            <Items titulo="Cargar" items={a.cargar} lista="cargar" entrada={e} puede={puede} />
            <Items titulo="Mejorar" items={a.mejorar} lista="mejorar" entrada={e} puede={puede} onOportunidad={onOportunidad} />
            <Items titulo="Implementar" items={a.implementar} lista="implementar" entrada={e} puede={puede} onOportunidad={onOportunidad} />
          </div>
          <Items titulo="Objeciones" items={a.objeciones} lista="objeciones" entrada={e} puede={puede} />
          {a.senales.length > 0 && (
            <div>
              <p className="f2-k">Señales de compra</p>
              <ul className="f2-ul">{a.senales.map((s, i) => <li key={i}><span>{s.texto}<small>{s.tipo}</small>{s.cita && <q>{s.cita}</q>}</span></li>)}</ul>
            </div>
          )}
          {a.pendientes.length > 0 && (
            <div>
              <p className="f2-k">Pendientes</p>
              <ul className="f2-ul">{a.pendientes.map((p, i) => <li key={i}><span>{p.texto}{p.quien && <small>{p.quien}</small>}</span></li>)}</ul>
            </div>
          )}
        </>
      )}
      {e.texto && (
        <div>
          <button type="button" className="op-more" aria-expanded={verTexto} onClick={() => setVerTexto((x) => !x)}>
            <I2.chevR width={12} height={12} /> {verTexto ? 'Ocultar el texto de la call' : 'Ver el texto de la call'}
          </button>
          {verTexto && <pre className="f2-raw">{e.texto}</pre>}
        </div>
      )}
      {puedeIA && a && e.estado === 'lista' && (
        <div><button type="button" className="f2-link" onClick={() => onReintentar(e)}>Analizar de nuevo</button></div>
      )}
    </article>
  )
}

function Plan({ plan, desactualizado, puede, puedeIA, armando, onArmar, onOportunidad }) {
  return (
    <section className="f2-plan" aria-label="Cómo llevarlo a Fase 2">
      <div className="f2-meta">
        <h3>Cómo llevarlo a Fase 2</h3>
        <span className="sp">Armado el {fmtDay(plan.generadoAt)}</span>
        {puedeIA && (
          <button type="button" className="op-again" onClick={onArmar} disabled={armando} aria-busy={armando}>
            <I2.refresh width={13} height={13} /> {armando ? 'Pensando…' : 'Rehacer plan'}
          </button>
        )}
      </div>
      {desactualizado && <div className="f2-stale"><I2.alert width={14} height={14} /><span>Hay calls o notas nuevas desde que se armó este plan.{puedeIA ? ' Conviene rehacerlo.' : ''}</span></div>}
      {plan.porQueAhora && <div><p className="f2-k">Por qué ahora</p><p className="f2-p">{plan.porQueAhora}</p></div>}
      {plan.queOfrecerPrimero.length > 0 && (
        <div>
          <p className="f2-k">Qué ofrecer primero</p>
          <ul className="f2-ul">
            {plan.queOfrecerPrimero.map((it, i) => (
              <li key={i}>
                <span>{it.titulo}{it.razon && <small>{it.razon}</small>}</span>
                {it.oportunidadId
                  ? <small>Ya es oportunidad</small>
                  : puede && <button type="button" className="op-again" onClick={() => onOportunidad(plan, 'queOfrecerPrimero', i)}>Pasar a oportunidad</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.comoAbrirLaCharla && <div><p className="f2-k">Cómo abrir la charla</p><p className="f2-p">{plan.comoAbrirLaCharla}</p></div>}
      {plan.objecionesEsperadas.length > 0 && (
        <div>
          <p className="f2-k">Objeciones que esperamos</p>
          <ul className="f2-ul">{plan.objecionesEsperadas.map((o, i) => <li key={i}><span>{o.objecion}{o.respuesta && <small>{o.respuesta}</small>}</span></li>)}</ul>
        </div>
      )}
      {plan.antesDeOfrecer.length > 0 && (
        <div><p className="f2-k">Antes de ofrecer</p><ul className="f2-ul">{plan.antesDeOfrecer.map((t, i) => <li key={i}><span>{t}</span></li>)}</ul></div>
      )}
      {plan.momento && <div><p className="f2-k">Cuándo</p><p className="f2-p">{plan.momento}</p></div>}
      {plan.riesgos.length > 0 && (
        <div><p className="f2-k">Riesgos</p><ul className="f2-ul">{plan.riesgos.map((t, i) => <li key={i}><span>{t}</span></li>)}</ul></div>
      )}
    </section>
  )
}

export function Fase2Section({ project, compact = false }) {
  const { data, myId, supabase, fase2Store, opportunityStore } = useApp()
  const id = useId()
  const me = (data.team || []).find((u) => u.id === myId)
  const puede = !!fase2Store && !esSoloLectura() && (!me || me.access === 'full')
  const puedeIA = puede && !!supabase
  const who = (uid) => (data.team || []).find((u) => u.id === uid)?.name || 'alguien del equipo'

  const [link, setLink] = useState('')
  const [pegar, setPegar] = useState(false)
  const [pegado, setPegado] = useState('')
  const [notando, setNotando] = useState(false)
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [armando, setArmando] = useState(false)
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  useEffect(() => { setLink(''); setPegar(false); setPegado(''); setNotando(false); setNota(''); setError('') }, [project.id])

  const v = useMemo(() => vistaFase2(fase2Store?.items || [], project.id), [fase2Store?.items, project.id])

  /* Corre la función sobre una call ya creada. Si la función respondió con error, ella dejó anotada
   * la falla en la fila: se toma lo que devolvió. Si ni llegó, se marca acá. */
  const correr = async (entrada) => {
    const r = await llamarFase2(supabase, { accion: 'analizar_call', proyecto: project.id, entrada: entrada.id })
    if (!vivo.current) return
    if (r.data?.entrada) { fase2Store.upsert(r.data.entrada); return }
    if (r.entrada) { fase2Store.upsert(r.entrada); return }
    if (!r.servidor) fase2Store.patch(entrada.id, (x) => ({ ...x, estado: 'error', error: r.error }))
  }

  const crearYCorrer = async (entrada) => {
    const { error: err } = await fase2Store.create(entrada)
    if (err) { setError('No pude guardar la call. Probá de nuevo.'); return }
    await correr(entrada)
  }

  const traer = async () => {
    if (!puedeIA) return
    const r = resolverLink(link)
    if (!r.ok) { setError(r.error); return }
    setError(''); setLink('')
    await crearYCorrer(nuevaCall({ projectId: project.id, link: r.url, by: myId || null }))
  }

  const analizarPegado = async () => {
    if (!puedeIA) return
    if (pegado.trim().length < MIN_TEXTO_PEGADO) { setError(`Pegá el texto completo de la call (al menos ${MIN_TEXTO_PEGADO} caracteres).`); return }
    setError(''); setPegar(false)
    const texto = pegado; setPegado('')
    await crearYCorrer(nuevaCall({ projectId: project.id, texto, by: myId || null }))
  }

  const guardarNota = async () => {
    if (!puede || !nota.trim()) return
    setError('')
    const { error: err } = await fase2Store.create(nuevaNota({ projectId: project.id, text: nota, by: myId || null }))
    if (err) { setError('No pude guardar la nota. Probá de nuevo.'); return }
    setNota(''); setNotando(false)
  }

  const reintentar = async (entrada) => {
    if (!puedeIA) return
    fase2Store.patch(entrada.id, (x) => ({ ...x, estado: x.texto ? 'analizando' : 'bajando', error: null }))
    await correr(entrada)
  }

  const borrar = (entrada) => { if (puede) fase2Store.patch(entrada.id, (x) => marcarBorrada(x)) }

  const armarPlan = async () => {
    if (!puedeIA || armando) return
    setArmando(true); setError('')
    const r = await llamarFase2(supabase, { accion: 'armar_plan', proyecto: project.id })
    if (!vivo.current) return
    setArmando(false)
    if (r.error) { setError(r.error); return }
    if (r.data?.plan) fase2Store.upsert(r.data.plan)
  }

  const aOportunidad = (entrada, lista, indice) => {
    if (!puede || !opportunityStore) return
    const item = entrada.kind === 'plan' ? entrada.queOfrecerPrimero[indice] : entrada.analisis?.[lista]?.[indice]
    if (!item || item.oportunidadId) return
    const mias = (opportunityStore.items || []).filter((o) => o.projectId === project.id && !o.deletedAt)
    const op = itemAOportunidad(item, { projectId: project.id, by: myId || null, frase: entrada.kind === 'plan' ? entrada.comoAbrirLaCharla : '' })
    if (hayParecida(op.titulo, mias)) { setError('Ya hay una oportunidad parecida a esta en el proyecto.'); return }
    setError('')
    opportunityStore.create(normalizeOpportunity(op))
    fase2Store.patch(entrada.id, (x) => vincularItem(x, lista, indice, op.id))
  }

  const hay = v.entradas.length > 0 || !!v.plan
  return (
    <section className={`f2-sec${compact ? ' compact' : ''}`} aria-labelledby={`${id}-t`} aria-busy={armando}>
      <style>{CSS}</style>
      {!compact
        ? (
          <div className="pd-h">
            <h2 id={`${id}-t`}>Fase 2</h2>
            <span className="sub">calls y notas para llevar este proyecto a una Fase 2</span>
          </div>
        )
        : <span id={`${id}-t`} className="op-sr">Fase 2</span>}

      {puede && (
        <div className="f2-bar">
          <label className="op-sr" htmlFor={`${id}-link`}>Link de la call de Fathom</label>
          <input id={`${id}-link`} className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Pegá el link de la call de Fathom"
            onKeyDown={(e) => { if (e.key === 'Enter') traer() }} disabled={!puedeIA} />
          <button type="button" className="op-go" onClick={traer} disabled={!puedeIA || !link.trim()}><I2.sparkle width={15} height={15} /> Traer call</button>
          <button type="button" className="op-again" onClick={() => setNotando((x) => !x)} aria-expanded={notando}>Nueva nota</button>
          <button type="button" className="op-again" onClick={() => setPegar((x) => !x)} aria-expanded={pegar} disabled={!puedeIA}>Pegar el texto</button>
        </div>
      )}
      {puede && !supabase && <p className="f2-lead">Traer y analizar calls anda con la app en línea. Las notas se pueden escribir igual.</p>}

      {notando && puede && (
        <div className="f2-box">
          <label className="op-sr" htmlFor={`${id}-nota`}>Nota de Fase 2</label>
          <textarea id={`${id}-nota`} className="input" value={nota} maxLength={MAX_NOTA} onChange={(e) => setNota(e.target.value)} placeholder="Qué dijo, qué quiere, qué se podría hacer…" />
          <div className="row">
            <small>{nota.length.toLocaleString('es-AR')} / {MAX_NOTA.toLocaleString('es-AR')}</small>
            <button type="button" className="op-again" onClick={() => { setNotando(false); setNota('') }}>Cancelar</button>
            <button type="button" className="op-go" onClick={guardarNota} disabled={!nota.trim()}>Guardar nota</button>
          </div>
        </div>
      )}

      {pegar && puedeIA && (
        <div className="f2-box">
          <label className="op-sr" htmlFor={`${id}-texto`}>Texto de la call</label>
          <textarea id={`${id}-texto`} className="input" value={pegado} maxLength={MAX_TEXTO_CALL} onChange={(e) => setPegado(e.target.value)} placeholder="Pegá acá el resumen o la transcripción de la call" />
          <div className="row">
            <small>{pegado.length.toLocaleString('es-AR')} caracteres · mínimo {MIN_TEXTO_PEGADO}</small>
            <button type="button" className="op-again" onClick={() => { setPegar(false); setPegado('') }}>Cancelar</button>
            <button type="button" className="op-go" onClick={analizarPegado} disabled={pegado.trim().length < MIN_TEXTO_PEGADO}>Analizar</button>
          </div>
        </div>
      )}

      {error && (
        <div className="op-err" role="alert">
          <I2.alert width={15} height={15} /><span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          <button type="button" className="op-again" onClick={() => setError('')}>Cerrar</button>
        </div>
      )}

      {!hay && (
        <div className="op-empty">
          <div className="tx">
            <b>{puede ? 'Todavía no hay nada de la Fase 2 de este proyecto' : 'Todavía nadie cargó nada de la Fase 2 de este proyecto'}</b>
            <p>Pegá el link de una call de Fathom o escribí una nota. La IA baja la llamada, saca lo que se puede cargar, mejorar e implementar, y arma el plan para ofrecer la Fase 2.</p>
          </div>
        </div>
      )}

      {v.plan && <Plan plan={v.plan} desactualizado={v.planDesactualizado} puede={puede} puedeIA={puedeIA} armando={armando} onArmar={armarPlan} onOportunidad={aOportunidad} />}

      {!v.plan && v.elegibles > 0 && puedeIA && (
        <div className="f2-box">
          <p className="f2-lead" style={{ margin: 0 }}>Hay {v.elegibles} {v.elegibles === 1 ? 'entrada lista' : 'entradas listas'} para armar el plan de cómo llevar este proyecto a una Fase 2.</p>
          <div className="row"><button type="button" className="op-go" onClick={armarPlan} disabled={armando} aria-busy={armando}><I2.sparkle width={15} height={15} /> {armando ? 'Pensando…' : 'Armar el plan'}</button></div>
        </div>
      )}
      {armando && <p className="op-think" role="status"><i aria-hidden="true" />Leyendo las calls, las notas y el proyecto. Tarda alrededor de medio minuto.</p>}

      {v.entradas.length > 0 && (
        <div className="f2-feed">
          {v.entradas.map((e) => (e.kind === 'call'
            ? <Llamada key={e.id} e={e} puede={puede} puedeIA={puedeIA} onReintentar={reintentar} onBorrar={borrar} onOportunidad={aOportunidad} />
            : (
              <article key={e.id} className="f2-nota">
                <p><small>Nota del {fmtDay(e.at)}{e.by ? ` · ${who(e.by)}` : ''}</small>{e.text}</p>
                {puede && <button type="button" className="f2-link" onClick={() => borrar(e)}>Borrar</button>}
              </article>
            )))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Construir**

Run: `npm run build`
Expected: build verde sin errores de imports (`Fase2Section`, `normalizarEntradaStore`, íconos `I2.sparkle`, `I2.refresh`, `I2.alert`, `I2.chevR` existen).

- [ ] **Step 5: Correr la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit (pedir confirmación antes)**

```bash
git add src/fase2/Fase2.jsx src/InsightsApp.jsx src/journey/ProjectPanel.jsx
git commit -m "feat(fase2): sección Fase 2 en el detalle del proyecto y en el panel del Recorrido"
```

---

### Task 8: Verificación en local, documentación y cierre

**Files:**
- Modify: `docs/PROGRESS.md`

**Interfaces:**
- Consumes: todo lo anterior; `app-proyectos-local` de `.claude/launch.json` (puerto 5174, datos semilla, sin tocar producción ni gastar en la IA).
- Produces: entrada en `docs/PROGRESS.md` y la verificación visual hecha.

- [ ] **Step 1: Levantar la app local**

Run: `npm run dev -- --port 5174`
Expected: Vite escucha en `http://localhost:5174`. (En el escritorio de Claude: `preview_start` con el nombre `app-proyectos-local`.)

- [ ] **Step 2: Sembrar entradas de ejemplo**

En la consola del navegador, con la app abierta en `http://localhost:5174`:

```js
localStorage.setItem('rc_fase2_v1', JSON.stringify([
  { id: 'n1', projectId: 'p1', kind: 'nota', text: 'Quiere sumar una segunda marca el año que viene.', at: '2026-11-20T10:00:00.000Z', by: null, updatedAt: '2026-11-20T10:00:00.000Z', deletedAt: null },
  { id: 'c1', projectId: 'p1', kind: 'call', at: '2026-11-22T10:00:00.000Z', by: null, updatedAt: '2026-11-22T10:00:00.000Z', deletedAt: null,
    link: 'https://fathom.video/share/demo123', fathomId: '123', titulo: 'Seguimiento con Eli', origen: 'fathom',
    texto: '# Resumen de Fathom\n- Quiere ver las ventas por comercio\n\n# Transcripción\n[00:01:10] Eli: Necesito ver las ventas por comercio, semana a semana.', estado: 'lista', error: null,
    analisis: { version: 1, generadaAt: '2026-11-22T11:00:00.000Z', modelo: 'claude-opus-5-5',
      resumen: 'Eli quiere entender mejor cómo vende cada comercio y pidió ver los números por semana. Espera al lanzamiento de la segunda marca para decidir.',
      cargar: [{ texto: 'Logo de la segunda marca en alta', cita: 'Te lo paso esta semana' }],
      mejorar: [{ texto: 'Que el panel actual permita filtrar por comercio', cita: 'Hoy tengo que sumar a mano', oportunidadId: null }],
      implementar: [{ texto: 'Panel de ventas por comercio con vista semanal', cita: 'Necesito ver las ventas por comercio', oportunidadId: null }, { texto: 'Alertas por mail cuando baja una venta', cita: '', oportunidadId: null }],
      objeciones: [{ texto: 'Prefiere esperar al lanzamiento para decidir', cita: 'Después del lanzamiento vemos' }],
      senales: [{ tipo: 'fecha', texto: 'Decide después del lanzamiento de la segunda marca', cita: '' }],
      pendientes: [{ texto: 'Mandar el logo en alta', quien: 'Eli' }] } },
  { id: 'c2', projectId: 'p1', kind: 'call', at: '2026-11-21T10:00:00.000Z', by: null, updatedAt: '2026-11-21T10:00:00.000Z', deletedAt: null,
    link: 'https://fathom.video/share/otra', fathomId: null, titulo: null, origen: 'fathom', texto: '', estado: 'error', error: 'No encontré esa call en las cuentas de Fathom cargadas. Pegá el texto de la call para analizarla igual.', analisis: null },
  { id: 'plan-p1', projectId: 'p1', kind: 'plan', at: null, by: null, updatedAt: '2026-11-21T12:00:00.000Z', deletedAt: null,
    generadoAt: '2026-11-21T12:00:00.000Z', modelo: 'claude-opus-5-5', basadoEn: ['n1'],
    porQueAhora: 'Terminó el MVP y ya vende; pidió ver mejor sus números y planea una segunda marca.',
    queOfrecerPrimero: [{ titulo: 'Panel de ventas por comercio', razon: 'Lo pidió en la última call', oportunidadId: null }],
    comoAbrirLaCharla: 'Contale lo que vimos en su panel y preguntale cómo viene el lanzamiento de la segunda marca.',
    objecionesEsperadas: [{ objecion: 'Prefiere esperar al lanzamiento', respuesta: 'Dejarlo listo antes le ahorra semanas después.' }],
    antesDeOfrecer: ['Confirmar quién decide'], momento: 'Una semana antes del lanzamiento.', riesgos: ['Se enfría si esperamos a después'] },
]))
location.reload()
```

- [ ] **Step 3: Verificar en el navegador a 1440 px, en oscuro y en claro**

Abrir el proyecto `p1` (el primero de la grilla) y comprobar, con captura de cada punto:
1. Aparece la sección "Fase 2" debajo de Oportunidades, con el plan arriba, el aviso de "calls o notas nuevas" (la call `c1` no está en `basadoEn`) y el listado: call analizada, call con error, nota.
2. La call analizada muestra resumen, Cargar / Mejorar / Implementar con citas, objeciones, señales y pendientes; "Ver el texto de la call" despliega el texto.
3. "Pasar a oportunidad" sobre "Panel de ventas por comercio…" cambia el ítem a "Ya es oportunidad" y la oportunidad aparece en la sección Oportunidades del mismo proyecto como "Mejora para Fase 2". Repetir el clic sobre el ítem del plan "Panel de ventas por comercio": muestra "Ya hay una oportunidad parecida a esta en el proyecto."
4. "Nueva nota": escribir, guardar, aparece arriba de la línea de tiempo; "Borrar" la saca.
5. Sin conexión (modo local `supabase` nulo): "Traer call", "Pegar el texto", "Rehacer plan" y "Probar de nuevo" no se ven o están deshabilitados, y aparece el aviso "Traer y analizar calls anda con la app en línea…".
6. Consola sin errores (`read_console_messages`).

- [ ] **Step 4: Verificar a 390 px (celular), oscuro y claro**

Con `resize_window` a 390 × 844: las tres columnas pasan a una, no hay scroll horizontal, los botones de la barra ocupan el ancho y el panel del Recorrido (Oficina/Recorrido → clic en un proyecto) muestra la sección compacta "Fase 2". Volver a `desktop` al terminar.

- [ ] **Step 5: Agregar la entrada a `docs/PROGRESS.md`**

Buscar la entrada más reciente (`grep -n "^## " docs/PROGRESS.md | head -3`) y agregar arriba de ella:

```md
## 2026-11-23 · Fase 2 por proyecto: link de Fathom, análisis de la call y plan para el upsell
- Sección "Fase 2" en el detalle del proyecto (debajo de Oportunidades) y en el panel del Recorrido/Oficina: notas libres, link de Fathom ("Traer call") o texto pegado, análisis por call y un plan "Cómo llevarlo a Fase 2". Spec: `docs/superpowers/specs/2026-11-23-fathom-resumen-fase2-design.md`; plan: `docs/superpowers/plans/2026-11-23-fase2-fathom.md`.
- Análisis por call: resumen, Cargar / Mejorar / Implementar con la cita del cliente, objeciones, señales de compra y pendientes. "Pasar a oportunidad" crea una oportunidad `mejora` (sin duplicar títulos parecidos) y deja el vínculo en el ítem. El plan se marca desactualizado cuando hay calls o notas nuevas y se rehace a pedido.
- Base: tabla por fila `project_fase2` (`docs/migrations/2026-11-23-fase2.sql`, ensayo en `.ensayo.sql`: equipo lee/crea/edita, lector lee y no escribe, ajeno 0 filas, anon bloqueado, sin DELETE). Únicas escrituras de la función: `fase2_guardar_call` y `fase2_guardar_plan` (definer, sólo service role).
- Edge function `fase2` (acciones `analizar_call` y `armar_plan`, verify_jwt off, `is_team()` con el JWT de quien llama): baja la call con las cuentas de `fathom_accounts` (el token no sale de la función), limpia mails/teléfonos/claves con `limpiarTexto` y analiza con `MODELO`. El texto de la call se lee de la base, nunca viaja del navegador a la IA. Despliegue: `supabase functions deploy fase2 --project-ref yzmtzyuncekspgtsetwk --use-api --no-verify-jwt --yes`; hay que redesplegar `fase2` y `oportunidades` si cambia `src/lib/fase2.js`.
- `armarContexto` suma "Fase 2: calls y notas con el cliente" (plan, últimas 6 calls analizadas y 8 notas, con tope de 7.000 caracteres): "Buscar oportunidades" y "Volver a pensar" mejoran con cada call.
- API de Fathom: <anotar acá lo que mostró `scripts/fathom-probe.mjs`: hay transcripción o solo resumen>. Un link de una cuenta de Fathom que no esté cargada en la app no se puede bajar: la pantalla ofrece pegar el texto.
- `npm test` verde (con los 17 casos nuevos de `tests/fase2.test.js` y 1 de `tests/oportunidades.test.js`), `npm run build` verde. Navegador en modo local con entradas sembradas en `rc_fase2_v1`: 1440 y 390, oscuro y claro.
```

Reemplazar el marcador entre `<` y `>` de la viñeta de la API de Fathom por el resultado real del Task 1 antes de guardar.

- [ ] **Step 6: Verificación final**

Run: `npm test && npm run build`
Expected: los dos en verde.

- [ ] **Step 7: Commit (pedir confirmación antes)**

```bash
git add docs/PROGRESS.md
git commit -m "docs: entrada de PROGRESS para la sección Fase 2"
```

---

## Autorrevisión del plan contra el spec

- **Sección propia con notas libres y link de Fathom (Objetivo, §2):** Task 7 (`Fase2Section`: barra de link, "Nueva nota", "Pegar el texto").
- **Análisis por call con Cargar/Mejorar/Implementar, citas, objeciones, señales y pendientes (§1, §3):** Task 3 (esquema, prompt, normalizador), Task 6 (`analizar_call`), Task 7 (`Llamada`).
- **Plan "Cómo llevarlo a Fase 2", desactualizado y rehacer a pedido (§2, §3):** Task 3 (`ESQUEMA_PLAN`, `normalizarPlan`), Task 4 (`vistaFase2.planDesactualizado`), Task 6 (`armar_plan`), Task 7 (`Plan`).
- **"Pasar a oportunidad" sin duplicar, categoría `mejora` (§3):** Task 4 (`itemAOportunidad`, `hayParecida`, `vincularItem`), Task 7 (`aOportunidad`).
- **`armarContexto` usa plan, análisis y notas, con tope (§3):** Task 4 (`lineasFase2`, integración), Task 6 (la función `oportunidades` pasa las filas).
- **Tabla por fila, políticas, funciones solo service role, sin DELETE, ensayo (§1):** Task 5.
- **Link resuelto contra `fathom_calls` y cuentas, token que no sale, texto no viaja del navegador, limpieza (§3):** Task 2 (`resolverLink`, `mismaCall`, `limpiarTexto`), Task 6 (`buscarReunion`, `analizarCall`).
- **Errores: link inválido, call no encontrada con salida de pegar texto, falla de IA, no pisar análisis existentes (§4):** Task 2, Task 6 (`fallaCall`), Task 7 (`reintentar`, "Analizar de nuevo" solo a pedido).
- **Permisos (`read` sin botones) y modo sin conexión (§2):** Task 7 (`puede`, `puedeIA`).
- **Pruebas: tests puros, ensayo SQL, navegador a 1440/390 en claro y oscuro, build (§4):** Tasks 2-5 y 8.
- **A verificar: transcripción en la API de Fathom (Riesgos):** Task 1 y la viñeta de `PROGRESS.md` de Task 8. `textoDeReunion` funciona con o sin transcripción.
- **Fuera de alcance respetado:** no hay prellenado de la propuesta, alertas del Recorrido ni alta de cuentas de Fathom desde la sección.

Consistencia de nombres revisada entre tareas: `normalizarEntradaStore`, `vistaFase2`, `lineasFase2`, `itemAOportunidad`, `vincularItem`, `nuevaCall`/`nuevaNota`, `marcarBorrada`, `resolverLink`/`mismaCall`, `textoDeReunion`, `fase2_guardar_call`/`fase2_guardar_plan` y las acciones `analizar_call`/`armar_plan` se definen una sola vez y se usan igual en todas las tareas.
