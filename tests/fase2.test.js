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

import { puedeVerFase2, puedeEditarFase2 } from '../src/lib/fase2.js'

test('Fase 2: la ven fundadores y lectura; la edita sólo el acceso completo; un developer nunca', () => {
  const fundador = { access: 'full', role: 'fundador' }
  const pm = { access: 'full', role: 'pm' }
  const sinRol = { access: 'full', role: '' }
  const lector = { access: 'read', role: 'pm' }
  assert.equal(puedeVerFase2(fundador), true)
  assert.equal(puedeEditarFase2(fundador), true)
  assert.equal(puedeVerFase2(pm), true)
  assert.equal(puedeEditarFase2(sinRol), true)
  assert.equal(puedeVerFase2(lector), true)
  assert.equal(puedeEditarFase2(lector), false)

  for (const role of ['dev', 'Developer', ' DEVS ', 'desarrolladora', 'desarrollo']) {
    const dev = { access: 'full', role }
    assert.equal(puedeVerFase2(dev), false, `no debería ver: ${role}`)
    assert.equal(puedeEditarFase2(dev), false, `no debería editar: ${role}`)
  }
  assert.equal(puedeVerFase2({ access: 'read', role: 'dev' }), false)

  for (const access of ['collab', 'project', '', undefined]) {
    assert.equal(puedeVerFase2({ access, role: 'pm' }), false)
    assert.equal(puedeEditarFase2({ access, role: 'pm' }), false)
  }
  assert.equal(puedeVerFase2(null), false)
  assert.equal(puedeEditarFase2(undefined), false)
})

import { llamadaTrabada, MAX_ESPERA_CALL_MS } from '../src/lib/fase2.js'

test('llamadaTrabada: sólo una call en curso que lleva más de seis minutos sin moverse', () => {
  const t0 = '2026-11-23T10:00:00.000Z'
  const ahora = (min) => new Date(Date.parse(t0) + min * 60 * 1000)
  const analizando = { kind: 'call', estado: 'analizando', updatedAt: t0, at: t0 }
  assert.equal(MAX_ESPERA_CALL_MS, 6 * 60 * 1000)
  assert.equal(llamadaTrabada(analizando, ahora(2)), false)
  assert.equal(llamadaTrabada(analizando, ahora(6)), false)
  assert.equal(llamadaTrabada(analizando, ahora(7)), true)
  assert.equal(llamadaTrabada({ ...analizando, estado: 'bajando' }, ahora(10)), true)
  assert.equal(llamadaTrabada({ ...analizando, estado: 'lista' }, ahora(60)), false)
  assert.equal(llamadaTrabada({ ...analizando, estado: 'error' }, ahora(60)), false)
  assert.equal(llamadaTrabada({ kind: 'nota', estado: 'analizando', updatedAt: t0 }, ahora(60)), false)
  assert.equal(llamadaTrabada({ ...analizando, updatedAt: null, at: t0 }, ahora(7)), true)
  assert.equal(llamadaTrabada({ kind: 'call', estado: 'analizando' }, ahora(60)), false)
  assert.equal(llamadaTrabada(null, ahora(60)), false)
})
