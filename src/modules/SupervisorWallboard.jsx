// ============================================================
//  SupervisorWallboard — live wallboard + dashboard for GarageCo supervisors (2026-11-10, Becky/Rob).
//  Scope comes from the login (rpc sup_wallboard → sup_scope):
//    Opsis staff / client admin = everything · RM = their brand · GM = their brand + location.
//  Rob's math (dispositions are grouped Sales / Service / No contact):
//    Intent rate          = sales-intent calls ÷ calls handled
//    Booking to decision  = booked ÷ sales-intent calls
//    Booking to all calls = booked ÷ calls handled
//  Widgets: every tile can be shown or hidden (Customize), remembered on this device.
//  TV mode: full screen, refreshes every 10 seconds.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import CxLiveBoard from '../components/CxLiveBoard'

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago' } catch { return 'America/Chicago' } })()
const LS = 'sup-wallboard-tiles'
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: TZ })
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')
const mmss = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const hm = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m` }
const tme = ts => (ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')
const STATE = {
  ready: { label: 'Ready', color: 'light-dark(#15803d, #20c55e)', bg: 'light-dark(#dcfce7, #133920)' },
  on_call: { label: 'On a call', color: 'light-dark(#0e7490, #1da4c9)', bg: 'light-dark(#cffafe, #133639)' },
  wrap: { label: 'Wrapping up', color: 'light-dark(#7c3aed, #a378ec)', bg: 'light-dark(#ede9fe, #1a1339)' },
  not_ready: { label: 'Not ready', color: 'light-dark(#b45309, #e07524)', bg: 'light-dark(#fef3c7, #393213)' },
  offline: { label: 'Logged out', color: 'light-dark(#64748b, #9fb4bb)', bg: 'light-dark(#f1f5f9, #1b2327)' },
}
const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'Custom']]

// every widget: key, label, group, value(d) → string, hint
const TILES = [
  ['ready', 'Ready', 'Live', d => d.live.ready, 'CSRs waiting for a call'],
  ['on_call', 'On a call', 'Live', d => d.live.on_call],
  ['wrap', 'Wrapping up', 'Live', d => d.live.wrap, 'After-call work'],
  ['not_ready', 'Not ready', 'Live', d => d.live.not_ready],
  ['offline', 'Logged out', 'Live', d => d.live.offline],
  ['calls_in', 'Calls in', 'Volume', d => n(d.totals.calls_in)],
  ['calls_out', 'Calls out', 'Volume', d => n(d.totals.calls_out)],
  ['handled', 'Calls handled', 'Volume', d => n(d.totals.handled), 'Connected calls'],
  ['missed', 'Missed calls', 'Volume', d => n(d.missed), 'Rang and nobody answered'],
  ['callbacks', 'Callbacks waiting', 'Volume', d => n(d.callbacks_pending)],
  ['intent_rate', 'Intent rate', 'Rob’s math', d => pct(n(d.totals.intent), n(d.totals.handled)), 'Wanted service or a new door ÷ calls handled'],
  ['book_decision', 'Booking rate to decision', 'Rob’s math', d => pct(n(d.totals.booked), n(d.totals.intent)), 'Booked ÷ intent calls'],
  ['book_all', 'Booking rate to all calls', 'Rob’s math', d => pct(n(d.totals.booked), n(d.totals.handled)), 'Booked ÷ calls handled'],
  ['booked', 'Booked', 'Rob’s math', d => n(d.totals.booked)],
  ['avg_talk', 'Avg talk time', 'Handling', d => mmss(n(d.totals.talk) / (n(d.totals.handled) || 1))],
  ['avg_acw', 'Avg after-call work', 'Handling', d => mmss(n(d.totals.wrap_secs) / (n(d.totals.handled) || 1))],
]
function n(v) { return Number(v || 0) }
function loadTiles() { try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (Array.isArray(v)) return v.includes('leaders') || localStorage.getItem(LS + '-lb') ? v : [...v, 'leaders'] } catch { /* ignore */ } return [...TILES.map(t => t[0]), 'leaders'] }

// ---------- Leaderboard (2026-11-10, Becky): 2 x 2 boards, top 3 each, "First L." ----------
const BOARDS = [
  ['bookings', 'Most bookings', 'appointments booked'],
  ['cards', 'Most cards asked', 'asked for a card on file'],
  ['book_rate', 'Best booking rate', 'booked ÷ decided · min. 10'],
  ['qa', 'Top QA score', 'average score · min. 10 calls'],
]
const MEDAL = ['#D4A017', '#A8B0B8', '#C08552']
const shortName = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || '') }
function Leaderboard({ data, failed, tv }) {
  return (
    <div style={{ ...S.card, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: tv ? 22 : 18, fontWeight: 800, color: 'light-dark(#14302A, #e8eef0)' }}>🏆 Leaderboard</div>
        <div style={{ fontSize: 11.5, color: '#8a918d' }}>from reviewed calls</div>
      </div>
      {!data ? <div style={S.mut}>{failed ? 'Couldn’t load the leaderboard.' : 'Loading…'}</div> : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridAutoRows: '1fr', gap: 12 }}>
          {BOARDS.map(([k, label, hint]) => {
            const rows = (data[k] || []).slice(0, 3)
            return (
              <div key={k} style={{ background: 'light-dark(#FAF8F4, #1b2327)', border: '1px solid light-dark(#EEEAE2, #2a3439)', borderRadius: 12, padding: '12px 14px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: 'light-dark(#2F7D5B, #3fa779)' }}>{label}</div>
                <div style={{ fontSize: 11, color: '#8a918d', marginBottom: 8 }}>{hint}</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
                {rows.length === 0 ? <div style={{ ...S.mut, fontSize: 12, textAlign: 'center' }}>No reviewed calls yet</div> : rows.map((r, i) => {
                  const lead = i === 0
                  return (
                    <div key={r.name} title={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: lead ? '10px 12px' : '8px 12px', borderRadius: 10,
                      background: lead ? 'light-dark(#fff, #161d21)' : 'transparent', border: lead ? '1px solid #E8E4DC' : '1px solid transparent', boxShadow: lead ? '0 1px 3px rgba(20,48,42,0.06)' : 'none' }}>
                      <span style={{ width: lead ? 26 : 20, height: lead ? 26 : 20, flex: 'none', borderRadius: 999, background: MEDAL[i], color: '#fff',
                        fontSize: lead ? 12.5 : 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: lead ? 800 : 700, fontSize: lead ? (tv ? 17 : 14.5) : (tv ? 15 : 13), color: 'light-dark(#1C2421, #e8eef0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortName(r.name)}</span>
                        <span style={{ display: 'block', fontSize: 11, color: '#8a918d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</span>
                      </span>
                      <span style={{ flex: 'none', fontWeight: 800, fontSize: lead ? (tv ? 24 : 20) : (tv ? 18 : 15), color: lead ? 'light-dark(#14302A, #e8eef0)' : 'light-dark(#33403A, #e8eef0)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
                    </div>
                  )
                })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// section (Becky 11/20): 'board' = the wallboard (top metrics, leaderboard, lines, latest calls — what the TV shows);
// 'csrs' = the CSR table with Not ready / Log out actions, shown on the Supervisor page.
export default function SupervisorWallboard({ clientId = null, brands = null, locations = null, section = 'board' }) {
  // brand / location picks from the GarageCo portal's top bar (Becky 11/20); empty = everything this login can see
  const pickB = (brands || []).join('|'), pickL = (locations || []).join('|')
  const [range, setRange] = useState('today')
  const [cs, setCs] = useState(ymd(addDays(new Date(), -6)))
  const [ce, setCe] = useState(ymd(new Date()))
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [tiles, setTiles] = useState(loadTiles)
  const [custom, setCustom] = useState(false)
  const [tv, setTv] = useState(false)
  const [sort, setSort] = useState(['state', 1])
  const [leaders, setLeaders] = useState(null)
  const [leadersFailed, setLeadersFailed] = useState(false)
  const [, tick] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [actErr, setActErr] = useState('')

  const dates = useMemo(() => {
    const now = new Date()
    if (range === 'yesterday') { const y = ymd(addDays(now, -1)); return [y, y] }
    if (range === 'week') { const dow = now.getDay(); return [ymd(addDays(now, -((dow + 6) % 7))), ymd(now)] }
    if (range === '7') return [ymd(addDays(now, -6)), ymd(now)]
    if (range === '30') return [ymd(addDays(now, -29)), ymd(now)]
    if (range === 'custom') return [cs, ce]
    return [ymd(now), ymd(now)]
  }, [range, cs, ce])

  const load = useCallback(async () => {
    const args = { p_start: dates[0], p_end: dates[1], p_tz: TZ }
    if (clientId) args.p_client = clientId
    if (pickB) args.p_brands = pickB.split('|')
    if (pickL) args.p_locations = pickL.split('|')
    const { data, error } = await supabase.rpc('sup_wallboard', args)
    if (error) setErr(error.message); else { setD(data); setErr('') }
  }, [dates, clientId, pickB, pickL])
  useEffect(() => { load(); const t = setInterval(load, tv ? 10000 : 20000); return () => clearInterval(t) }, [load, tv])
  // Leaderboards (2026-11-10, Becky): from reviewed calls, refreshed every minute.
  const loadLeaders = useCallback(async () => {
    const args = { p_start: dates[0], p_end: dates[1], p_tz: TZ }
    if (clientId) args.p_client = clientId
    if (pickB) args.p_brands = pickB.split('|')
    if (pickL) args.p_locations = pickL.split('|')
    const { data, error } = await supabase.rpc('sup_leaders', args)
    if (!error) { setLeaders(data); setLeadersFailed(false) } else setLeadersFailed(true)
  }, [dates, clientId, pickB, pickL])
  useEffect(() => { loadLeaders(); const t = setInterval(loadLeaders, 60000); return () => clearInterval(t) }, [loadLeaders])
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(tiles)); localStorage.setItem(LS + '-lb', '1') } catch { /* ignore */ } }, [tiles])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') setTv(false) }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (err && !d) return <div style={S.card}><b>Couldn’t load the wallboard.</b><p style={S.mut}>{err}</p></div>
  if (!d) return <div style={S.card}>Loading the wallboard…</div>

  const scopeLabel = pickB || pickL ? [pickB.split('|').filter(Boolean).join(', ') || d.scope.brand || 'All brands', pickL.split('|').filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    : d.scope.location ? `${d.scope.brand} · ${d.scope.location}` : d.scope.brand || 'All brands'
  const isToday = dates[0] === dates[1] && dates[0] === d.range.today
  const rows = [...(d.csrs || [])].sort((a, b) => {
    const [k, dir] = sort
    const order = { on_call: 0, wrap: 1, ready: 2, not_ready: 3, offline: 4 }
    const va = k === 'state' ? order[a.state] : k === 'full_name' ? a.full_name : rate(a, k)
    const vb = k === 'state' ? order[b.state] : k === 'full_name' ? b.full_name : rate(b, k)
    return (va > vb ? 1 : va < vb ? -1 : 0) * dir
  })
  const th = (k, label, title) => <th title={title} onClick={() => setSort(s => [k, s[0] === k ? -s[1] : (k === 'state' || k === 'full_name' ? 1 : -1)])} style={S.th}>{label}{sort[0] === k ? (sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>

  function exportCsv() {
    const head = ['CSR', 'Brand', 'Location', 'Status', 'Calls in', 'Calls out', 'Handled', 'Intent', 'Booked', 'Service', 'Intent rate', 'Booking to decision', 'Booking to all', 'Avg talk (s)', 'After-call work (s)', 'Logged in (s)']
    const lines = rows.map(r => [r.full_name, r.brand, r.location, (STATE[r.state] || {}).label, r.calls_in, r.calls_out, r.handled, r.intent, r.booked, r.service,
      pct(r.intent, r.handled), pct(r.booked, r.intent), pct(r.booked, r.handled), Math.round(r.talk / (r.handled || 1)), r.wrap_secs, r.logged_secs])
    const csv = [head, ...lines].map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `wallboard_${dates[0]}_${dates[1]}.csv`; a.click()
  }

  const shown = TILES.filter(t => tiles.includes(t[0]))
  const groups = [...new Set(shown.map(t => t[2]))]

  async function setAgent(r, state) {
    if (state === 'offline' && !window.confirm(`Log ${r.full_name} out for the day?`)) return
    setBusyId(r.id); setActErr('')
    const { error } = await supabase.rpc('sup_agent_set', { p_profile: r.id, p_state: state, p_client: clientId || null })
    setBusyId(null)
    if (error) setActErr(error.message); else load()
  }
  const csrCard = (
      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 6px', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontWeight: 800 }}>CSRs <span style={S.mut}>· {rows.length}</span></div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={range} onChange={e => setRange(e.target.value)} style={S.sel} aria-label="Dates">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {range === 'custom' && (<><input type="date" value={cs} onChange={e => setCs(e.target.value)} style={S.sel} aria-label="Start" /><input type="date" value={ce} onChange={e => setCe(e.target.value)} style={S.sel} aria-label="End" /></>)}
            <button onClick={exportCsv} style={S.btn}>Export CSV</button>
          </div>
        </div>
        {actErr && <div style={{ padding: '0 16px 8px', color: 'light-dark(#b91c1c, #e86464)', fontSize: 13 }}>{actErr}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={S.tbl}>
            <thead><tr>
              {th('full_name', 'CSR')}{th('state', 'Status')}{th('calls_in', 'In')}{th('calls_out', 'Out')}{th('handled', 'Handled')}
              {th('intent', 'Intent', 'Wanted service or a new door')}{th('booked', 'Booked')}
              {th('intent_rate', 'Intent rate')}{th('book_decision', 'Book / decision')}{th('book_all', 'Book / all')}
              {th('avg_talk', 'Avg talk')}{th('avg_acw', 'Avg ACW', 'After-call work per handled call')}{th('logged_secs', 'Logged in')}<th style={S.th}></th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={14} style={{ ...S.td, textAlign: 'center', color: 'light-dark(#5F6763, #b3c1c7)' }}>No CSRs in your view yet.</td></tr>}
              {rows.map(r => {
                const since = r.since ? Math.floor((Date.now() - new Date(r.since).getTime()) / 1000) : 0
                // wrap-up over the location's target shows red (Blending → wrap-up time)
                const wrapOver = r.state === 'wrap' && since > Number(d.wrap_limit || 60)
                const st = wrapOver ? { label: 'Wrap-up over', color: 'light-dark(#b91c1c, #e86464)', bg: 'light-dark(#fee2e2, #391313)' } : (STATE[r.state] || STATE.offline)
                const inOnly = (d.inbound_only || []).includes(r.id)
                return (
                  <tr key={r.id}>
                    <td style={{ ...S.td, fontWeight: 700 }}>{r.full_name}<div style={{ fontWeight: 400, fontSize: 11.5, color: '#8a918d' }}>{[r.brand, r.location].filter(Boolean).join(' · ')}</div></td>
                    <td style={S.td}>
                      <span style={{ ...S.pill, color: st.color, background: st.bg }}>{st.label}{r.state === 'not_ready' && r.reason ? ` · ${r.reason}` : ''}</span>
                      {r.state !== 'offline' && <div style={{ fontSize: 11.5, color: 'light-dark(#5F6763, #b3c1c7)', marginTop: 3 }}>{mmss(since)}{r.on_call_src ? ` · ${r.on_call_src}` : ''}</div>}
                      {inOnly && <div style={{ fontSize: 11, fontWeight: 700, color: 'light-dark(#a16207, #c9821d)', marginTop: 2 }}>Inbound only</div>}
                    </td>
                    <td style={S.tdn}>{r.calls_in}</td><td style={S.tdn}>{r.calls_out}</td><td style={S.tdn}>{r.handled}</td>
                    <td style={S.tdn}>{r.intent}</td><td style={{ ...S.tdn, fontWeight: 800, color: 'light-dark(#15803d, #20c55e)' }}>{r.booked}</td>
                    <td style={S.tdn}>{pct(r.intent, r.handled)}</td><td style={S.tdn}>{pct(r.booked, r.intent)}</td><td style={S.tdn}>{pct(r.booked, r.handled)}</td>
                    <td style={S.tdn}>{r.handled ? mmss(r.talk / r.handled) : '—'}</td><td style={S.tdn}>{r.handled ? mmss(r.wrap_secs / r.handled) : '—'}</td>
                    <td style={S.tdn}>{hm(r.logged_secs)}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {r.state !== 'offline' && r.state !== 'on_call' && (<>
                        {r.state !== 'not_ready' && <button disabled={busyId === r.id} onClick={() => setAgent(r, 'not_ready')} style={{ ...S.btn, padding: '4px 9px', fontSize: 12 }}>Not ready</button>}{' '}
                        <button disabled={busyId === r.id} onClick={() => setAgent(r, 'offline')} style={{ ...S.btn, padding: '4px 9px', fontSize: 12 }}>Log out</button>
                      </>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
  )
  if (section === 'csrs') return csrCard

  const body = (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* header */}
      <div style={{ ...S.card, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'light-dark(#14302A, #e8eef0)' }}>Wallboard <span style={{ fontWeight: 600, color: 'light-dark(#5F6763, #b3c1c7)', fontSize: 14 }}>· {scopeLabel}</span></div>
          <div style={S.mut}>{isToday ? 'Live · updates every ' + (tv ? 10 : 20) + ' seconds' : `${dates[0]} to ${dates[1]}`} · last update {tme(d.now)}{err ? ' · reconnecting…' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={range} onChange={e => setRange(e.target.value)} style={S.sel}>{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {range === 'custom' && (<><input type="date" value={cs} onChange={e => setCs(e.target.value)} style={S.sel} /><input type="date" value={ce} onChange={e => setCe(e.target.value)} style={S.sel} /></>)}
          <button onClick={() => setCustom(c => !c)} style={S.btn}>{custom ? 'Done' : 'Customize'}</button>
          <button onClick={exportCsv} style={S.btn}>Export CSV</button>
          <button onClick={() => setTv(t => !t)} style={{ ...S.btn, background: '#14302A', color: '#fff', borderColor: '#14302A' }}>{tv ? 'Exit TV mode' : 'TV mode'}</button>
        </div>
      </div>

      {custom && (
        <div style={S.card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose your widgets</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {TILES.map(t => (
              <label key={t[0]} style={{ ...S.chip, background: tiles.includes(t[0]) ? 'light-dark(#E6F0EA, #222c31)' : 'light-dark(#fff, #161d21)' }}>
                <input type="checkbox" checked={tiles.includes(t[0])} onChange={() => setTiles(x => x.includes(t[0]) ? x.filter(y => y !== t[0]) : [...x, t[0]])} /> {t[1]}
              </label>
            ))}
          </div>
          <label style={{ ...S.chip, marginTop: 10, background: tiles.includes('leaders') ? '#E6F0EA' : '#fff' }}>
            <input type="checkbox" checked={tiles.includes('leaders')} onChange={() => setTiles(x => x.includes('leaders') ? x.filter(y => y !== 'leaders') : [...x, 'leaders'])} /> Leaderboard
          </label>
          <button onClick={() => setTiles([...TILES.map(t => t[0]), 'leaders'])} style={{ ...S.btn, marginTop: 10, marginLeft: 8 }}>Show all</button>
        </div>
      )}

      {/* Advanced engine: live calls, monitoring, service level, TV links (2026-11-13) */}
      {!tv && <CxLiveBoard clientId={clientId} controls={false} />}

      {/* widgets (left) + leaderboard (right) */}
      <style>{'@media (max-width: 1000px){.wb-split{grid-template-columns:minmax(0,1fr) !important}}'}</style>
      <div className="wb-split" style={{ display: 'grid', gridTemplateColumns: tiles.includes('leaders') ? 'minmax(0,1.35fr) minmax(300px,1fr)' : 'minmax(0,1fr)', gap: 14, alignItems: 'stretch' }}>
      <div style={{ display: 'grid', gap: 14 }}>
      {groups.map(g => (
        <div key={g}>
          <div style={S.cap}>{g}</div>
          <div style={S.tiles}>
            {shown.filter(t => t[2] === g).map(t => (
              <div key={t[0]} style={{ ...S.tile, ...(g === 'Live' && STATE[t[0]] ? { borderTop: `4px solid ${STATE[t[0]].color}` } : {}) }} title={t[4] || ''}>
                <div style={{ fontSize: tv ? 40 : 30, fontWeight: 800, lineHeight: 1.1 }}>{t[3](d)}</div>
                <div style={{ fontSize: 12.5, color: 'light-dark(#5F6763, #b3c1c7)', marginTop: 4 }}>{t[1]}</div>
                {t[4] && !tv && <div style={{ fontSize: 11, color: '#8a918d', marginTop: 2 }}>{t[4]}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
      {tiles.includes('leaders') && <Leaderboard data={leaders} failed={leadersFailed} tv={tv} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Phone lines</div>
          {(d.lines || []).length === 0 ? <p style={S.mut}>No lines in your view.</p> : (
            <table style={S.tbl}><thead><tr><th style={S.th}>Line</th><th style={S.th}>Calls</th><th style={S.th}>Answered</th><th style={S.th}>Missed</th></tr></thead>
              <tbody>{d.lines.map((l, i) => (
                <tr key={i}><td style={S.td}>{l.name}{!l.live && <div style={{ fontSize: 11.5, color: 'light-dark(#b45309, #e07524)' }}>No number connected (test)</div>}</td>
                  <td style={S.tdn}>{l.calls}</td><td style={S.tdn}>{l.answered}</td><td style={{ ...S.tdn, color: l.missed ? 'light-dark(#b91c1c, #e86464)' : undefined, fontWeight: l.missed ? 800 : 400 }}>{l.missed}</td></tr>
              ))}</tbody></table>
          )}
        </div>
        <div style={S.card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Latest calls</div>
          {(d.recent || []).length === 0 ? <p style={S.mut}>No calls in this range.</p> : (
            <table style={S.tbl}><tbody>{d.recent.slice(0, 12).map((c, i) => (
              <tr key={i}>
                <td style={{ ...S.td, whiteSpace: 'nowrap', color: 'light-dark(#5F6763, #b3c1c7)' }}>{tme(c.at)}</td>
                <td style={S.td}>{c.dir === 'in' ? '↘' : '↗'} {c.csr}<div style={{ fontSize: 11.5, color: '#8a918d' }}>{c.src} · …{c.last4}</div></td>
                <td style={S.td}><span style={{ ...S.pill, fontSize: 11.5, color: c.group === 'sales' ? '#15803d' : c.group === 'service' ? '#0e7490' : '#64748b', background: 'light-dark(#f5f5f4, #1b2327)' }}>{c.label || 'No disposition'}</span></td>
                <td style={{ ...S.tdn, color: 'light-dark(#5F6763, #b3c1c7)' }}>{mmss(c.talk)}</td>
              </tr>
            ))}</tbody></table>
          )}
        </div>
      </div>
    </div>
  )

  if (tv) return <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'light-dark(#F5F3EE, #1b2327)', overflow: 'auto', padding: 20, fontFamily: 'Montserrat, Arial, sans-serif' }}>{body}</div>
  return body
}
function rate(r, k) {
  if (k === 'intent_rate') return r.handled ? r.intent / r.handled : -1
  if (k === 'book_decision') return r.intent ? r.booked / r.intent : -1
  if (k === 'book_all') return r.handled ? r.booked / r.handled : -1
  if (k === 'avg_talk') return r.handled ? r.talk / r.handled : -1
  if (k === 'avg_acw') return r.handled ? r.wrap_secs / r.handled : -1
  return r[k] ?? 0
}

const S = {
  card: { background: 'light-dark(#fff, #161d21)', border: '1px solid light-dark(#E8E4DC, #2a3439)', borderRadius: 14, padding: 16 },
  mut: { fontSize: 12.5, color: 'light-dark(#5F6763, #b3c1c7)', margin: 0 },
  cap: { fontSize: 10.5, fontWeight: 700, letterSpacing: '.13em', textTransform: 'uppercase', color: 'light-dark(#56605B, #b3c1c7)', margin: '0 0 6px' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 },
  tile: { background: 'light-dark(#fff, #161d21)', border: '1px solid light-dark(#E8E4DC, #2a3439)', borderRadius: 12, padding: '14px 14px 12px' },
  sel: { border: '1px solid light-dark(#E1DCD2, #2a3439)', borderRadius: 10, padding: '8px 10px', fontSize: 13, background: 'light-dark(#fff, #161d21)', fontFamily: 'inherit' },
  btn: { border: '1px solid light-dark(#E1DCD2, #2a3439)', borderRadius: 10, padding: '8px 12px', fontSize: 13, background: 'light-dark(#fff, #161d21)', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' },
  chip: { display: 'inline-flex', gap: 6, alignItems: 'center', border: '1px solid light-dark(#E1DCD2, #2a3439)', borderRadius: 999, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' },
  tbl: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'light-dark(#56605B, #b3c1c7)', padding: '8px 10px', background: 'light-dark(#F3F1EC, #1b2327)', cursor: 'pointer', whiteSpace: 'nowrap' },
  td: { padding: '9px 10px', borderTop: '1px solid light-dark(#F1EEE8, #2a3439)', verticalAlign: 'top' },
  tdn: { padding: '9px 10px', borderTop: '1px solid light-dark(#F1EEE8, #2a3439)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  pill: { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap' },
}
export { Leaderboard }
