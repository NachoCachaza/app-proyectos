import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarPropuesta, totalesPropuesta, propuestaHtml, oportunidadesParaPropuesta, alcanceConIdea, dolares, esc } from '../src/lib/propuesta.js'

const NOW = new Date(2026, 10, 19, 12, 0)
const project = { id: 'p1', name: 'Evoria' }
const client = { name: 'Ana Coronado', company: 'Evoria Inc.' }
const op = (o) => ({ projectId: 'p1', estado: 'nueva', categoria: 'marketing', cobro: 'unico', orden: 0, ...o })
const items = [
  op({ id: 'a', titulo: 'Academia', porQue: 'Cursos para la comunidad', montoUsd: 5000, estado: 'ofrecida', categoria: 'fase_2' }),
  op({ id: 'b', titulo: 'Mantenimiento', montoUsd: 300, cobro: 'mensual', estado: 'ofrecida', categoria: 'plan_mensual' }),
  op({ id: 'c', titulo: 'Idea sin elegir', montoUsd: 1000, estado: 'nueva' }),
  op({ id: 'd', titulo: 'Descartada', montoUsd: 999, estado: 'descartada' }),
  op({ id: 'e', projectId: 'otro', titulo: 'De otro proyecto', estado: 'ofrecida' }),
]

test('dolares pone el punto de miles sin depender del idioma', () => {
  assert.equal(dolares(8500), '$8.500')
  assert.equal(dolares(1234567), '$1.234.567')
  assert.equal(dolares(null), '$0')
})

test('las descartadas y las de otro proyecto no entran; las ofrecidas van primero', () => {
  assert.deepEqual(oportunidadesParaPropuesta(items, 'p1').map((o) => o.id), ['a', 'b', 'c'])
})

test('armarPropuesta tilda las ofrecidas y deja sin tildar las nuevas', () => {
  const m = armarPropuesta({ project, client, items, now: NOW })
  assert.equal(m.cliente, 'Ana Coronado — Evoria Inc.')
  assert.equal(m.fecha, 'Noviembre 2026')
  assert.deepEqual(m.bloques.map((b) => [b.id, b.incluir]), [['a', true], ['b', true], ['c', false]])
  assert.equal(m.subtitulo, 'Fase 2, Plan mensual')
})

test('el precio nunca se completa solo: la estimación de la IA queda de sugerencia', () => {
  const m = armarPropuesta({ project, client, items, now: NOW })
  assert.deepEqual(m.bloques.map((b) => [b.monto, b.sugerido]), [[0, 5000], [0, 300], [0, 1000]])
  const html = propuestaHtml(m)
  assert.ok(!html.includes('A cotizar') && !html.includes('$') && !html.includes('Inversión') && !html.includes('USD'))
  assert.ok(html.includes('Incluye') && html.includes('Academia') && html.includes('Bloque A · Fase 2'))
})

test('lo marcado "Agregar a la propuesta: Sí" viene tildado; el "No" queda sin tildar', () => {
  const marcadas = [
    op({ id: 'x', titulo: 'Marcada que sí', enPropuesta: true }),
    op({ id: 'y', titulo: 'Marcada que no', enPropuesta: false }),
    op({ id: 'z', titulo: 'Sin marcar' }),
  ]
  const m = armarPropuesta({ project, client, items: marcadas, now: NOW })
  assert.deepEqual(m.bloques.map((b) => [b.id, b.incluir]), [['x', true], ['y', false], ['z', false]])
})

test('"Sí" anota la idea en el Alcance, una sola vez y sin precios', () => {
  const o = op({ id: 'a', titulo: 'Academia', porQue: 'Cursos para la comunidad', montoUsd: 5000 })
  const p1 = alcanceConIdea({ id: 'p1', scopeNotes: [{ id: 'n0', text: 'Nota previa' }] }, o, true, 'u1', NOW)
  assert.equal(p1.scopeNotes.length, 2)
  assert.deepEqual(p1.scopeNotes[1], { id: 'scope-op-a', opId: 'a', text: 'Idea para el contrato: Academia — Cursos para la comunidad', date: NOW.toISOString(), authorId: 'u1' })
  assert.ok(!p1.scopeNotes[1].text.includes('5000') && !p1.scopeNotes[1].text.includes('$'))
  assert.equal(alcanceConIdea(p1, o, true, 'u1', NOW), p1, 'marcar de nuevo no la duplica')
})

test('"No" o descartar saca la idea del Alcance y no toca las otras notas', () => {
  const o = op({ id: 'a', titulo: 'Academia' })
  const con = alcanceConIdea({ id: 'p1', scopeNotes: [{ id: 'n0', text: 'Nota previa' }] }, o, true, 'u1', NOW)
  const sin = alcanceConIdea(con, o, false)
  assert.deepEqual(sin.scopeNotes.map((n) => n.id), ['n0'])
  const intacto = { id: 'p1', scopeNotes: [{ id: 'n0' }] }
  assert.equal(alcanceConIdea(intacto, o, false), intacto)
  assert.deepEqual(alcanceConIdea({ id: 'p1' }, o, true, '', NOW).scopeNotes.length, 1)
})

test('totales: lo mensual va aparte y lo destildado no suma', () => {
  const m = armarPropuesta({ project, client, items, now: NOW })
  m.bloques.forEach((b) => { b.monto = b.sugerido })
  assert.deepEqual({ u: totalesPropuesta(m).unico, m: totalesPropuesta(m).mensual }, { u: 5000, m: 300 })
  m.bloques[2].incluir = true
  assert.equal(totalesPropuesta(m).unico, 6000)
  m.bloques[2].monto = 0
  assert.equal(totalesPropuesta(m).sinPrecio, 1)
})

test('el documento trae el branding, los bloques y la inversión', () => {
  const m0 = armarPropuesta({ project, client, items, now: NOW })
  m0.bloques.forEach((b) => { b.monto = b.sugerido })
  const html = propuestaHtml(m0)
  for (const t of ['insights.', 'Propuesta comercial · Noviembre 2026', 'Bloque A · Fase 2', 'Bloque B · Plan mensual', '$5.000', '$300', 'por mes', 'USD 5.000', 'Plazos y condiciones', 'Confidencial']) {
    assert.ok(html.includes(t), `falta: ${t}`)
  }
  assert.ok(!html.includes('Idea sin elegir'), 'una oportunidad destildada no debe salir')
})

test('lo que escribe el usuario nunca se vuelve HTML', () => {
  const m = armarPropuesta({ project, client, items, now: NOW })
  m.bloques[0].titulo = '<img src=x onerror=alert(1)>'
  m.bajada = '<script>alert(1)</script>'
  const html = propuestaHtml(m)
  assert.ok(!html.includes('<img src=x') && !html.includes('<script>alert'))
  assert.ok(html.includes('&lt;img src=x'))
  assert.equal(esc('a&b"c'), 'a&amp;b&quot;c')
})

test('si solo algunos tienen precio, los otros no muestran dinero ni "A cotizar"', () => {
  const m = armarPropuesta({ project, client, items, now: NOW })
  m.bloques[0].monto = 5000
  const html = propuestaHtml(m)
  assert.ok(html.includes('$5.000') && html.includes('Inversión'))
  assert.ok(!html.includes('A cotizar') && html.includes('Mantenimiento'), 'el bloque sin precio sigue en la propuesta')
  assert.equal((html.match(/class="ln"/g) || []).length, 1, 'solo el que tiene precio figura en la inversión')
})

test('las secciones vacías no aparecen', () => {
  const m = armarPropuesta({ project, client, items, now: NOW })
  m.condiciones = ''
  const html = propuestaHtml(m)
  assert.ok(!html.includes('Plazos y condiciones') && !html.includes('Dónde estamos') && !html.includes('No incluido'))
})
