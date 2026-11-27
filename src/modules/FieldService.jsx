// Field Service (FSM) v1 — GarageCo portal, Becky 11/27.
// Book (route-aware best times) · Dispatch board (drag to move) · Funnel (repair → new door) · Team links.
// Data: fsm_* RPCs (qa_client_access + brand lock). Techs/reps use a secret link: /tech/:token (TechDay.jsx).
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const TZ = 'America/Chicago'
const C = {
  card: { background: 'var(--surface,#fff)', border: '1px solid var(--line,#E8E4DC)', borderRadius: 12, padding: 16 },
  btn: { background: 'var(--accent,#2F7D5B)', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  ghost: { background: 'transparent', color: 'var(--ink,#1C2421)', border: '1px solid var(--line,#E8E4DC)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13 },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--line,#E8E4DC)', borderRadius: 8, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ink-soft,#5F6763)', marginBottom: 4, display: 'block' },
  soft: { color: 'var(--ink-soft,#5F6763)', fontSize: 13 },
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const OUT = { repair_done: ['Repaired', '#2F7D5B'], new_door_opp: ['New-door opp', '#B45309'], needs_part: ['Needs part', '#6B7280'], declined: ['Declined', '#A8441A'], sold: ['Sold', '#2F7D5B'], not_sold: ['Not sold', '#A8441A'] }

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export default function FieldService({ clientId }) {
  const [brands, setBrands] = useState(null)
  const [brand, setBrand] = useState('')
  const [tab, setTab] = useState('book')
  const [err, setErr] = useState('')
  useEffect(() => {
    rpc('fsm_brands', { p_client: clientId }).then((b) => { setBrands(b || []); if (b && b.length) setBrand(b[0].brand) }).catch((e) => setErr(e.message))
  }, [clientId])
  const cfg = useMemo(() => (brands || []).find((b) => b.brand === brand), [brands, brand])

  if (err) return <div style={C.card}>{err}</div>
  if (!brands) return <div style={C.soft}>Loading…</div>
  if (!brands.length) return <div style={C.card}><b>Field service isn't set up for your brands yet.</b><div style={C.soft}>Opsis CX turns it on per brand (techs, sales reps, job types and booking windows).</div></div>

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {[['book', 'Book a visit'], ['board', 'Dispatch board'], ['funnel', 'Repair → new door'], ['team', 'Team links']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...C.ghost, ...(tab === k ? { background: 'var(--accent,#2F7D5B)', color: '#fff', borderColor: 'transparent' } : {}) }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {brands.length > 1 && (
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ ...C.input, width: 'auto' }}>
            {brands.map((b) => <option key={b.brand}>{b.brand}</option>)}
          </select>
        )}
        {brands.length === 1 && <b>{brand}</b>}
      </div>
      {cfg && tab === 'book' && <Book clientId={clientId} cfg={cfg} onBooked={() => {}} />}
      {cfg && tab === 'board' && <Board clientId={clientId} cfg={cfg} />}
      {cfg && tab === 'funnel' && <Funnel clientId={clientId} cfg={cfg} />}
      {cfg && tab === 'team' && <Team clientId={clientId} cfg={cfg} />}
    </div>
  )
}

// ---------------- Book ----------------
function Book({ clientId, cfg }) {
  const jobs = cfg.job_types || []
  const [f, setF] = useState({ customer: '', phone: '', address: '', zip: '', job: jobs[0]?.code || '', problem: '', door: '', opener: '', mood: '', access: '', upsell: '' })
  const [slots, setSlots] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const job = jobs.find((j) => j.code === f.job)

  const find = async () => {
    setMsg(''); setDone(null)
    if (!/^\d{5}$/.test(f.zip)) { setMsg('Enter a 5-digit zip.'); return }
    setBusy(true)
    try { setSlots(await rpc('fsm_slots', { p_client: clientId, p_brand: cfg.brand, p_job: f.job, p_zip: f.zip, p_days: 5, p_limit: 8 })) }
    catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }
  const book = async (s) => {
    if (!f.customer.trim()) { setMsg('Add the customer name first.'); return }
    setBusy(true)
    try {
      const brief = Object.fromEntries(['problem', 'door', 'opener', 'mood', 'access', 'upsell'].map((k) => [k, f[k]]).filter(([, v]) => v))
      await rpc('fsm_book', { p_client: clientId, p_brand: cfg.brand, p_job: f.job, p_resource: s.resource_id, p_starts: s.starts_at, p_window: s.window,
        p_customer: f.customer, p_phone: f.phone, p_address: f.address, p_zip: f.zip, p_brief: brief, p_source: 'csr', p_parent: null })
      setDone(s); setSlots(null)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,380px) 1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ ...C.card, display: 'grid', gap: 10 }}>
        <b>Customer</b>
        <Field l="Name"><input style={C.input} value={f.customer} onChange={set('customer')} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
          <Field l="Phone"><input style={C.input} value={f.phone} onChange={set('phone')} /></Field>
          <Field l="Zip"><input style={C.input} value={f.zip} maxLength={5} onChange={set('zip')} /></Field>
        </div>
        <Field l="Address"><input style={C.input} value={f.address} onChange={set('address')} /></Field>
        <Field l="Job">
          <select style={C.input} value={f.job} onChange={set('job')}>
            {jobs.map((j) => <option key={j.code} value={j.code}>{j.label} · {j.minutes} min · {j.kind === 'sales' ? 'sales rep' : 'tech'}</option>)}
          </select>
        </Field>
        <b style={{ marginTop: 6 }}>Visit brief <span style={{ ...C.soft, fontWeight: 400 }}>— what the {job?.kind === 'sales' ? 'rep' : 'tech'} sees before arriving</span></b>
        <Field l="What's wrong"><textarea rows={2} style={C.input} value={f.problem} onChange={set('problem')} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field l="Door (size / age)"><input style={C.input} value={f.door} onChange={set('door')} /></Field>
          <Field l="Opener"><input style={C.input} value={f.opener} onChange={set('opener')} /></Field>
        </div>
        <Field l="Customer mood"><input style={C.input} value={f.mood} onChange={set('mood')} /></Field>
        <Field l="Access / gate / pets"><input style={C.input} value={f.access} onChange={set('access')} /></Field>
        <Field l="Upsell to mention"><input style={C.input} value={f.upsell} onChange={set('upsell')} /></Field>
        <button style={C.btn} disabled={busy} onClick={find}>{busy ? 'Finding…' : 'Find best times'}</button>
        {msg && <div style={{ color: '#A8441A', fontSize: 13 }}>{msg}</div>}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {done && (
          <div style={{ ...C.card, borderColor: '#2F7D5B', background: '#E6F0EA' }}>
            <b>Booked ✓</b> {f.customer} with {done.resource} — {fmtDay(done.day)} at {fmtTime(done.starts_at)} ({done.window}). {done.reason}.
            <div style={C.soft}>The brief is on {done.resource}'s phone page now.</div>
          </div>
        )}
        {!slots && !done && (
          <div style={{ ...C.card, ...C.soft }}>
            Enter the zip and job, then <b>Find best times</b>. Times are ranked by how little extra driving they add —
            a slot next to a visit already booked in that area comes first. First bookable day follows the brand's cadence ({cfg.cadence_days} business day).
          </div>
        )}
        {slots && !slots.length && <div style={C.card}>No open times in the next 5 days for this zip. Try another job type or check the dispatch board.</div>}
        {slots && slots.map((s, i) => (
          <div key={i} style={{ ...C.card, display: 'flex', gap: 14, alignItems: 'center', ...(i === 0 ? { borderColor: 'var(--accent,#2F7D5B)', boxShadow: '0 0 0 1px var(--accent,#2F7D5B)' } : {}) }}>
            <div style={{ width: 92 }}>
              <div style={{ fontWeight: 700 }}>{fmtDay(s.day)}</div>
              <div style={C.soft}>{fmtTime(s.starts_at)}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{s.resource} <span style={{ ...C.soft, fontWeight: 400 }}>· {s.window}</span>{i === 0 && <span style={{ marginLeft: 8, fontSize: 11, background: 'var(--accent,#2F7D5B)', color: '#fff', borderRadius: 10, padding: '2px 8px' }}>Best fit</span>}</div>
              <div style={C.soft}>{s.reason}</div>
            </div>
            <Detour mi={s.detour_mi} />
            <button style={C.btn} disabled={busy} onClick={() => book(s)}>Book</button>
          </div>
        ))}
      </div>
    </div>
  )
}
const Field = ({ l, children }) => <label style={{ display: 'block' }}><span style={C.label}>{l}</span>{children}</label>
function Detour({ mi }) {
  if (mi == null) return <span style={C.soft}>—</span>
  const n = Number(mi); const col = n <= 3 ? '#2F7D5B' : n <= 10 ? '#B45309' : '#A8441A'
  return <span style={{ fontSize: 12, fontWeight: 700, color: col, border: `1px solid ${col}`, borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap' }}>+{Math.round(n)} mi</span>
}

// ---------------- Dispatch board ----------------
const START_H = 8, END_H = 19, PX = 64 // px per hour
function Board({ clientId, cfg }) {
  const [day, setDay] = useState(() => { let d = todayStr(); return d })
  const [data, setData] = useState(null)
  const [sel, setSel] = useState(null)
  const [err, setErr] = useState('')
  const drag = useRef(null)
  const load = () => rpc('fsm_day', { p_client: clientId, p_brand: cfg.brand, p_day: day }).then(setData).catch((e) => setErr(e.message))
  useEffect(() => { setData(null); load() }, [day, cfg.brand])

  const onDrop = async (resId, e) => {
    e.preventDefault()
    const a = drag.current; drag.current = null
    if (!a) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mins = Math.round(((e.clientY - rect.top) / PX * 60) / 30) * 30 + START_H * 60
    const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0')
    // build the local (Central) time → timestamptz
    const local = `${day}T${hh}:${mm}:00`
    const off = tzOffset(local)
    try { await rpc('fsm_move', { p_client: clientId, p_appt: a.id, p_resource: resId, p_starts: local + off }); load() } catch (er) { setErr(er.message) }
  }

  const appts = data?.appointments || []
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={C.ghost} onClick={() => setDay(addDays(day, -1))}>‹</button>
        <b style={{ minWidth: 130, textAlign: 'center' }}>{fmtDay(day)}</b>
        <button style={C.ghost} onClick={() => setDay(addDays(day, 1))}>›</button>
        <button style={C.ghost} onClick={() => setDay(todayStr())}>Today</button>
        <span style={{ ...C.soft, marginLeft: 8 }}>{appts.length} visits · drag a card to move it</span>
        {err && <span style={{ color: '#A8441A', fontSize: 13 }}>{err}</span>}
      </div>
      {!data ? <div style={C.soft}>Loading…</div> : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'start' }}>
          <div style={{ ...C.card, padding: 0, overflowX: 'auto', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(${data.resources.length}, minmax(150px,1fr))`, minWidth: 48 + data.resources.length * 150 }}>
              <div style={{ borderBottom: '1px solid var(--line,#E8E4DC)' }} />
              {data.resources.map((r) => (
                <div key={r.id} style={{ padding: '10px 8px', borderBottom: '1px solid var(--line,#E8E4DC)', borderLeft: '1px solid var(--line-soft,#F1EEE8)' }}>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 9, background: r.color || '#888' }} />{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft,#5F6763)' }}>{r.kind === 'sales' ? 'Sales rep' : 'Tech'} · {r.home_city || r.home_zip} · {r.miles} mi today</div>
                </div>
              ))}
              <div style={{ position: 'relative', height: (END_H - START_H) * PX }}>
                {Array.from({ length: END_H - START_H }, (_, i) => (
                  <div key={i} style={{ position: 'absolute', top: i * PX - 7, right: 6, fontSize: 10, color: 'var(--ink-soft,#5F6763)' }}>{i ? ((START_H + i - 1) % 12 + 1) + (START_H + i < 12 ? 'a' : 'p') : ''}</div>
                ))}
              </div>
              {data.resources.map((r) => (
                <div key={r.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(r.id, e)}
                  style={{ position: 'relative', height: (END_H - START_H) * PX, borderLeft: '1px solid var(--line-soft,#F1EEE8)',
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX - 1}px, var(--line-soft,#F1EEE8) ${PX - 1}px, var(--line-soft,#F1EEE8) ${PX}px)` }}>
                  {(data.windows || []).map((w, i) => {
                    const [sh, sm] = w.start.split(':').map(Number); const [eh, em] = w.end.split(':').map(Number)
                    return <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (sh + sm / 60 - START_H) * PX, height: (eh + em / 60 - sh - sm / 60) * PX, background: i % 2 ? 'rgba(47,125,91,.035)' : 'rgba(47,125,91,.06)' }} />
                  })}
                  {appts.filter((a) => a.resource_id === r.id).map((a) => {
                    const st = new Date(a.starts_at), en = new Date(a.ends_at)
                    const h = Number(st.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) + st.getMinutes() / 60
                    const top = (h - START_H) * PX, ht = Math.max(28, (en - st) / 36e5 * PX - 3)
                    const o = OUT[a.outcome]
                    return (
                      <div key={a.id} draggable={a.status !== 'done'} onDragStart={() => { drag.current = a }} onClick={() => setSel(a)}
                        style={{ position: 'absolute', left: 4, right: 4, top, height: ht, borderRadius: 7, padding: '4px 7px', fontSize: 12, cursor: 'pointer', overflow: 'hidden',
                          background: a.status === 'done' ? '#F3F4F6' : '#fff', borderLeft: `4px solid ${r.color || '#888'}`, boxShadow: '0 1px 2px rgba(0,0,0,.08)', border: '1px solid var(--line,#E8E4DC)',
                          outline: sel?.id === a.id ? '2px solid var(--accent,#2F7D5B)' : 'none' }}>
                        <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtTime(a.starts_at)} {a.customer}</div>
                        <div style={{ color: 'var(--ink-soft,#5F6763)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.source === 'tech_handoff' ? '🔁 ' : ''}{a.job} · {a.city || a.zip}
                        </div>
                        {o && <div style={{ color: o[1], fontWeight: 600 }}>{o[0]}</div>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          {sel && <Brief a={sel} onClose={() => setSel(null)} />}
        </div>
      )}
    </div>
  )
}
// Central time offset for a local date-time string (handles CST/CDT)
function tzOffset(local) {
  const d = new Date(local + 'Z')
  const asCentral = new Date(d.toLocaleString('en-US', { timeZone: TZ }))
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }))
  const m = Math.round((asCentral - asUtc) / 60000)
  const s = m < 0 ? '-' : '+'; const a = Math.abs(m)
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

export function Brief({ a, onClose }) {
  const b = a.brief || {}
  const o = OUT[a.outcome]
  const rows = [['What\'s wrong', b.problem], ['Tech note', b.tech_note], ['Door', b.door], ['Opener', b.opener], ['Customer mood', b.mood], ['Access', b.access], ['Upsell', b.upsell], ['From the call', b.call_summary]].filter(([, v]) => v)
  return (
    <div style={{ ...C.card, width: 320, flexShrink: 0, display: 'grid', gap: 8, position: 'sticky', top: 10 }}>
      <div style={{ display: 'flex', alignItems: 'start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{a.customer}</div>
          <div style={C.soft}>{fmtTime(a.starts_at)} · {a.window} · {a.job}</div>
        </div>
        {onClose && <button style={{ ...C.ghost, padding: '2px 8px' }} onClick={onClose}>✕</button>}
      </div>
      <div style={{ fontSize: 13 }}>{a.address}{a.city ? `, ${a.city}` : ''} {a.zip}<br />{a.phone}</div>
      {a.source === 'tech_handoff' && <div style={{ fontSize: 12, background: '#FEF3C7', borderRadius: 6, padding: '5px 8px' }}>🔁 Booked automatically from a tech's new-door flag</div>}
      {o && <div style={{ fontWeight: 600, color: o[1] }}>{o[0]}{a.outcome_note ? ` — ${a.outcome_note}` : ''}</div>}
      <div style={{ borderTop: '1px solid var(--line,#E8E4DC)', paddingTop: 8, display: 'grid', gap: 6 }}>
        <b style={{ fontSize: 13 }}>Visit brief</b>
        {rows.length ? rows.map(([k, v]) => <div key={k} style={{ fontSize: 13 }}><span style={{ color: 'var(--ink-soft,#5F6763)', fontSize: 11, fontWeight: 600, display: 'block' }}>{k}</span>{v}</div>) : <div style={C.soft}>No brief.</div>}
      </div>
    </div>
  )
}

// ---------------- Funnel ----------------
function Funnel({ clientId, cfg }) {
  const [start, setStart] = useState(() => addDays(todayStr(), -30))
  const [end, setEnd] = useState(() => addDays(todayStr(), 14))
  const [d, setD] = useState(null)
  useEffect(() => { setD(null); rpc('fsm_funnel', { p_client: clientId, p_brand: cfg.brand, p_start: start, p_end: end }).then(setD).catch(() => setD({})) }, [start, end, cfg.brand])
  const tiles = d ? [['Repair visits', d.repair_visits], ['Completed', d.completed], ['New-door opps', d.opps], ['Estimates booked from techs', d.from_techs], ['All estimates', d.estimates], ['Sold', d.sold]] : []
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="date" style={{ ...C.input, width: 160 }} value={start} onChange={(e) => setStart(e.target.value)} />
        <span style={C.soft}>to</span>
        <input type="date" style={{ ...C.input, width: 160 }} value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      {!d ? <div style={C.soft}>Loading…</div> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
          {tiles.map(([l, v]) => <div key={l} style={C.card}><div style={C.soft}>{l}</div><div style={{ fontSize: 28, fontWeight: 700 }}>{v ?? 0}</div></div>)}
        </div>
        <div style={C.card}>
          <b>New-door opportunities by tech</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--ink-soft,#5F6763)', fontSize: 12 }}><th style={{ padding: 6 }}>Tech</th><th>Visits</th><th>Opps flagged</th><th>Flag rate (of completed)</th></tr></thead>
            <tbody>{(d.by_tech || []).map((t) => (
              <tr key={t.tech} style={{ borderTop: '1px solid var(--line-soft,#F1EEE8)' }}><td style={{ padding: 6, fontWeight: 600 }}>{t.tech}</td><td>{t.visits}</td><td>{t.opps}</td><td>{t.rate == null ? '—' : t.rate + '%'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>)}
    </div>
  )
}

// ---------------- Team links ----------------
function Team({ clientId, cfg }) {
  const [d, setD] = useState(null)
  const [copied, setCopied] = useState('')
  useEffect(() => { rpc('fsm_day', { p_client: clientId, p_brand: cfg.brand, p_day: todayStr() }).then(setD) }, [cfg.brand])
  if (!d) return <div style={C.soft}>Loading…</div>
  const link = (t) => `${window.location.origin}/tech/${t}`
  return (
    <div style={C.card}>
      <b>Phone links for techs and sales reps</b>
      <div style={{ ...C.soft, marginBottom: 10 }}>Each person gets a private link (no login). It shows their visits for the day with the brief, and lets them mark the outcome. A new-door flag books the closest sales rep automatically.</div>
      {d.resources.map((r) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft,#F1EEE8)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 9, background: r.color || '#888' }} />
          <b style={{ width: 110 }}>{r.name}</b>
          <span style={{ ...C.soft, width: 160 }}>{r.kind === 'sales' ? 'Sales rep' : 'Tech'} · {r.home_city || r.home_zip}</span>
          <code style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{link(r.link_token)}</code>
          <button style={C.ghost} onClick={() => { navigator.clipboard?.writeText(link(r.link_token)); setCopied(r.id); setTimeout(() => setCopied(''), 1500) }}>{copied === r.id ? 'Copied' : 'Copy'}</button>
          <a style={{ ...C.ghost, textDecoration: 'none' }} href={link(r.link_token)} target="_blank" rel="noreferrer">Open</a>
        </div>
      ))}
    </div>
  )
}
