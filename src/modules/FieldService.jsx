// Field Service (FSM) v1 — GarageCo portal, Becky 11/27.
// Book (route-aware best times) · Dispatch board (drag to move) · Funnel (repair → new door) · Team links.
// Data: fsm_* RPCs (qa_client_access + brand lock). Techs/reps use a secret link: /tech/:token (TechDay.jsx).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
  const [canSetup, setCanSetup] = useState(false)
  const loadBrands = (keep) => rpc('fsm_brands', { p_client: clientId }).then((b) => {
    setBrands(b || [])
    if (b && b.length && !(keep && b.find((x) => x.brand === keep))) setBrand(b[0].brand)
    else if (keep) setBrand(keep)
  }).catch((e) => setErr(e.message))
  useEffect(() => {
    loadBrands()
    // account admins (and Opsis staff) get the Setup tab (11/27)
    rpc('fsm_admin_get', { p_client: clientId, p_brand: null }).then(() => setCanSetup(true)).catch(() => setCanSetup(false))
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cfg = useMemo(() => (brands || []).find((b) => b.brand === brand), [brands, brand])

  if (err) return <div style={C.card}>{err}</div>
  if (!brands) return <div style={C.soft}>Loading…</div>
  if (!brands.length && !canSetup) return <div style={C.card}><b>Field service isn't set up for your brands yet.</b><div style={C.soft}>Your account admin can turn it on under Field Service → Setup.</div></div>
  const tabs = (brands.length ? [['book', 'Book a visit'], ['board', 'Dispatch board'], ['funnel', 'Repair → new door'], ['team', 'Team links']] : []).concat(canSetup ? [['setup', 'Setup']] : [])
  const cur = brands.length ? tab : 'setup'

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...C.ghost, ...(cur === k ? { background: 'var(--accent,#2F7D5B)', color: '#fff', borderColor: 'transparent' } : {}) }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {cur !== 'setup' && brands.length > 1 && (
          <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ ...C.input, width: 'auto' }}>
            {brands.map((b) => <option key={b.brand}>{b.brand}</option>)}
          </select>
        )}
        {cur !== 'setup' && brands.length === 1 && <b>{brand}</b>}
      </div>
      {cfg && cur === 'book' && <Book clientId={clientId} cfg={cfg} onBooked={() => {}} />}
      {cfg && cur === 'board' && <Board clientId={clientId} cfg={cfg} />}
      {cfg && cur === 'funnel' && <Funnel clientId={clientId} cfg={cfg} />}
      {cfg && cur === 'team' && <Team clientId={clientId} cfg={cfg} />}
      {cur === 'setup' && <Setup clientId={clientId} initial={brand} onChanged={(b) => loadBrands(b)} />}
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

// ---------------- Setup (account admins) ----------------
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']]
const COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#475569']
function Setup({ clientId, initial, onChanged }) {
  const [list, setList] = useState(null)
  const [brand, setBrand] = useState(initial || '')
  const [d, setD] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const load = (b) => rpc('fsm_admin_get', { p_client: clientId, p_brand: b || null }).then((r) => { setList(r.brands); setD(r) }).catch((e) => setMsg(e.message))
  useEffect(() => { load(brand) }, [brand]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!brand && list && list.length) setBrand((list.find((x) => x.on) || list[0]).brand) }, [list]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn, ok) => { setBusy(true); setMsg(''); try { await fn(); await load(brand); if (ok) setMsg(ok); onChanged(brand) } catch (e) { setMsg(e.message) } finally { setBusy(false) } }

  if (!list) return <div style={C.soft}>{msg || 'Loading…'}</div>
  const on = d?.settings
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...C.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>Brand</b>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ ...C.input, width: 'auto' }}>
          {list.map((b) => <option key={b.brand} value={b.brand}>{b.brand}{b.on ? '' : ' (not set up)'}</option>)}
        </select>
        <span style={C.soft}>{on ? 'Field Service is on for this brand.' : 'Field Service is off for this brand.'}</span>
        <div style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 13, color: /✓|saved|on for/i.test(msg) ? '#2F7D5B' : '#A8441A' }}>{msg}</span>}
      </div>
      {!on ? (
        <div style={C.card}>
          <b>Turn on Field Service for {brand}</b>
          <div style={{ ...C.soft, margin: '6px 0 12px' }}>Starts with two booking windows (9am–12pm, 12pm–6pm), first bookable day one business day out, 30 minutes of travel between visits, and four job types you can change. Then add the brand's techs and sales reps below.</div>
          <button style={C.btn} disabled={busy || !brand} onClick={() => run(() => rpc('fsm_admin_save_settings', { p_client: clientId, p_brand: brand, p_cadence: 1, p_windows: [{ label: '9am – 12pm', start: '09:00', end: '12:00' }, { label: '12pm – 6pm', start: '12:00', end: '18:00' }], p_travel: 30, p_sms_mode: 'preview', p_tz: null }), 'Field Service is on for ' + brand + ' ✓')}>Turn it on</button>
        </div>
      ) : (<>
        <Rules key={'r' + brand} s={on} busy={busy} save={(v) => run(() => rpc('fsm_admin_save_settings', { p_client: clientId, p_brand: brand, ...v }), 'Booking rules saved ✓')} />
        <Jobs key={'j' + brand} rows={d.job_types} busy={busy}
          save={(j) => run(() => rpc('fsm_admin_save_job', { p_client: clientId, p_brand: brand, p_id: j.id || null, p_label: j.label, p_kind: j.kind, p_minutes: Number(j.minutes), p_sort: null }), 'Job type saved ✓')}
          del={(j) => run(() => rpc('fsm_admin_delete_job', { p_client: clientId, p_brand: brand, p_id: j.id }), 'Job type removed ✓')} />
        <People key={'p' + brand} rows={d.resources} busy={busy}
          save={(r) => run(() => rpc('fsm_admin_save_resource', { p_client: clientId, p_brand: brand, p_id: r.id || null, p_name: r.name, p_kind: r.kind, p_phone: r.phone || null, p_home_zip: r.home_zip,
            p_zones: String(r.zonesText ?? (r.zones || []).join(', ')).split(/[\s,]+/).filter(Boolean), p_work_days: r.work_days, p_color: r.color, p_active: r.active }), (r.name || 'Person') + ' saved ✓')}
          newLink={(r) => run(() => rpc('fsm_admin_new_link', { p_client: clientId, p_brand: brand, p_id: r.id }), 'New phone link made for ' + r.name + ' ✓ (the old one stops working)')}
          clearDemo={() => { if (window.confirm('Remove the demo techs, reps and their visits for ' + brand + '?')) run(() => rpc('fsm_admin_clear_demo', { p_client: clientId, p_brand: brand }), 'Demo data removed ✓') }} />
      </>)}
    </div>
  )
}

function Rules({ s, busy, save }) {
  const [w, setW] = useState(s.windows || [])
  const [cad, setCad] = useState(s.cadence_days)
  const [trav, setTrav] = useState(s.travel_min)
  const [sms, setSms] = useState(s.sms_mode || 'preview')
  const setWin = (i, k, v) => setW(w.map((x, n) => (n === i ? { ...x, [k]: v } : x)))
  return (
    <div style={C.card}>
      <b>Booking rules</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: 12, marginTop: 10 }}>
        <Field l="First bookable day (business days out)"><input type="number" min={0} max={14} style={C.input} value={cad} onChange={(e) => setCad(e.target.value)} /></Field>
        <Field l="Travel time between visits (minutes)"><input type="number" min={0} max={120} style={C.input} value={trav} onChange={(e) => setTrav(e.target.value)} /></Field>
        <Field l="Customer texts"><select style={C.input} value={sms} onChange={(e) => setSms(e.target.value)}><option value="off">Off</option><option value="preview">Preview only (not sent)</option><option value="live" disabled>Live (needs Salesmsg)</option></select></Field>
      </div>
      <div style={{ ...C.label, marginTop: 12 }}>Booking windows (what the customer is offered)</div>
      {w.map((x, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <input style={{ ...C.input, width: 200 }} value={x.label} placeholder="Name, e.g. 9am – 12pm" onChange={(e) => setWin(i, 'label', e.target.value)} />
          <input type="time" style={{ ...C.input, width: 130 }} value={x.start} onChange={(e) => setWin(i, 'start', e.target.value)} />
          <span style={C.soft}>to</span>
          <input type="time" style={{ ...C.input, width: 130 }} value={x.end} onChange={(e) => setWin(i, 'end', e.target.value)} />
          <button style={C.ghost} onClick={() => setW(w.filter((_, n) => n !== i))} disabled={w.length <= 1}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button style={C.ghost} onClick={() => setW([...w, { label: '', start: '13:00', end: '17:00' }])}>+ Add window</button>
        <div style={{ flex: 1 }} />
        <button style={C.btn} disabled={busy} onClick={() => save({ p_cadence: Number(cad), p_windows: w, p_travel: Number(trav), p_sms_mode: sms, p_tz: null })}>Save booking rules</button>
      </div>
    </div>
  )
}

function Jobs({ rows, busy, save, del }) {
  const [list, setList] = useState(rows)
  useEffect(() => setList(rows), [rows])
  const set = (i, k, v) => setList(list.map((x, n) => (n === i ? { ...x, [k]: v, dirty: true } : x)))
  return (
    <div style={C.card}>
      <b>Job types</b> <span style={C.soft}>— how long each visit takes and who goes (tech or sales rep)</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 120px auto', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <span style={C.label}>Name</span><span style={C.label}>Who goes</span><span style={C.label}>Minutes</span><span />
        {list.map((j, i) => (<Fragment key={j.id || 'n' + i}>
          <input style={C.input} value={j.label} onChange={(e) => set(i, 'label', e.target.value)} placeholder="e.g. Spring replacement" />
          <select style={C.input} value={j.kind} onChange={(e) => set(i, 'kind', e.target.value)}><option value="tech">Tech</option><option value="sales">Sales rep</option></select>
          <input type="number" min={15} max={480} step={15} style={C.input} value={j.minutes} onChange={(e) => set(i, 'minutes', e.target.value)} />
          <span style={{ display: 'flex', gap: 6 }}>
            <button style={C.btn} disabled={busy || !j.dirty} onClick={() => save(j)}>Save</button>
            {j.id && <button style={C.ghost} disabled={busy} onClick={() => del(j)}>Remove</button>}
          </span>
        </Fragment>))}
      </div>
      <button style={{ ...C.ghost, marginTop: 10 }} onClick={() => setList([...list, { label: '', kind: 'tech', minutes: 60, dirty: true }])}>+ Add job type</button>
    </div>
  )
}

function People({ rows, busy, save, newLink, clearDemo }) {
  const [list, setList] = useState(rows)
  const [copied, setCopied] = useState('')
  useEffect(() => setList(rows), [rows])
  const set = (i, k, v) => setList(list.map((x, n) => (n === i ? { ...x, [k]: v, dirty: true } : x)))
  const toggleDay = (i, dn) => { const r = list[i]; const has = (r.work_days || []).includes(dn); set(i, 'work_days', has ? r.work_days.filter((x) => x !== dn) : [...(r.work_days || []), dn].sort()) }
  const link = (t) => `${window.location.origin}/tech/${t}`
  const hasDemo = list.some((r) => r.demo)
  return (
    <div style={C.card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b>Techs and sales reps</b><span style={C.soft}>— home base is where their day starts; zones limit which zips they're offered for (blank = any zip)</span>
        <div style={{ flex: 1 }} />
        {hasDemo && <button style={C.ghost} disabled={busy} onClick={clearDemo}>Remove demo people</button>}
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {list.map((r, i) => (
          <div key={r.id || 'n' + i} style={{ border: '1px solid var(--line,#E8E4DC)', borderRadius: 10, padding: 12, opacity: r.active === false ? 0.6 : 1, display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '24px 1.2fr 130px 150px 110px', gap: 8, alignItems: 'end' }}>
              <select aria-label="Color" value={r.color || COLORS[i % COLORS.length]} onChange={(e) => set(i, 'color', e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 12, background: r.color || COLORS[i % COLORS.length], color: 'transparent', cursor: 'pointer' }}>
                {COLORS.map((c) => <option key={c} value={c} style={{ background: c, color: '#fff' }}>{c}</option>)}
              </select>
              <Field l={r.demo ? 'Name (demo)' : 'Name'}><input style={C.input} value={r.name || ''} onChange={(e) => set(i, 'name', e.target.value)} /></Field>
              <Field l="Role"><select style={C.input} value={r.kind} onChange={(e) => set(i, 'kind', e.target.value)}><option value="tech">Tech</option><option value="sales">Sales rep</option></select></Field>
              <Field l="Cell phone"><input style={C.input} value={r.phone || ''} onChange={(e) => set(i, 'phone', e.target.value)} /></Field>
              <Field l="Home base zip"><input style={{ ...C.input, borderColor: r.home_zip && r.home_known === false && !r.dirty ? '#E2A27C' : undefined }} maxLength={5} value={r.home_zip || ''} onChange={(e) => set(i, 'home_zip', e.target.value.replace(/\D/g, ''))} /></Field>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
              <Field l="Zones (zips, optional)"><input style={{ ...C.input, width: 320 }} placeholder="e.g. 78613, 78641, 78642" value={r.zonesText ?? (r.zones || []).join(', ')} onChange={(e) => set(i, 'zonesText', e.target.value)} /></Field>
              <div><span style={C.label}>Works</span><div style={{ display: 'flex', gap: 4 }}>{DAYS.map(([dn, l]) => {
                const onD = (r.work_days || []).includes(dn)
                return <button key={dn} onClick={() => toggleDay(i, dn)} style={{ ...C.ghost, padding: '6px 8px', ...(onD ? { background: 'var(--accent,#2F7D5B)', color: '#fff', borderColor: 'transparent' } : {}) }}>{l}</button>
              })}</div></div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={r.active !== false} onChange={(e) => set(i, 'active', e.target.checked)} /> Active</label>
              <div style={{ flex: 1 }} />
              {r.id && <button style={C.ghost} onClick={() => { navigator.clipboard?.writeText(link(r.link_token)); setCopied(r.id); setTimeout(() => setCopied(''), 1500) }}>{copied === r.id ? 'Copied' : 'Copy phone link'}</button>}
              {r.id && <button style={C.ghost} disabled={busy} onClick={() => newLink(r)} title="Makes a new private link; the old one stops working">New link</button>}
              <button style={C.btn} disabled={busy || !r.dirty} onClick={() => save(r)}>Save</button>
            </div>
            {r.home_zip && r.home_known === false && !r.dirty && <div style={{ fontSize: 12, color: '#A8441A' }}>We don't have a map point for zip {r.home_zip}, so drive time for this person can't be ranked.</div>}
          </div>
        ))}
      </div>
      <button style={{ ...C.ghost, marginTop: 10 }} onClick={() => setList([...list, { name: '', kind: 'tech', phone: '', home_zip: '', zones: [], work_days: [1, 2, 3, 4, 5], color: COLORS[list.length % COLORS.length], active: true, dirty: true }])}>+ Add tech or sales rep</button>
    </div>
  )
}
