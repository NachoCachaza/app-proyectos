import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Field } from '../ui.jsx'
import { I2 } from '../ui/icons2.jsx'
import { armarPropuesta, propuestaHtml, totalesPropuesta, miles } from '../lib/propuesta.js'

/*
 * Ventana "Crear propuesta" (pedido de Nacho, 19/11): arma la propuesta comercial con el
 * diseño del PDF de Evoria a partir de las oportunidades del proyecto. A la izquierda se
 * edita todo; a la derecha se ve el documento tal cual sale. "Descargar PDF" abre el
 * diálogo de impresión del navegador sobre ese mismo documento (Guardar como PDF).
 *
 * No escribe nada en la base: es un documento que se arma y se baja.
 */

const CSS = `
.pp-wrap{display:grid;grid-template-columns:minmax(320px,420px) 1fr;gap:18px;align-items:start}
.pp-form{display:flex;flex-direction:column;gap:12px;max-height:68vh;overflow-y:auto;padding-right:6px}
.pp-form h4{margin:8px 0 0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint)}
.pp-blk{display:flex;flex-direction:column;gap:7px;padding:11px;border-radius:12px;background:var(--bg-elevated);box-shadow:inset 0 0 0 1px var(--border)}
.pp-blk.off{opacity:.55}
.pp-blk label.chk{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:650;cursor:pointer}
.pp-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
.pp-prev{height:68vh;border-radius:12px;box-shadow:inset 0 0 0 1px var(--border);overflow:hidden;background:#fff}
.pp-prev iframe{width:100%;height:100%;border:0;background:#fff}
.pp-form.lock{opacity:.4;pointer-events:none}
.pp-bar{margin:0 0 8px;padding:8px 11px;border-radius:10px;font-size:12.5px;line-height:1.45;color:var(--text);background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-line)}
.pp-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
.pp-foot .sum{margin-right:auto;font-size:12.5px;color:var(--text-dim)}
@media (max-width:900px){.pp-wrap{grid-template-columns:1fr}.pp-prev{height:50vh}.pp-form{max-height:none}}
`

const F = ({ k, label, m, set, area = false, rows = 3, ph = '' }) => (
  <Field label={label}>
    {area
      ? <textarea className="input" rows={rows} value={m[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} style={{ resize: 'vertical', fontSize: 13 }} />
      : <input className="input" value={m[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} style={{ fontSize: 13 }} />}
  </Field>
)

export function PropuestaModal({ open, onClose, project, client, items }) {
  const [m, setM] = useState(null)
  const frame = useRef(null)
  // Edición directa: el documento se vuelve escribible tal cual se ve. Mientras dura, deja de
  // regenerarse desde los campos (`congelado`) para no pisar lo que se escribió adentro.
  const [directo, setDirecto] = useState(false)
  const [congelado, setCongelado] = useState('')
  const [rev, setRev] = useState(0)
  const editado = useRef(false)
  // El modelo se arma al abrir, no en cada render: lo editado no se pisa si cambian las oportunidades.
  useEffect(() => { if (open) { setM(armarPropuesta({ project, client, items })); setDirecto(false); editado.current = false } }, [open, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => (m ? propuestaHtml(m) : ''), [m])
  const tot = m ? totalesPropuesta(m) : null
  const set = (k, v) => setM((x) => ({ ...x, [k]: v }))
  const setBloque = (id, k, v) => setM((x) => ({ ...x, bloques: x.bloques.map((b) => (b.id === id ? { ...b, [k]: v } : b)) }))
  const agregarBloque = () => setM((x) => ({ ...x, bloques: [...x.bloques, { id: 'manual-' + Date.now(), manual: true, incluir: true, categoria: 'Servicio', titulo: '', descripcion: '', monto: 0, cobro: 'unico', plazo: '' }] }))
  const quitarBloque = (id) => setM((x) => ({ ...x, bloques: x.bloques.filter((b) => b.id !== id) }))
  const entrarDirecto = () => {
    const d = frame.current?.contentDocument
    if (!d) return
    setCongelado(html)
    d.designMode = 'on'
    const st = d.createElement('style')
    st.textContent = '@media screen{body{outline:2px dashed rgba(10,90,212,.45);outline-offset:-2px;cursor:text}}' // solo en pantalla: no sale en el PDF
    d.head.appendChild(st)
    d.addEventListener('input', () => { editado.current = true })
    setDirecto(true)
  }
  const salirDirecto = () => {
    if (editado.current && !window.confirm('Los cambios que hiciste dentro del documento se pierden al volver a los campos. ¿Seguir?')) return
    editado.current = false
    setRev((r) => r + 1) // recarga el documento desde los campos
    setDirecto(false)
  }
  const imprimir = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print() } }

  return (
    <Modal open={open && !!m} onClose={onClose} title="Crear propuesta" sub={project?.name} width={1180}>
      <style>{CSS}</style>
      {m && (
        <>
          <div className="pp-wrap">
            <div className={`pp-form${directo ? ' lock' : ''}`}>
              <h4>Portada</h4>
              <F k="titulo" label="Título" m={m} set={set} />
              <div className="pp-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <F k="acento" label="En azul" m={m} set={set} ph="FASE 2" />
                <F k="fecha" label="Fecha" m={m} set={set} />
              </div>
              <F k="subtitulo" label="Subtítulo" m={m} set={set} ph="Academia, Fidelización y Avisos" />
              <F k="bajada" label="Bajada (opcional)" m={m} set={set} area rows={2} />
              <F k="cliente" label="Cliente" m={m} set={set} />
              <F k="antecedente" label="Antecedente (opcional)" m={m} set={set} area rows={2} ph="FASE 1 — contrato Agosto 2026, USD 6.800" />

              <h4>Bloques de la propuesta</h4>
              {m.bloques.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: 0 }}>Este proyecto todavía no tiene oportunidades. Agregá un bloque a mano o buscalas con "Buscar oportunidades".</p>}
              {m.bloques.map((b) => (
                <div key={b.id} className={`pp-blk${b.incluir ? '' : ' off'}`}>
                  <label className="chk"><input type="checkbox" checked={b.incluir} onChange={(e) => setBloque(b.id, 'incluir', e.target.checked)} /> {b.manual ? 'Bloque a mano' : b.categoria}
                    {b.manual && <button type="button" className="btn btn-sm btn-ghost" onClick={(e) => { e.preventDefault(); quitarBloque(b.id) }} title="Quitar este bloque" style={{ marginLeft: 'auto', padding: 4 }}><I2.trash width={13} height={13} /></button>}
                  </label>
                  <input className="input" value={b.titulo} onChange={(e) => setBloque(b.id, 'titulo', e.target.value)} aria-label="Título del bloque" style={{ fontSize: 13 }} />
                  <textarea className="input" rows={3} value={b.descripcion} onChange={(e) => setBloque(b.id, 'descripcion', e.target.value)} aria-label="Descripción del bloque" style={{ resize: 'vertical', fontSize: 12.5 }} />
                  <div className="pp-row">
                    <input className="input" type="number" min="0" value={b.monto || ''} onChange={(e) => setBloque(b.id, 'monto', Number(e.target.value) || 0)} placeholder={b.sugerido ? `USD · sugerido ${miles(b.sugerido)}` : 'USD'} title={b.sugerido ? 'La IA estimó este monto; no se agrega solo.' : undefined} aria-label="Precio en USD" style={{ fontSize: 13 }} />
                    <select className="input" value={b.cobro} onChange={(e) => setBloque(b.id, 'cobro', e.target.value)} aria-label="Cobro" style={{ fontSize: 13 }}>
                      <option value="unico">Pago único</option>
                      <option value="mensual">Por mes</option>
                    </select>
                    <input className="input" value={b.plazo} onChange={(e) => setBloque(b.id, 'plazo', e.target.value)} placeholder="3–4 semanas" aria-label="Plazo" style={{ fontSize: 13 }} />
                  </div>
                </div>
              ))}

              <button type="button" className="btn btn-sm" onClick={agregarBloque} style={{ alignSelf: 'flex-start' }}><I2.plus width={13} height={13} /> Agregar bloque</button>

              <h4>Texto</h4>
              <F k="donde" label="Dónde estamos (opcional)" m={m} set={set} area rows={4} />
              <F k="noIncluido" label="No incluido (una por línea)" m={m} set={set} area rows={3} ph="Evoria Radio — a cotizar cuando…" />
              <F k="condiciones" label="Plazos y condiciones" m={m} set={set} area rows={7} />
              <F k="cierre1" label="Cierre, línea 1" m={m} set={set} />
              <F k="cierre2" label="Cierre, línea 2 (en azul)" m={m} set={set} />
              <F k="cierreTexto" label="Cierre, texto (opcional)" m={m} set={set} area rows={2} />
            </div>

            <div>
              {directo && <div className="pp-bar" role="status">Editando en el documento: hacé clic en cualquier texto y escribí. Podés borrar o agregar líneas. Los campos de la izquierda quedan en pausa.</div>}
              <div className="pp-prev"><iframe key={rev} ref={frame} title="Vista previa de la propuesta" srcDoc={directo ? congelado : html} /></div>
            </div>
          </div>

          <div className="pp-foot">
            <span className="sum">
              {tot.entran.length} {tot.entran.length === 1 ? 'bloque' : 'bloques'}
              {tot.unico || tot.mensual ? ` · USD ${miles(tot.unico)}${tot.mensual ? ` + USD ${miles(tot.mensual)} por mes` : ''}` : ' · sin precios'}
            </span>
            {directo
              ? <button type="button" className="btn" onClick={salirDirecto}><I2.refresh width={15} height={15} /> Volver a los campos</button>
              : <button type="button" className="btn" onClick={entrarDirecto} title="Hacé clic sobre el texto del documento y escribí ahí"><I2.pencil width={15} height={15} /> Editar en el documento</button>}
            <button type="button" className="btn" onClick={onClose}>Cerrar</button>
            <button type="button" className="btn btn-accent" onClick={imprimir} disabled={!tot.entran.length}><I2.pdf width={15} height={15} /> Descargar PDF</button>
          </div>
        </>
      )}
    </Modal>
  )
}
