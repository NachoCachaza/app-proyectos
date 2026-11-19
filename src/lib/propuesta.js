/*
 * Propuesta comercial armada con las oportunidades de un proyecto (pedido de Nacho, 19/11):
 * el diseño es el del PDF "Propuesta Evoria FASE 2" (portada con tabla de cliente, bloques
 * con precio, inversión, no incluido, plazos y cierre oscuro).
 *
 * Puro y sin React: `armarPropuesta` da el modelo editable, `totalesPropuesta` suma lo que
 * entra, y `propuestaHtml` devuelve el documento completo listo para imprimir a PDF.
 * Lo usan la ventana de Oportunidades y tests/propuesta.test.js.
 */

import { categoriaMeta, normalizeOpportunity, sinViejas } from './oportunidades.js'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export const CONDICIONES_BASE = [
  'Los bloques se coordinan con el equipo de Insights y se solapan cuando se puede, sin interferir con el soporte de lo que ya está en producción.',
  'Se incluyen 60 días de soporte técnico garantizado desde el deploy de cada bloque, y el código fuente se transfiere al Cliente conforme al contrato vigente.',
  'No incluye, y queda a cargo del Cliente: los costos de proveedores externos (infraestructura, almacenamiento y servicios de terceros) que escalan con el uso, y el desarrollo de fases nuevas, que se cotiza aparte.',
].join('\n\n')

export const mesAnio = (now = new Date()) => `${MESES[now.getMonth()]} ${now.getFullYear()}`

/** 8.500 — miles con punto, sin depender de la configuración regional de quien corre esto. */
export const miles = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
export const dolares = (n) => '$' + miles(n)

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const letra = (i) => String.fromCharCode(65 + (i % 26))
const lineas = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean)
const parrafos = (t) => String(t || '').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)

/** Entra tildada en la propuesta: la que se marcó "Agregar a la propuesta: Sí" (enPropuesta) o ya se ofreció. */
const entra = (o) => o.estado === 'ofrecida' || o.enPropuesta === true

/** Las oportunidades que se pueden poner en la propuesta: todas menos las descartadas, las tildadas primero. */
export function oportunidadesParaPropuesta(items = [], projectId) {
  const orden = (o) => (entra(o) ? 0 : 1)
  return (items || [])
    .filter((o) => o && o.projectId === projectId && o.estado !== 'descartada' && (sinViejas(normalizeOpportunity(o)) || o.enPropuesta === true))
    .sort((a, b) => orden(a) - orden(b) || (a.orden || 0) - (b.orden || 0))
}

/**
 * "Idea del contrato" (pedido de Nacho, 19/11): lo que se marca "Agregar a la propuesta: Sí" queda
 * anotado en el Alcance del proyecto (project.scopeNotes). La nota se vincula con `opId` y tiene id
 * determinístico: marcar dos veces no la duplica y pasar a "No" (o descartar) la saca. Sin precios.
 */
export function alcanceConIdea(project, op, si, authorId = '', now = new Date()) {
  const notas = project?.scopeNotes || []
  const resto = notas.filter((n) => n.opId !== op.id)
  if (si !== true) return resto.length === notas.length ? project : { ...project, scopeNotes: resto }
  if (notas.some((n) => n.opId === op.id)) return project
  const detalle = [op.titulo, op.porQue].filter(Boolean).join(' — ')
  return {
    ...project,
    scopeNotes: [...notas, { id: 'scope-op-' + op.id, opId: op.id, text: `Idea para el contrato: ${detalle}`, date: now.toISOString(), authorId: authorId || '' }],
  }
}

/** Modelo editable de la propuesta: todo texto que el usuario puede tocar antes de bajar el PDF. */
export function armarPropuesta({ project, client = null, items = [], now = new Date() } = {}) {
  const ops = oportunidadesParaPropuesta(items, project?.id)
  const elegidas = ops.filter(entra)
  const cats = [...new Set((elegidas.length ? elegidas : ops).map((o) => categoriaMeta(o.categoria).label))]
  const nombre = project?.name || 'Proyecto'
  return {
    titulo: nombre,
    acento: 'Próxima fase',
    subtitulo: cats.join(', '),
    fecha: mesAnio(now),
    bajada: '',
    cliente: [client?.name, client?.company].filter(Boolean).join(' — '),
    antecedente: '',
    donde: '',
    bloques: ops.map((o) => ({
      id: o.id,
      incluir: entra(o),
      categoria: categoriaMeta(o.categoria).label,
      titulo: o.titulo || '',
      descripcion: o.porQue || '',
      // El precio lo pone quien arma la propuesta (pedido de Nacho): la estimación de la IA
      // queda solo como sugerencia visible en el formulario y nunca entra al documento sola.
      monto: 0,
      sugerido: o.montoUsd || 0,
      cobro: o.cobro === 'mensual' ? 'mensual' : 'unico',
      plazo: '',
    })),
    noIncluido: '',
    condiciones: CONDICIONES_BASE,
    cierre1: `${nombre} ya está andando.`,
    cierre2: 'Hagamos que dé el próximo paso.',
    cierreTexto: '',
  }
}

/** Lo que entra en la propuesta y cuánto suma: lo mensual va aparte de lo que se paga una vez. */
export function totalesPropuesta(m) {
  const entran = (m?.bloques || []).filter((b) => b.incluir)
  const sum = (arr) => arr.reduce((t, b) => t + (Number(b.monto) > 0 ? Number(b.monto) : 0), 0)
  return {
    entran,
    unico: sum(entran.filter((b) => b.cobro !== 'mensual')),
    mensual: sum(entran.filter((b) => b.cobro === 'mensual')),
    sinPrecio: entran.filter((b) => !(Number(b.monto) > 0)).length,
  }
}

const CSS = `
@page{size:A4;margin:16mm 15mm 20mm}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'Inter',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1b1f;font-size:13px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.top{display:flex;justify-content:space-between;align-items:center;padding:0 0 14px;border-bottom:1px solid #e6e6ea}
.logo{font-weight:800;font-size:17px;letter-spacing:-.02em}
.tag{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#6b6b75;font-weight:600}
.rule{height:3px;background:#0a5ad4;margin:22px 0 14px}
.eyebrow{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:#0a5ad4;font-weight:700}
h1{font-size:30px;line-height:1.12;letter-spacing:-.025em;margin:10px 0 12px;font-weight:800}
h1 em{font-style:normal;color:#0a5ad4}
.lead{color:#44444c;font-size:13.5px;max-width:560px;margin:0 0 20px}
table.meta{width:100%;border-collapse:collapse;border:1px solid #dcdce2;margin:0 0 26px;font-size:12px}
table.meta td{padding:11px 16px;border-top:1px solid #dcdce2;vertical-align:top}
table.meta tr:first-child td{border-top:0}
table.meta td.k{width:132px;font-weight:700}
table.meta tr.hl td{background:#e8f0fd;color:#0a5ad4;font-weight:700}
table.meta tr.hl td.k{background:#0a5ad4;color:#fff}
h2{display:flex;align-items:baseline;gap:10px;font-size:17px;margin:26px 0 10px;padding-bottom:9px;border-bottom:1px solid #e6e6ea;letter-spacing:-.015em;break-after:avoid}
h2 small{font-size:9px;color:#8a8a94;font-weight:500;letter-spacing:.06em}
p{margin:0 0 11px}
.blk{border:1px solid #dcdce2;border-radius:6px;margin:0 0 14px;break-inside:avoid}
.blk .hd{display:flex;justify-content:space-between;gap:16px;padding:14px 18px 13px}
.blk .eb{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6b75;font-weight:600}
.blk .ti{font-size:15px;font-weight:800;margin-top:5px;letter-spacing:-.01em}
.blk .pr{text-align:right;flex:none}
.blk .pr b{display:block;font-size:22px;letter-spacing:-.02em}
.blk .pr span{font-size:10px;color:#6b6b75}
.blk .bd{padding:12px 18px 14px;border-top:1px solid #e6e6ea;font-size:12px;color:#44444c}
.inv{border:1px solid #0a5ad4;border-radius:6px;background:#eef4fe;padding:18px 22px;break-inside:avoid}
.inv .eb{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:#0a5ad4;font-weight:700}
.inv .row0{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;border-bottom:1px solid #cfd8e8}
.inv .row0 b{font-size:20px;display:block;margin-top:3px}
.inv .big{font-size:36px;font-weight:800;color:#0a5ad4;letter-spacing:-.03em;line-height:1}
.inv .big small{font-size:11px;font-weight:500;color:#6b6b75;letter-spacing:0;margin-left:4px}
.inv .ln{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #d8dfec;font-size:12.5px}
.inv .ln:last-child{border-bottom:0;padding-bottom:0}
.inv .ln b{font-variant-numeric:tabular-nums}
ul.arr{list-style:none;margin:0 0 11px;padding:0}
ul.arr li{position:relative;padding:0 0 7px 22px;font-size:12.5px}
ul.arr li::before{content:'→';position:absolute;left:0;color:#0a5ad4;font-weight:700}
.dark{background:#202023;color:#fff;border-radius:6px;padding:26px 28px;margin:22px 0 14px;break-inside:avoid}
.dark b{display:block;font-size:19px;letter-spacing:-.01em}
.dark b.ac{color:#6aa5ff;margin:0 0 10px}
.dark span{font-size:11.5px;color:#cfcfd6}
.small{text-align:center;font-size:9.5px;color:#8a8a94;margin-top:12px}
.foot{position:fixed;left:0;right:0;bottom:-13mm;text-align:center;font-size:9px;color:#8a8a94;border-top:1px solid #e6e6ea;padding-top:8px;background:#fff}
`

/** El documento completo. Todo texto del usuario pasa por `esc`: nunca se arma HTML con él. */
export function propuestaHtml(m) {
  const { entran, unico, mensual } = totalesPropuesta(m)
  const secciones = []
  let n = 0
  const sec = (titulo) => `<h2><small>${String(++n).padStart(2, '0')}</small>${esc(titulo)}</h2>`
  const conPrecio = unico > 0 || mensual > 0
  const tienePrecio = (b) => Number(b.monto) > 0
  const precioTxt = (b) => dolares(b.monto) + (b.cobro === 'mensual' ? ' por mes' : '')

  if (parrafos(m.donde).length) secciones.push(sec('Dónde estamos') + parrafos(m.donde).map((p) => `<p>${esc(p)}</p>`).join(''))

  secciones.push(sec(entran.length === 1 ? 'La propuesta' : 'Los bloques') + entran.map((b, i) => {
    // Sin precio no se muestra nada de dinero (se habla en la call): solo el plazo, si lo hay.
    const precio = tienePrecio(b)
      ? `<b>${dolares(b.monto)}</b><span>${b.cobro === 'mensual' ? 'por mes' : esc(b.plazo)}</span>`
      : (b.plazo ? `<span>${esc(b.plazo)}</span>` : '')
    return `<div class="blk"><div class="hd"><div><div class="eb">Bloque ${letra(i)} · ${esc(b.categoria)}</div><div class="ti">${esc(b.titulo)}</div></div><div class="pr">${precio}</div></div>`
      + (b.descripcion ? `<div class="bd">${esc(b.descripcion)}</div>` : '') + '</div>'
  }).join(''))

  // La sección de Inversión solo existe si alguien le puso precio a algo; los bloques sin precio no figuran.
  if (conPrecio) {
    const lineasInv = entran.map((b, i) => (tienePrecio(b) ? `<div class="ln"><span>Bloque ${letra(i)} · ${esc(b.categoria)}</span><b>${precioTxt(b)}</b></div>` : '')).join('')
    secciones.push(sec('Inversión')
      + `<p>Lo cotizado suma <b>USD ${miles(unico)}</b>${mensual ? `, más <b>USD ${miles(mensual)} por mes</b>` : ''}.</p>`
      + `<div class="inv"><div class="row0"><div><div class="eb">Resumen</div><b>${esc(m.titulo)}</b></div><div class="big">${dolares(unico)}<small>USD</small></div></div>${lineasInv}</div>`)
  }

  if (lineas(m.noIncluido).length) secciones.push(sec('No incluido') + '<ul class="arr">' + lineas(m.noIncluido).map((l) => `<li>${esc(l)}</li>`).join('') + '</ul>')
  if (parrafos(m.condiciones).length) secciones.push(sec('Plazos y condiciones') + parrafos(m.condiciones).map((p) => `<p>${esc(p)}</p>`).join(''))

  const filaMeta = (k, v, cls = '') => (v ? `<tr${cls ? ` class="${cls}"` : ''}><td class="k">${k}</td><td>${esc(v)}</td></tr>` : '')
  const resumen = conPrecio
    ? `USD ${miles(unico)}${mensual ? ` + USD ${miles(mensual)} por mes` : ''} — ${entran.length} ${entran.length === 1 ? 'bloque' : 'bloques'}`
    : entran.map((b) => b.titulo).filter(Boolean).join(' · ')

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(m.titulo)} — Propuesta comercial</title>`
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
    + `<style>${CSS}</style></head><body>`
    + '<div class="top"><span class="logo">insights.</span><span class="tag">Insights Apps LLC · Propuesta comercial</span></div><div class="rule"></div>'
    + `<div class="eyebrow">Propuesta comercial · ${esc(m.fecha)}</div>`
    + `<h1>${esc(m.titulo)}${m.acento ? ` — <em>${esc(m.acento)}</em>` : ''}${m.subtitulo ? `<br>${esc(m.subtitulo)}` : ''}</h1>`
    + (m.bajada ? `<p class="lead">${esc(m.bajada)}</p>` : '')
    + `<table class="meta">${filaMeta('Cliente', m.cliente)}${filaMeta('Antecedente', m.antecedente)}${filaMeta(conPrecio ? 'Inversión' : 'Incluye', resumen, 'hl')}</table>`
    + secciones.join('')
    + `<div class="dark"><b>${esc(m.cierre1)}</b><b class="ac">${esc(m.cierre2)}</b>${m.cierreTexto ? `<span>${esc(m.cierreTexto)}</span>` : ''}</div>`
    + '<div class="small">Propuesta válida por 30 días desde la fecha de emisión.<br>INSIGHTS APPS LLC · 1000 Brickell Avenue, Suite 715, PMB 153, Miami, FL 33131, USA</div>'
    + '<div class="foot">Confidencial — Uso exclusivo de las partes · insightsapps.tech</div>'
    + '</body></html>'
}
