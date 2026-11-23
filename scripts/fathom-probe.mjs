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
