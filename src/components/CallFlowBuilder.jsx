// ============================================================
//  CallFlowBuilder — Phone setup → "Call flow" (2026-11-15). Drag-and-drop designer for an Advanced-engine
//  line: drag blocks from the palette, drag them around the canvas, drag from a block's ● output onto
//  another block to connect them (or pick the target in the side panel). Saved to inbound_lines.cx.flow;
//  "Use this flow" (cx.flow_on) makes cx-voice run it instead of the standard greeting → menu → queue.
//  Blocks: Say · Business hours (open / closed) · Known caller? (known / new) · Menu (keys + speech, optional
//  "understand what callers say") · Queue (queue, skill, priority) · Digital assistant · Voicemail ·
//  Transfer to a number · Hang up.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const G = '#14302A'
const GT = 'light-dark(#14302A, #9fd6bd)'  // brand green for text/lines: lighter in dark mode
const W = 210
const TYPES = {
  say: { label: 'Say', color: 'light-dark(#0f766e, #1dc9bb)', outs: () => [['next', 'Then']] },
  hours: { label: 'Business hours', color: 'light-dark(#1d4ed8, #7090eb)', outs: () => [['open', 'Open'], ['closed', 'Closed']] },
  caller: { label: 'Known caller?', color: 'light-dark(#7c3aed, #a378ec)', outs: () => [['known', 'Known customer'], ['unknown', 'New caller']] },
  menu: { label: 'Menu', color: 'light-dark(#b45309, #e07524)', outs: n => [...(n.options || []).map((o, k) => [`opt:${k}`, `${o.key} · ${o.label || '…'}`]), ['timeout_next', 'No answer']] },
  queue: { label: 'Queue', color: 'light-dark(#15803d, #20c55e)', outs: () => [] },
  ai: { label: 'Digital assistant', color: 'light-dark(#0369a1, #1f98db)', outs: () => [] },
  voicemail: { label: 'Voicemail', color: 'light-dark(#475569, #b3c1c7)', outs: () => [] },
  transfer: { label: 'Transfer', color: 'light-dark(#be123c, #e96384)', outs: () => [['next', 'If no number']] },
  hangup: { label: 'Hang up', color: 'light-dark(#334155, #b3c1c7)', outs: () => [] },
}
const getOut = (n, port) => (port.startsWith('opt:') ? n.options?.[Number(port.slice(4))]?.next : n[port]) || null
const setOut = (n, port, to) => (port.startsWith('opt:')
  ? { ...n, options: n.options.map((o, k) => (k === Number(port.slice(4)) ? { ...o, next: to } : o)) }
  : { ...n, [port]: to })
const uid = () => 'n' + Math.random().toString(36).slice(2, 8)

function template(line) {
  return {
    start: 'greet',
    nodes: {
      greet: { type: 'say', x: 30, y: 40, text: line.greeting || `Thanks for calling ${line.brand || 'us'}.`, next: 'hrs' },
      hrs: { type: 'hours', x: 290, y: 40, open: 'menu', closed: 'aiq' },
      menu: { type: 'menu', x: 550, y: 40, nl: false, prompt: '', options: [
        { key: '1', label: 'Repair or service', words: ['repair', 'broken', 'spring', 'opener'], next: 'q1' },
        { key: '2', label: 'New door quote', words: ['new door', 'quote', 'install'], next: 'q2' },
        { key: '3', label: 'Billing', words: ['bill', 'invoice', 'payment'], next: 'q3' }], timeout_next: 'q1' },
      q1: { type: 'queue', x: 830, y: 20, label: 'Service', queue: 'service', skill: '', priority: 0 },
      q2: { type: 'queue', x: 830, y: 150, label: 'Sales', queue: 'sales', skill: '', priority: 5 },
      q3: { type: 'queue', x: 830, y: 280, label: 'Billing', queue: 'billing', skill: '', priority: 0 },
      aiq: { type: 'ai', x: 550, y: 330 },
    },
  }
}

export default function CallFlowBuilder({ clientId = null }) {
  const args = useCallback(x => (clientId ? { ...x, p_client: clientId } : x), [clientId])
  const [d, setD] = useState(null)
  const [lineId, setLineId] = useState('')
  const [flow, setFlow] = useState(null)
  const [on, setOn] = useState(false)
  const [sel, setSel] = useState(null)
  const [link, setLink] = useState(null)      // { from, port, x, y }
  const [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const canvas = useRef(null), drag = useRef(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cx_setup_get', args({}))
    if (error) setErr(error.message); else setD(data)
  }, [args])
  useEffect(() => { load() }, [load])
  const line = useMemo(() => d?.lines?.find(l => l.id === lineId) || null, [d, lineId])
  useEffect(() => {
    if (!line) return
    setFlow(line.cx?.flow?.nodes ? JSON.parse(JSON.stringify(line.cx.flow)) : template(line))
    setOn(!!line.cx?.flow_on); setSel(null)
  }, [line])

  const nodes = flow?.nodes || {}
  const put = (id, n) => setFlow(f => ({ ...f, nodes: { ...f.nodes, [id]: n } }))
  const pt = e => { const r = canvas.current.getBoundingClientRect(); return { x: e.clientX - r.left + canvas.current.scrollLeft, y: e.clientY - r.top + canvas.current.scrollTop } }

  function onMove(e) {
    if (drag.current) { const p = pt(e); const { id, dx, dy } = drag.current; put(id, { ...nodes[id], x: Math.max(0, p.x - dx), y: Math.max(0, p.y - dy) }) }
    if (link) { const p = pt(e); setLink(l => ({ ...l, x: p.x, y: p.y })) }
  }
  function onUp() { drag.current = null; if (link) setLink(null) }
  function dropOn(id) { if (link && link.from !== id) { put(link.from, setOut(nodes[link.from], link.port, id)); setLink(null) } }
  function addNode(type) {
    const id = uid(), base = { type, x: 40 + Object.keys(nodes).length * 12, y: 380 + Object.keys(nodes).length * 8 }
    const extra = type === 'menu' ? { options: [{ key: '1', label: 'Option 1', words: [] }], prompt: '', nl: false } : type === 'queue' ? { label: 'Queue', queue: '', skill: '', priority: 0 } : type === 'say' ? { text: '' } : {}
    put(id, { ...base, ...extra }); setSel(id)
    if (!flow.start) setFlow(f => ({ ...f, start: id }))
  }
  function remove(id) {
    setFlow(f => {
      const n2 = {}
      for (const [k, v] of Object.entries(f.nodes)) {
        if (k === id) continue
        let w = { ...v }
        for (const [port] of TYPES[v.type].outs(v)) if (getOut(w, port) === id) w = setOut(w, port, null)
        n2[k] = w
      }
      return { start: f.start === id ? Object.keys(n2)[0] || null : f.start, nodes: n2 }
    })
    setSel(null)
  }
  const problems = useMemo(() => {
    const p = []
    if (!flow?.start || !nodes[flow.start]) p.push('Pick a start block.')
    for (const [id, n] of Object.entries(nodes)) {
      const name = `“${TYPES[n.type].label}${n.label ? ' · ' + n.label : ''}”`
      if (n.type === 'menu') (n.options || []).forEach(o => { if (!o.next) p.push(`${name}: option ${o.key} isn’t connected.`) })
      if (n.type === 'hours' && !n.open) p.push(`${name}: “Open” isn’t connected.`)
      if (n.type === 'say' && !n.next) p.push(`${name}: “Then” isn’t connected (callers would go to the line’s default queue).`)
      if (n.type === 'transfer' && String(n.number || '').replace(/\D/g, '').length < 10) p.push(`${name}: add a 10-digit number.`)
      if (id === flow.start) continue
      const reached = Object.values(nodes).some(m => TYPES[m.type].outs(m).some(([port]) => getOut(m, port) === id))
      if (!reached) p.push(`${name} isn’t connected to anything.`)
    }
    return p
  }, [flow, nodes])

  async function save(flowOn) {
    const clean = { start: flow.start, nodes: Object.fromEntries(Object.entries(nodes).map(([k, n]) => [k, n.type === 'menu' ? { ...n, options: (n.options || []).map(o => ({ ...o, key: String(o.key) })) } : n])) }
    const { error } = await supabase.rpc('cx_line_cx_save', args({ p_line: line.id, p_engine: line.engine, p_cx: { ...(line.cx || {}), flow: clean, flow_on: flowOn } }))
    if (error) { setErr(error.message); return }
    setErr(''); setOn(flowOn); setMsg(flowOn ? 'Saved — calls now follow this flow.' : 'Saved.'); setTimeout(() => setMsg(''), 3000); load()
  }

  if (err && !d) return <div style={S.card}><b>Couldn’t load call flows.</b><p style={S.mut}>{err}</p></div>
  if (!d) return <div style={S.card}>Loading…</div>
  const conf = (d.lines || []).filter(l => l.engine === 'conf')
  const n = sel ? nodes[sel] : null
  const port = (id, k) => ({ x: nodes[id].x + W, y: nodes[id].y + 62 + k * 24 })   // header 28 + summary 22 + row 24

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <div style={S.h2}>Call flow</div>
          <div style={S.mut}>Design what callers hear and where they go. Only lines on the Advanced engine can use a call flow.</div>
        </div>
        <select value={lineId} onChange={e => setLineId(e.target.value)} style={S.input}>
          <option value="">Pick a line…</option>{conf.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      {conf.length === 0 && <div style={S.card}><div style={S.mut}>No Advanced-engine lines yet. Switch a line to Advanced in Phone setup → Advanced engine first.</div></div>}
      {line && flow && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14, alignItems: 'start' }}>
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {Object.entries(TYPES).map(([t, v]) => <button key={t} onClick={() => addNode(t)} style={{ ...S.small, borderColor: v.color, color: v.color }}>+ {v.label}</button>)}
              <button onClick={() => { if (window.confirm('Replace this flow with the starter template?')) { setFlow(template(line)); setSel(null) } }} style={S.small}>Start over</button>
            </div>
            <div ref={canvas} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
              style={{ position: 'relative', height: 560, overflow: 'auto', background: 'radial-gradient(light-dark(#e2e8f0, #222c31) 1px, transparent 1px) 0 0 / 18px 18px', borderRadius: 10, border: '1px solid light-dark(#e2e8f0, #2a3439)', touchAction: 'none' }}>
              <svg style={{ position: 'absolute', inset: 0, width: 2000, height: 1400, pointerEvents: 'none' }}>
                <defs><marker id="cfb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#64748b" /></marker></defs>
                {Object.entries(nodes).flatMap(([id, m]) => TYPES[m.type].outs(m).map(([p], k) => {
                  const to = getOut(m, p); if (!to || !nodes[to]) return null
                  const a = port(id, k), b = { x: nodes[to].x, y: nodes[to].y + 16 }, mx = (a.x + b.x) / 2
                  return <path key={id + p} d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 2},${b.y}`} fill="none" stroke="#64748b" strokeWidth="1.6" markerEnd="url(#cfb-arrow)" />
                }))}
                {link && (() => { const k = TYPES[nodes[link.from].type].outs(nodes[link.from]).findIndex(([p]) => p === link.port); const a = port(link.from, k); return <path d={`M${a.x},${a.y} L${link.x},${link.y}`} stroke={G} strokeDasharray="4 3" strokeWidth="1.6" fill="none" /> })()}
              </svg>
              {Object.entries(nodes).map(([id, m]) => {
                const T = TYPES[m.type]
                return (
                  <div key={id} onPointerUp={() => dropOn(id)} onClick={() => setSel(id)}
                    style={{ position: 'absolute', left: m.x, top: m.y, width: W, background: 'light-dark(#fff, #161d21)', borderRadius: 10, boxShadow: sel === id ? `0 0 0 2px ${T.color}` : '0 1px 3px rgba(0,0,0,0.15)', border: `1px solid ${link && link.from !== id ? T.color : '#e2e8f0'}`, userSelect: 'none' }}>
                    <div onPointerDown={e => { const p = pt(e); drag.current = { id, dx: p.x - m.x, dy: p.y - m.y }; e.preventDefault() }}
                      style={{ background: T.color, color: '#fff', borderRadius: '9px 9px 0 0', height: 28, boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, fontWeight: 800, cursor: 'grab', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{flow.start === id ? '▶ ' : ''}{T.label}</span><span style={{ opacity: 0.8 }}>⠿</span>
                    </div>
                    <div style={{ height: 22, boxSizing: 'border-box', padding: '4px 8px', fontSize: 11.5, color: 'light-dark(#475569, #b3c1c7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.type === 'say' ? (m.text || '…') : m.type === 'queue' ? `${m.label || m.queue || 'Queue'}${m.skill ? ' · ' + m.skill : ''}` : m.type === 'transfer' ? (m.number || 'No number') : m.type === 'menu' ? (m.nl ? 'Keys + understands speech' : 'Keys + simple words') : ''}
                    </div>
                    {T.outs(m).map(([p, l]) => (
                      <div key={p} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, padding: '0 0 0 8px', height: 24, boxSizing: 'border-box' }}>
                        <span style={{ color: getOut(m, p) ? '#0f172a' : '#b45309' }}>{l}</span>
                        <span title="Drag onto another block to connect" onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const q = pt(e); setLink({ from: id, port: p, x: q.x, y: q.y }) }}
                          style={{ width: 14, height: 14, borderRadius: 7, background: getOut(m, p) ? T.color : '#fff', border: `2px solid ${T.color}`, marginRight: -7, cursor: 'crosshair' }} />
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            <div style={{ ...S.mut, marginTop: 6 }}>Drag a block by its colored bar. Drag from a ● onto another block to connect. Click a block to edit it.</div>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div style={S.card}>
              {!n && <div style={S.mut}>Click a block to edit it.</div>}
              {n && (
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  <div style={{ ...S.h3, color: TYPES[n.type].color }}>{TYPES[n.type].label}</div>
                  {n.type === 'say' && <>
                    <label>What callers hear<textarea rows={3} value={n.text || ''} onChange={e => put(sel, { ...n, text: e.target.value })} style={S.field} /></label>
                    <label>…or a recording (MP3 link)<input value={n.audio_url || ''} onChange={e => put(sel, { ...n, audio_url: e.target.value })} style={S.field} /></label>
                  </>}
                  {n.type === 'hours' && <div style={S.mut}>Uses the line’s hours, holidays and storm closures. When closed, the closure message plays first.</div>}
                  {n.type === 'caller' && <div style={S.mut}>“Known” = the number matches a customer, a team member, or someone a CSR talked to recently.</div>}
                  {n.type === 'menu' && <>
                    <label>Prompt (optional)<input value={n.prompt || ''} onChange={e => put(sel, { ...n, prompt: e.target.value })} placeholder="Read automatically from the options" style={S.field} /></label>
                    <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={!!n.nl} onChange={e => put(sel, { ...n, nl: e.target.checked })} /> Understand what callers say (AI)</label>
                    {(n.options || []).map((o, k) => (
                      <div key={k} style={{ border: '1px solid light-dark(#e2e8f0, #2a3439)', borderRadius: 8, padding: 6, display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input value={o.key} onChange={e => put(sel, { ...n, options: n.options.map((x, j) => (j === k ? { ...x, key: e.target.value.replace(/\D/g, '').slice(0, 1) } : x)) })} style={{ ...S.field, width: 36 }} />
                          <input value={o.label} onChange={e => put(sel, { ...n, options: n.options.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} placeholder="Label" style={{ ...S.field, flex: 1 }} />
                          <button style={S.x} onClick={() => put(sel, { ...n, options: n.options.filter((_, j) => j !== k) })}>×</button>
                        </div>
                        <input value={(o.words || []).join(', ')} onChange={e => put(sel, { ...n, options: n.options.map((x, j) => (j === k ? { ...x, words: e.target.value.split(',').map(w => w.trim()).filter(Boolean) } : x)) })} placeholder="Words callers might say (comma separated)" style={S.field} />
                      </div>
                    ))}
                    <button style={S.small} onClick={() => put(sel, { ...n, options: [...(n.options || []), { key: String((n.options || []).length + 1), label: '', words: [] }] })}>+ Option</button>
                  </>}
                  {n.type === 'queue' && <>
                    <label>Name<input value={n.label || ''} onChange={e => put(sel, { ...n, label: e.target.value })} style={S.field} /></label>
                    <label>Queue<input value={n.queue || ''} onChange={e => put(sel, { ...n, queue: e.target.value })} placeholder="service, sales…" style={S.field} /></label>
                    <label>Skill needed (optional)<input value={n.skill || ''} onChange={e => put(sel, { ...n, skill: e.target.value })} placeholder="spanish" style={S.field} /></label>
                    <label>Priority (higher = answered first)<input type="number" value={n.priority || 0} onChange={e => put(sel, { ...n, priority: Number(e.target.value) || 0 })} style={S.field} /></label>
                  </>}
                  {n.type === 'transfer' && <label>Number<input value={n.number || ''} onChange={e => put(sel, { ...n, number: e.target.value })} placeholder="(555) 555-5555" style={S.field} /></label>}
                  {n.type === 'ai' && <div style={S.mut}>Sends the caller to the line’s AI CSR number (voicemail if none is set).</div>}
                  {TYPES[n.type].outs(n).length > 0 && <div style={{ display: 'grid', gap: 4 }}>
                    <div style={S.cap}>Goes to</div>
                    {TYPES[n.type].outs(n).map(([p, l]) => (
                      <label key={p} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ minWidth: 90 }}>{l}</span>
                        <select value={getOut(n, p) || ''} onChange={e => put(sel, setOut(n, p, e.target.value || null))} style={{ ...S.field, flex: 1 }}>
                          <option value="">— not connected —</option>
                          {Object.entries(nodes).filter(([k]) => k !== sel).map(([k, m]) => <option key={k} value={k}>{TYPES[m.type].label}{m.label ? ' · ' + m.label : m.type === 'say' && m.text ? ' · ' + m.text.slice(0, 24) : ''}</option>)}
                        </select></label>
                    ))}
                  </div>}
                  <div style={{ display: 'flex', gap: 6 }}>
                    {flow.start !== sel && <button style={S.small} onClick={() => setFlow(f => ({ ...f, start: sel }))}>▶ Make this the start</button>}
                    <button style={{ ...S.small, color: 'light-dark(#b91c1c, #e86464)' }} onClick={() => remove(sel)}>Delete block</button>
                  </div>
                </div>
              )}
            </div>
            <div style={S.card}>
              <div style={S.h3}>{on ? 'This line follows the flow' : 'Not in use yet'}</div>
              {problems.length > 0
                ? <ul style={{ margin: '6px 0', paddingLeft: 18, fontSize: 12.5, color: 'light-dark(#92400e, #e1712d)' }}>{problems.slice(0, 8).map(p => <li key={p}>{p}</li>)}</ul>
                : <div style={{ ...S.mut, color: 'light-dark(#166534, #29bc61)' }}>Every block is connected.</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <button style={S.small} onClick={() => save(on)}>Save</button>
                {!on && <button disabled={problems.some(p => /start|isn’t connected\.$|10-digit|Open/.test(p))} style={S.primary} onClick={() => save(true)}>Save & use this flow</button>}
                {on && <button style={S.small} onClick={() => save(false)}>Stop using it</button>}
              </div>
              {msg && <div style={{ color: 'light-dark(#166534, #29bc61)', fontSize: 13, marginTop: 6 }}>{msg}</div>}
              {err && <div style={{ color: 'light-dark(#b91c1c, #e86464)', fontSize: 13, marginTop: 6 }}>{err}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S = {
  card: { background: 'light-dark(#fff, #161d21)', border: '1px solid light-dark(#e2e8f0, #2a3439)', borderRadius: 14, padding: 14 },
  h2: { fontSize: 17, fontWeight: 800, color: GT, marginBottom: 4 },
  h3: { fontSize: 15, fontWeight: 800, color: GT, marginBottom: 4 },
  mut: { fontSize: 12.5, color: 'light-dark(#64748b, #9fb4bb)' },
  cap: { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'light-dark(#64748b, #9fb4bb)' },
  input: { padding: '7px 9px', fontSize: 13, borderRadius: 8, border: '1px solid light-dark(#cbd5e1, #3a464c)' },
  field: { display: 'block', width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13, borderRadius: 8, border: '1px solid light-dark(#cbd5e1, #3a464c)', marginTop: 3 },
  primary: { padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 10, border: 'none', background: G, color: '#fff', cursor: 'pointer' },
  small: { padding: '5px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid light-dark(#cbd5e1, #3a464c)', background: 'light-dark(#fff, #161d21)', cursor: 'pointer' },
  x: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: 'light-dark(#64748b, #9fb4bb)' },
}
