import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTerms } from '../lib/terms'

// ============================================================
// DASHBOARD (redesign 2026-11-04)
//   Tabs:  Overview (all permitted clients/projects — Owners + "Overview" checkbox)
//          Client / Project (pick a client, then a project — only the ones they may see)
//   Views: Operations · Staffing · Schedule · Activity (each its own checkbox)
// All numbers come from the dash_* database functions, which only ever return what the
// signed-in person may see (scope, views, and which employees: Owners all; Administrators
// agents + internal staff in scope; others agents in scope; plus people who report to them).
// Personal items (walk reminder, my intervals, unread) live on My Profile, not here.
// ============================================================

const CSS = `
.db-wrap { max-width: 1320px; }
.db-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.db-head h1 { margin: 0; font-size: 24px; font-weight: 800; }
.db-head p { margin: 2px 0 0; color: var(--ink-soft); font-size: 13.5px; }
.db-pills { display: inline-flex; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 3px; gap: 2px; }
.db-pill { border: 0; background: transparent; border-radius: 999px; padding: 7px 18px; font: inherit; font-size: 13.5px; font-weight: 700; color: var(--ink); cursor: pointer; white-space: nowrap; }
.db-pill.on { background: var(--accent); color: var(--accent-ink); }
.db-views { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 16px 0 20px; }
.db-view { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 7px 15px; font: inherit; font-size: 13px; font-weight: 700; color: var(--ink); cursor: pointer; }
.db-view.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.db-sel { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 10px; padding: 8px 12px; font: inherit; font-size: 13.5px; font-weight: 600; min-width: 170px; }
.db-grid4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
@media (max-width: 1050px) { .db-grid4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.db-kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 18px; display: flex; gap: 14px; align-items: center; }
.db-kpi-ic { width: 46px; height: 46px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-bg); color: var(--accent); flex: none; }
.db-kpi-v { font-size: 26px; font-weight: 800; line-height: 1.1; }
.db-kpi-l { font-size: 13px; font-weight: 600; color: var(--ink); margin-top: 2px; }
.db-kpi-d { font-size: 12px; font-weight: 700; margin-top: 3px; }
.db-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; min-width: 0; }
.db-card h3 { margin: 0 0 14px; font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
.db-card h3 small { font-size: 12.5px; color: var(--ink-soft); font-weight: 500; }
.db-split { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 1050px) { .db-split { grid-template-columns: 1fr; } }
.db-bar { display: grid; grid-template-columns: 92px 1fr 46px; align-items: center; gap: 12px; padding: 6px 0; font-size: 13px; }
.db-bar-track { height: 9px; background: var(--canvas); border-radius: 999px; overflow: hidden; }
.db-bar-fill { height: 100%; border-radius: 999px; }
.db-tbl { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.db-tbl th { text-align: left; font-size: 12px; font-weight: 700; color: var(--ink-soft); padding: 9px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.db-tbl td { padding: 11px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.db-tbl tr.sub td { background: var(--canvas); font-size: 13px; }
.db-tbl tr.sub td:first-child { padding-left: 36px; color: var(--ink-soft); }
.db-tbl tr.tot td { font-weight: 800; background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.db-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.db-exp { border: 0; background: transparent; cursor: pointer; font: inherit; font-weight: 700; color: var(--ink); display: inline-flex; align-items: center; gap: 8px; padding: 0; }
.db-chev { width: 16px; display: inline-block; transition: transform .15s; color: var(--ink-soft); }
.db-badge { display: inline-block; min-width: 44px; text-align: center; font-weight: 800; font-size: 12.5px; padding: 3px 9px; border-radius: 999px; }
.db-att { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.db-att:last-child { border-bottom: 0; }
.db-empty { color: var(--ink-soft); font-size: 13.5px; padding: 18px 0; text-align: center; }
.db-cell { border-radius: 8px; padding: 6px 4px; text-align: center; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; }
.db-person { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.db-av { width: 34px; height: 34px; border-radius: 50%; background: var(--accent-bg); color: var(--accent); display: grid; place-items: center; font-weight: 800; font-size: 12.5px; overflow: hidden; flex: none; }
.db-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.db-tbl-wrap { overflow-x: auto; }
`

// ---- small helpers ----
const tone = (pct) => pct == null ? ['var(--canvas)', 'var(--ink-soft)'] : pct >= 85 ? ['#DCFCE7', '#166534'] : pct >= 70 ? ['#FEF3C7', '#92400E'] : ['#FEE2E2', '#991B1B']
const barColor = (pct) => pct == null ? 'var(--line)' : pct >= 85 ? '#16A34A' : pct >= 70 ? '#EAB308' : '#DC2626'
const Pct = ({ v }) => { const [bg, fg] = tone(v); return <span className="db-badge" style={{ background: bg, color: fg }}>{v == null ? '—' : `${v}%`}</span> }
const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
const fmtDayParts = (d) => { const x = new Date(d + 'T12:00:00'); return [x.toLocaleDateString('en-US', { weekday: 'short' }), x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] }
const fmtTime = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA') }
const initials = (n) => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

// line icons (24×24, currentColor)
const I = {
  ops: 'M3 3v18h18M8 16v-5M13 16V8M18 16v-3', staff: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  sched: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18', act: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', fill: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  open: 'M3 5h18v16H3zM3 10h18M12 14v4M10 16h4', agents: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', cert: 'M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4',
  on: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2', warn: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  cal: 'M3 5h18v16H3zM16 3v4M8 3v4', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3', chev: 'M9 18l6-6-6-6',
}
const Ico = ({ d, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>

function Delta({ now, prev, unit = '', goodUp = true }) {
  if (now == null || prev == null) return null
  const diff = Number(now) - Number(prev)
  if (!diff) return <div className="db-kpi-d" style={{ color: 'var(--ink-soft)' }}>No change vs. prior period</div>
  const good = goodUp ? diff > 0 : diff < 0
  return <div className="db-kpi-d" style={{ color: good ? '#16A34A' : '#DC2626' }}>{diff > 0 ? '↑' : '↓'} {diff > 0 ? '+' : ''}{diff}{unit} vs. prior period</div>
}
function Kpi({ icon, value, label, children }) {
  return (
    <div className="db-kpi">
      <div className="db-kpi-ic"><Ico d={icon} size={22} /></div>
      <div style={{ minWidth: 0 }}><div className="db-kpi-v">{value ?? '—'}</div><div className="db-kpi-l">{label}</div>{children}</div>
    </div>
  )
}
const Loading = () => <div className="db-card"><div className="db-empty">Loading…</div></div>
const Err = ({ msg }) => <div className="db-card"><div className="db-empty" style={{ color: '#B91C1C' }}>{/not allowed/i.test(msg) ? "You don't have access to this view." : msg}</div></div>

// ============================================================
export default function Dashboard() {
  const T = useTerms()
  const [scope, setScope] = useState(null)
  const [tab, setTab] = useState(null)            // 'overview' | 'client'
  const [view, setView] = useState(null)          // 'operations' | 'staffing' | 'schedule' | 'activity'
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [days, setDays] = useState(7)
  const [from, setFrom] = useState(todayET())

  const [flags, setFlags] = useState({ nudge: true, open: true })   // Configuration → Alerts on/off
  useEffect(() => { supabase.rpc('dash_alert_flags').then(({ data }) => { if (data) setFlags(data) }) }, [])
  useEffect(() => {
    supabase.rpc('dash_scope').then(({ data }) => {
      const s = data || {}
      setScope(s)
      const t = s.overview ? 'overview' : s.client_tab ? 'client' : null
      setTab(t)
      setView(['operations', 'staffing', 'schedule', 'activity'].find(v => s.views?.[v]) || null)
      if (!s.overview && s.clients?.length) setClientId(s.clients[0].id)
    })
  }, [])

  if (!scope) return <div className="db-wrap"><style>{CSS}</style><p className="page-sub">Loading dashboard…</p></div>
  if (!tab || !view) return (
    <div className="db-wrap"><style>{CSS}</style>
      <div className="db-card"><div className="db-empty">The Dashboard isn't part of your access yet. Ask an administrator if you need it.</div></div>
    </div>
  )
  const client = scope.clients?.find(c => c.id === clientId)
  const filter = tab === 'overview' ? { c: null, p: null } : { c: clientId || null, p: projectId || null }
  const VIEWS = [['operations', 'Operations', I.ops], ['staffing', 'Staffing', I.staff], ['schedule', 'Schedule', I.sched], ['activity', 'Activity', I.act]].filter(([k]) => scope.views?.[k])

  return (
    <div className="db-wrap">
      <style>{CSS}</style>
      <div className="db-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1>Dashboard</h1>
          <p>{tab === 'overview' ? `Organization overview across all your ${T.clients.toLowerCase()} and ${T.projects.toLowerCase()}.` : `Everything for one ${T.client.toLowerCase()} — or one ${T.project.toLowerCase()}.`}</p>
        </div>
        {(view === 'operations' || view === 'schedule') && (
          <select className="db-sel" style={{ minWidth: 150 }} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Date range">
            <option value={7}>Next 7 days</option><option value={14}>Next 14 days</option>
          </select>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="db-pills" role="tablist">
          {scope.overview && <button role="tab" className={'db-pill' + (tab === 'overview' ? ' on' : '')} onClick={() => setTab('overview')}>Overview</button>}
          {scope.client_tab && (scope.clients || []).length > 0 && <button role="tab" className={'db-pill' + (tab === 'client' ? ' on' : '')}
            onClick={() => { setTab('client'); if (!clientId && scope.clients?.length) setClientId(scope.clients[0].id) }}>{T.client} / {T.project}</button>}
        </div>
        {tab === 'client' && (
          <>
            <select className="db-sel" value={clientId} onChange={e => { setClientId(e.target.value); setProjectId('') }} aria-label={T.client}>
              {(scope.clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="db-sel" value={projectId} onChange={e => setProjectId(e.target.value)} aria-label={T.project}>
              <option value="">All {T.projects.toLowerCase()}</option>
              {(client?.projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}
      </div>

      <div className="db-views">
        <span className="page-sub" style={{ fontSize: 13, marginRight: 4 }}>View:</span>
        {VIEWS.map(([k, l, ic]) => <button key={k} className={'db-view' + (view === k ? ' on' : '')} onClick={() => setView(k)}><Ico d={ic} size={16} />{l}</button>)}
      </div>

      {view === 'operations' && <Operations key={`o${tab}${filter.c}${filter.p}${days}`} f={filter} days={days} from={from} T={T} overview={tab === 'overview'} />}
      {view === 'staffing' && <Staffing key={`s${tab}${filter.c}${filter.p}`} f={filter} T={T} canNudge={!!scope.nudge && flags.nudge !== false} canCheck={!!scope.checkin} />}
      {view === 'schedule' && <Schedule key={`c${tab}${filter.c}${filter.p}`} f={filter} days={days} from={from} setFrom={setFrom} T={T} canNudge={!!scope.nudge && flags.open !== false} />}
      {view === 'activity' && <Activity key={`a${tab}${filter.c}${filter.p}`} f={filter} T={T} overview={tab === 'overview'} scope={scope} />}
    </div>
  )
}

function useRpc(fn, args) {
  const [state, setState] = useState({ data: null, err: '' })
  const key = JSON.stringify(args)
  useEffect(() => {
    let alive = true
    setState({ data: null, err: '' })
    supabase.rpc(fn, args).then(({ data, error }) => { if (alive) setState({ data, err: error ? error.message : '' }) })
    return () => { alive = false }
  }, [fn, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

// Expandable client → project table rows
function useOpen() { const [open, setOpen] = useState({}); return [open, (id) => setOpen(o => ({ ...o, [id]: !o[id] }))] }

// ---------------------------- OPERATIONS ----------------------------
function Operations({ f, days, from, T, overview }) {
  const { data, err } = useRpc('dash_operations', { p_client: f.c, p_project: f.p, p_from: from, p_days: days })
  const [open, toggle] = useOpen()
  const navigate = useNavigate()
  if (err) return <Err msg={err} />
  if (!data) return <Loading />
  const k = data.kpis || {}
  const rows = data.rows || []
  return (
    <>
      <div className="db-grid4">
        <Kpi icon={I.fill} value={k.fill_rate != null ? `${k.fill_rate}%` : '—'} label="Overall fill rate"><Delta now={k.fill_rate} prev={k.fill_rate_prev} unit="%" /></Kpi>
        <Kpi icon={I.open} value={(k.open_spots ?? 0).toLocaleString()} label="Open spots to fill"><Delta now={k.open_spots} prev={k.open_spots_prev} goodUp={false} /></Kpi>
        <Kpi icon={I.agents} value={k.active_agents ?? 0} label="Active agents"><Delta now={k.active_agents} prev={k.active_agents_prev} /></Kpi>
        <Kpi icon={I.cert} value={k.certs_week ?? 0} label="Agent certifications"><div className="db-kpi-d" style={{ color: 'var(--ink-soft)' }}>passed in the last 7 days</div></Kpi>
      </div>

      <div className="db-split">
        <div className="db-card">
          <h3><Ico d={I.ops} size={18} />Fill rate — next {days} days <small>{overview ? `(all ${T.clients.toLowerCase()} & ${T.projects.toLowerCase()})` : ''}</small></h3>
          {(data.daily || []).every(d => !d.spots) ? <div className="db-empty">No intervals scheduled in this range.</div>
            : (data.daily || []).map(d => (
              <div key={d.date} className="db-bar">
                <span style={{ fontWeight: 600 }}>{fmtDay(d.date)}</span>
                <span className="db-bar-track"><span className="db-bar-fill" style={{ display: 'block', width: `${d.pct || 0}%`, background: barColor(d.pct) }} /></span>
                <span className="num" style={{ fontWeight: 700, textAlign: 'right' }}>{d.pct == null ? '—' : `${d.pct}%`}</span>
              </div>
            ))}
        </div>
        <div className="db-card">
          <h3><span style={{ color: '#D97706', display: 'inline-flex' }}><Ico d={I.warn} size={18} /></span>Needs attention <small>({(data.attention || []).length})</small></h3>
          {(data.attention || []).length === 0 ? <div className="db-empty">Nothing below 70% — nice. 🎉</div>
            : data.attention.map((a, i) => (
              <div key={i} className="db-att">
                <span style={{ color: '#DC2626', marginTop: 1 }}><Ico d={I.warn} size={16} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{a.client}{a.project ? ` – ${a.project}` : ''}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}><b style={{ color: '#DC2626' }}>{a.pct}%</b> fill rate ({fmtDay(a.date)}) · {a.open} open spot{a.open === 1 ? '' : 's'}</div>
                </div>
              </div>
            ))}
          {(data.attention || []).length > 0 && <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12.5 }} onClick={() => navigate('/insights')}>Open schedule insights →</button>}
        </div>
      </div>

      <div className="db-card">
        <h3><Ico d={I.staff} size={18} />{T.client} &amp; {T.project} performance</h3>
        {rows.length === 0 ? <div className="db-empty">No scheduled work in this range.</div> : (
          <div className="db-tbl-wrap"><table className="db-tbl">
            <thead><tr><th>{T.client}</th><th className="num">{T.projects}</th><th className="num">Fill rate</th><th className="num">Open spots</th><th className="num">Active agents</th><th className="num">Spots scheduled</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const id = r.client_id || 'internal', isOpen = open[id]
                return (
                  <Fragment key={id}>
                    <tr>
                      <td><button className="db-exp" onClick={() => toggle(id)} aria-expanded={!!isOpen}><span className="db-chev" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}><Ico d={I.chev} size={15} /></span>{r.client}</button></td>
                      <td className="num">{(r.projects || []).length}</td><td className="num"><Pct v={r.pct} /></td>
                      <td className="num">{(r.open ?? 0).toLocaleString()}</td><td className="num">{r.agents ?? 0}</td><td className="num">{(r.spots ?? 0).toLocaleString()}</td>
                    </tr>
                    {isOpen && (r.projects || []).map(p => (
                      <tr key={id + (p.project_id || 'none')} className="sub">
                        <td>{p.name}</td><td className="num">—</td><td className="num"><Pct v={p.pct} /></td>
                        <td className="num">{(p.open ?? 0).toLocaleString()}</td><td className="num">{p.agents ?? 0}</td><td className="num">{(p.spots ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  )
}

// ---------------------------- STAFFING ----------------------------
function Donut({ parts }) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1
  let acc = 0
  const stops = parts.map(p => { const a = acc; acc += p.v / total * 100; return `${p.c} ${a}% ${acc}%` }).join(', ')
  return (
    <div style={{ width: 170, height: 170, borderRadius: '50%', background: `conic-gradient(${stops})`, display: 'grid', placeItems: 'center', flex: 'none' }}>
      <div style={{ width: 118, height: 118, borderRadius: '50%', background: 'var(--surface)', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{parts.reduce((s, p) => s + p.v, 0)}</div><div style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 4 }}>Total staff</div></div>
      </div>
    </div>
  )
}
function Staffing({ f, T, canNudge, canCheck }) {
  const { data, err } = useRpc('dash_staffing', { p_client: f.c, p_project: f.p })
  const [open, toggle] = useOpen()
  const [who, setWho] = useState('all')       // all | agent | internal
  const [ptab, setPtab] = useState('people')  // people | late | on  (check-ins live under People)
  const [counts, setCounts] = useState({ late: 0, on: 0 })
  const peopleRef = useRef(null)
  const goLate = () => { setPtab('late'); setTimeout(() => peopleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  const [onlyOn, setOnlyOn] = useState(false)
  const [q, setQ] = useState('')
  if (err) return <Err msg={err} />
  if (!data) return <Loading />
  const t = data.totals || {}
  const people = (data.people || []).filter(p => (who === 'all' || p.type === who) && (!onlyOn || p.on_now) && (!q.trim() || `${p.name} ${p.title || ''} ${p.where || ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  const parts = [{ l: 'Agents', v: t.agents || 0, c: 'var(--accent)' }, ...(data.can_internal ? [{ l: 'Internal', v: t.internal || 0, c: '#94A3B8' }] : [])]
  return (
    <>
      <div className="db-grid4">
        <Kpi icon={I.staff} value={t.total ?? 0} label="Total staff" />
        <Kpi icon={I.agents} value={t.agents ?? 0} label="Agents" />
        {data.can_internal ? <Kpi icon={I.staff} value={t.internal ?? 0} label="Internal staff" /> : <Kpi icon={I.open} value={t.open_spots ?? 0} label="Open spots (next 7 days)" />}
        <Kpi icon={I.on} value={t.on_now ?? 0} label="On now"><div className="db-kpi-d" style={{ color: '#16A34A' }}>● checked in right now</div></Kpi>
      </div>
      {data.can_names && counts.late > 0 && (
        <div className="db-card" style={{ borderColor: '#FCD34D', background: 'color-mix(in srgb, #F59E0B 8%, var(--surface))', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', flexWrap: 'wrap' }}>
          <span style={{ color: '#D97706', display: 'inline-flex' }}><Ico d={I.warn} size={20} /></span>
          <span style={{ flex: 1, minWidth: 220, fontSize: 14 }}><b>{counts.late} {counts.late === 1 ? 'person hasn\'t' : 'people haven\'t'} checked in</b> for intervals that already started.</span>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={goLate}>Review &amp; nudge →</button>
        </div>
      )}
      {!data.can_names && <CheckIns f={f} T={T} canNudge={canNudge} canCheck={canCheck} />}
      {data.can_names && ptab === 'people' && <CheckIns f={f} T={T} onCounts={setCounts} countsOnly />}
      <div className="db-split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.7fr)' }}>
        <div className="db-card">
          <h3>Staff by type</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <Donut parts={parts} />
            <div style={{ display: 'grid', gap: 10, fontSize: 13.5 }}>
              {parts.map(p => <div key={p.l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="db-dot" style={{ background: p.c, width: 10, height: 10 }} /><b>{p.l}</b> {p.v} <span className="page-sub">({Math.round(p.v / ((t.total || 1)) * 100)}%)</span></div>)}
              {!data.can_internal && <div className="page-sub" style={{ fontSize: 12, maxWidth: 200 }}>Internal staff aren't shown at your access level.</div>}
            </div>
          </div>
        </div>
        <div className="db-card">
          <h3>Staffing by {T.client.toLowerCase()} &amp; {T.project.toLowerCase()}</h3>
          {(data.rows || []).length === 0 ? <div className="db-empty">Nobody is assigned here yet.</div> : (
            <div className="db-tbl-wrap"><table className="db-tbl">
              <thead><tr><th>{T.client} / {T.project}</th><th className="num">Assigned</th><th className="num">On now</th><th className="num">Utilization <span title="Spots filled vs. scheduled, next 7 days" style={{ cursor: 'help' }}>ⓘ</span></th></tr></thead>
              <tbody>
                {data.rows.map(r => {
                  const id = r.client_id || 'internal', isOpen = open[id]
                  return (
                    <Fragment key={id}>
                      <tr>
                        <td><button className="db-exp" onClick={() => toggle(id)}><span className="db-chev" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}><Ico d={I.chev} size={15} /></span>{r.client} <span className="page-sub" style={{ fontWeight: 500 }}>({(r.projects || []).length})</span></button></td>
                        <td className="num">{r.assigned}</td><td className="num">{r.on_now}</td><td className="num"><Pct v={r.utilization} /></td>
                      </tr>
                      {isOpen && (r.projects || []).map(p => (
                        <tr key={id + (p.project_id || 'none')} className="sub"><td>{p.name}</td><td className="num">{p.assigned}</td><td className="num">{p.on_now}</td><td className="num"><Pct v={p.utilization} /></td></tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
      {data.can_names && (
        <div className="db-card" ref={peopleRef} style={{ scrollMarginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>People</h3>
            <div className="db-pills" style={{ marginRight: 'auto' }}>
              <button className={'db-pill' + (ptab === 'people' ? ' on' : '')} style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setPtab('people')}>Everyone</button>
              <button className={'db-pill' + (ptab === 'late' ? ' on' : '')} style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setPtab('late')}>
                {counts.late ? <span style={{ color: ptab === 'late' ? undefined : '#B45309' }}>⚠ </span> : null}Not checked in ({counts.late})</button>
              <button className={'db-pill' + (ptab === 'on' ? ' on' : '')} style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setPtab('on')}>Checked in ({counts.on})</button>
            </div>
            {ptab === 'people' && <>
            <div className="db-pills">
              {[['all', 'All'], ['agent', 'Agents'], ...(data.can_internal ? [['internal', 'Internal']] : [])].map(([k, l]) => <button key={k} className={'db-pill' + (who === k ? ' on' : '')} style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => setWho(k)}>{l}</button>)}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}><input type="checkbox" checked={onlyOn} onChange={e => setOnlyOn(e.target.checked)} /> On now only</label>
            <input className="db-sel" style={{ minWidth: 200, fontWeight: 400 }} placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" />
            </>}
          </div>
          {ptab !== 'people' ? <CheckIns f={f} T={T} canNudge={canNudge} canCheck={canCheck} tab={ptab} onCounts={setCounts} embedded />
          : people.length === 0 ? <div className="db-empty">Nobody matches.</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', columnGap: 24 }}>
              {people.map(p => (
                <a key={p.id} href={`/profile/${p.id}`} className="db-person" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="db-av">{p.avatar ? <img src={p.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(p.name)}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{p.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.type === 'agent' ? 'Agent' : (p.title || 'Internal')} · {p.where}</span>
                  </span>
                  {p.on_now && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#16A34A', whiteSpace: 'nowrap' }}><span className="db-dot" style={{ background: '#16A34A', marginRight: 5 }} />On now</span>}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------- SCHEDULE ----------------------------
function Schedule({ f, days, from, setFrom, T, canNudge }) {
  const { data, err } = useRpc('dash_schedule', { p_client: f.c, p_project: f.p, p_from: from, p_days: days })
  const [open, toggle] = useOpen()
  const [sub, setSub] = useState('overview')
  const [mode, setMode] = useState('filled')   // filled | open | pct
  if (err) return <Err msg={err} />
  if (!data) return <Loading />
  const dayList = data.days || []
  const cellVal = (c) => !c || !c.spots ? null : mode === 'open' ? c.spots - c.filled : mode === 'pct' ? Math.round(100 * c.filled / c.spots) : c.filled
  const cellBg = (c) => { if (!c || !c.spots) return 'transparent'; const p = 100 * c.filled / c.spots; return tone(Math.round(p))[0] }
  const total = Object.fromEntries(dayList.map(d => [d, (data.rows || []).reduce((a, r) => { const c = r.cells?.[d] || {}; return { spots: a.spots + (c.spots || 0), filled: a.filled + (c.filled || 0) } }, { spots: 0, filled: 0 })]))
  const isWeekend = (d) => [0, 6].includes(new Date(d + 'T12:00:00').getDay())
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="db-pills">
          <button className={'db-pill' + (sub === 'overview' ? ' on' : '')} style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => setSub('overview')}>Schedule overview</button>
          <button className={'db-pill' + (sub === 'open' ? ' on' : '')} style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => setSub('open')}>Open intervals ({(data.open || []).length})</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <button className="btn btn-ghost" style={{ padding: '6px 10px' }} onClick={() => setFrom(addDays(from, -days))} aria-label="Earlier">‹</button>
          <span style={{ fontWeight: 700, fontSize: 13.5, minWidth: 150, textAlign: 'center' }}>{fmtDayParts(data.from)[1]} – {fmtDayParts(data.to)[1]}</span>
          <button className="btn btn-ghost" style={{ padding: '6px 10px' }} onClick={() => setFrom(addDays(from, days))} aria-label="Later">›</button>
          {from !== todayET() && <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setFrom(todayET())}>Today</button>}
        </div>
        {sub === 'overview' && (
          <select className="db-sel" style={{ minWidth: 150 }} value={mode} onChange={e => setMode(e.target.value)} aria-label="Show">
            <option value="filled">Show: filled spots</option><option value="open">Show: open spots</option><option value="pct">Show: fill rate %</option>
          </select>
        )}
      </div>
      {sub === 'overview' ? (
        <div className="db-card">
          {(data.rows || []).length === 0 ? <div className="db-empty">Nothing scheduled in this range.</div> : (
            <div className="db-tbl-wrap"><table className="db-tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>{T.client} / {T.project}</th>{dayList.map(d => { const [w, md] = fmtDayParts(d); return <th key={d} className="num" style={{ textAlign: 'center', color: isWeekend(d) ? '#B91C1C' : undefined }}>{w}<div style={{ fontWeight: 500 }}>{md}</div></th> })}</tr></thead>
              <tbody>
                {data.rows.map(r => {
                  const id = r.client_id || 'internal', isOpen = open[id]
                  return (
                    <Fragment key={id}>
                      <tr>
                        <td style={{ whiteSpace: 'nowrap' }}><button className="db-exp" onClick={() => toggle(id)}><span className="db-chev" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}><Ico d={I.chev} size={15} /></span>{r.client} <span className="page-sub" style={{ fontWeight: 500 }}>({(r.projects || []).length})</span></button></td>
                        {dayList.map(d => { const c = r.cells?.[d]; const v = cellVal(c); return <td key={d}><div className="db-cell" style={{ background: cellBg(c) }} title={c?.spots ? `${c.filled} of ${c.spots} spots filled` : 'Nothing scheduled'}>{v == null ? '—' : mode === 'pct' ? `${v}%` : v}</div></td> })}
                      </tr>
                      {isOpen && (r.projects || []).map(p => (
                        <tr key={id + (p.project_id || 'none')} className="sub">
                          <td>{p.name}</td>
                          {dayList.map(d => { const c = p.cells?.[d]; const v = cellVal(c); return <td key={d}><div className="db-cell" style={{ background: cellBg(c), fontWeight: 600 }}>{v == null ? '—' : mode === 'pct' ? `${v}%` : v}</div></td> })}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
                <tr className="tot"><td>Total</td>{dayList.map(d => { const c = total[d]; const v = cellVal(c); return <td key={d}><div className="db-cell">{v == null ? '—' : mode === 'pct' ? `${v}%` : v}</div></td> })}</tr>
              </tbody>
            </table></div>
          )}
          <div className="page-sub" style={{ fontSize: 12, marginTop: 10 }}>Colors show coverage: green 85%+, amber 70–84%, red under 70%. Hover a cell for filled vs. scheduled.</div>
        </div>
      ) : (
        <OpenIntervals open={data.open || []} T={T} canNudge={canNudge} />
      )}
    </>
  )
}

// ---------------------------- ACTIVITY ----------------------------
const ACTION_TEXT = { claimed: 'picked up an interval', released: 'released an interval', checked_in: 'checked in', checked_out: 'checked out', marked_no_show: 'was marked a no-show',
  assigned: 'was assigned an interval', unassigned: 'was unassigned from an interval', break_started: 'started a break', break_ended: 'ended a break', passed: 'passed a certification',
  nudged: 'was nudged to check in', open_alert: 'open-interval alert sent' }
const ACTION_ICON = { checked_in: I.on, checked_out: I.on, passed: I.cert, marked_no_show: I.warn }
function Activity({ f, T, overview, scope }) {
  const [clientF, setClientF] = useState('')
  const [projectF, setProjectF] = useState('')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(h) }, [q])
  const c = overview ? (clientF || null) : f.c, p = overview ? (projectF || null) : f.p
  const { data, err } = useRpc('dash_activity', { p_client: c, p_project: p, p_kind: kind || null, p_search: debounced || null, p_limit: 200 })
  const cl = (scope.clients || []).find(x => x.id === clientF)
  return (
    <div className="db-card">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {overview && (
          <>
            <select className="db-sel" value={clientF} onChange={e => { setClientF(e.target.value); setProjectF('') }} aria-label={T.client}>
              <option value="">All {T.clients.toLowerCase()}</option>{(scope.clients || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select className="db-sel" value={projectF} onChange={e => setProjectF(e.target.value)} disabled={!clientF} aria-label={T.project}>
              <option value="">All {T.projects.toLowerCase()}</option>{(cl?.projects || []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </>
        )}
        <select className="db-sel" value={kind} onChange={e => setKind(e.target.value)} aria-label="Activity type">
          <option value="">All activity types</option>
          <option value="claimed">Picked up intervals</option><option value="released">Released intervals</option>
          <option value="checked_in">Check-ins</option><option value="checked_out">Check-outs</option>
          <option value="marked_no_show">No-shows</option><option value="assigned">Assignments</option>
          <option value="nudged">Check-in nudges</option><option value="open_alert">Open-interval alerts</option>
          {overview && <option value="certification">Certifications</option>}
        </select>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-soft)' }}><Ico d={I.search} size={16} /></span>
          <input className="db-sel" style={{ width: '100%', paddingLeft: 32, fontWeight: 400, boxSizing: 'border-box' }} placeholder="Search activity…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search activity" />
        </div>
      </div>
      {err ? <Err msg={err} /> : !data ? <div className="db-empty">Loading…</div> : data.length === 0 ? <div className="db-empty">No activity matches.</div> : (
        <div className="db-tbl-wrap"><table className="db-tbl">
          <thead><tr><th>Activity</th><th>{T.client} / {T.project}</th><th>Date &amp; time</th></tr></thead>
          <tbody>{data.map(a => (
            <tr key={a.id}>
              <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: a.action === 'marked_no_show' ? '#DC2626' : 'var(--accent)', display: 'inline-flex' }}><Ico d={ACTION_ICON[a.action] || I.staff} size={17} /></span>
                <span>{a.action === 'open_alert'
                  ? <><b>{a.actor || 'Someone'}</b> sent an open-interval alert{a.person ? ` to ${a.person}` : ''}</>
                  : a.action === 'nudged' ? <><b>{a.person || 'A team member'}</b> was nudged to check in{a.actor ? <> by <b>{a.actor}</b></> : null}</>
                  : <><b>{a.person || a.actor || 'Someone'}</b> {ACTION_TEXT[a.action] || a.action.replace(/_/g, ' ')}</>}
                  {a.what ? <span className="page-sub"> · {a.what}</span> : null}</span>
              </span></td>
              <td>{a.client || (a.kind === 'certification' ? 'Certifications' : 'Internal')}{a.project ? <span className="page-sub"> / {a.project}</span> : null}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}


// ---------------------------- actions: nudges + open-interval alerts ----------------------------
const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }
function Flash({ msg }) { return msg ? <div style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 9, fontSize: 13, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div> : null }

// Check-ins: people whose interval started but haven't checked in (Nudge / Check in), and
// people checked in right now (Check out). Actions need their own checkboxes; all logged.
function CheckIns({ f, T, canNudge, canCheck, tab: tabProp, onCounts, embedded, countsOnly }) {
  const [late, setLate] = useState(null)
  const [on, setOn] = useState(null)
  const [tabState, setTab] = useState('late')
  const tab = tabProp || tabState
  useEffect(() => { if (late && on && onCounts) onCounts({ late: late.length, on: on.length }) }, [late, on]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [inAt, setInAt] = useState('in')   // 'in' (now) | 'in_at_start'
  const load = useCallback(() => {
    supabase.rpc('dash_not_checked_in', { p_client: f.c, p_project: f.p }).then(({ data }) => setLate(data || []))
    supabase.rpc('dash_on_now', { p_client: f.c, p_project: f.p }).then(({ data }) => setOn(data || []))
  }, [f.c, f.p])
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])
  async function nudge(claims, label) {
    setBusy(label); setMsg(null)
    const { data, error } = await supabase.rpc('dash_nudge', { p_claims: claims })
    setBusy(null)
    if (error) return setMsg({ kind: 'err', text: error.message })
    setMsg({ kind: 'ok', text: data.sent ? `Nudged ${data.sent} ${data.sent === 1 ? 'person' : 'people'} — they got a notification and a push.${data.skipped ? ` ${data.skipped} skipped (nudged in the last 10 minutes).` : ''}` : 'Everyone here was nudged in the last 10 minutes.' })
    load()
  }
  async function check(claims, action, label, who) {
    setBusy(label); setMsg(null)
    const { data, error } = await supabase.rpc('dash_check', { p_claims: claims, p_action: action })
    setBusy(null)
    if (error) return setMsg({ kind: 'err', text: error.message })
    const verb = action === 'out' ? 'Checked out' : 'Checked in'
    setMsg({ kind: data.done ? 'ok' : 'err', text: data.done ? `${verb} ${claims.length === 1 && who ? who : `${data.done} ${data.done === 1 ? 'person' : 'people'}`}${action === 'in_at_start' ? ' as of their interval start' : ''}. It's noted on their record that you did it from the Dashboard.`
      : `Nothing changed — ${action === 'out' ? 'they may already be checked out' : 'they may already be checked in'} (you also can't check yourself in or out here).` })
    load()
  }
  if (countsOnly) return null
  if (!late || !on) return embedded ? <div className="db-empty">Loading…</div> : null
  if (!embedded && !late.length && !on.length) return null
  const rows = tab === 'late' ? late : on
  const Wrap = embedded ? 'div' : 'div'
  return (
    <Wrap className={embedded ? '' : 'db-card'} style={!embedded && late.length ? { borderColor: '#FCD34D' } : embedded ? { marginTop: 8 } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap', justifyContent: embedded ? 'flex-end' : undefined }}>
        {!embedded && <h3 style={{ margin: 0 }}><Ico d={I.on} size={18} />Check-ins</h3>}
        {!embedded && <div className="db-pills" style={{ marginRight: 'auto' }}>
          <button className={'db-pill' + (tab === 'late' ? ' on' : '')} style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => { setTab('late'); setMsg(null) }}>
            {late.length ? <span style={{ color: tab === 'late' ? undefined : '#B45309' }}>⚠ </span> : null}Not checked in ({late.length})</button>
          <button className={'db-pill' + (tab === 'on' ? ' on' : '')} style={{ padding: '5px 14px', fontSize: 12.5 }} onClick={() => { setTab('on'); setMsg(null) }}>Checked in ({on.length})</button>
        </div>}
        {tab === 'late' && late.length > 0 && canCheck && (
          <select className="db-sel" style={{ minWidth: 0, fontSize: 12.5, padding: '6px 10px' }} value={inAt} onChange={e => setInAt(e.target.value)} aria-label="Check in as of">
            <option value="in">Check in as of: now</option><option value="in_at_start">Check in as of: interval start</option>
          </select>
        )}
        {tab === 'late' && canNudge && late.length > 1 && <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={!!busy} onClick={() => nudge(late.map(r => r.claim_id), 'all')}>{busy === 'all' ? 'Nudging…' : `🔔 Nudge all ${late.length}`}</button>}
      </div>
      <Flash msg={msg} />
      {rows.length === 0 ? <div className="db-empty">{tab === 'late' ? 'Everyone who should be on has checked in. 🎉' : 'Nobody is checked in right now.'}</div> : (
        <div className="db-tbl-wrap"><table className="db-tbl">
          <thead><tr><th>Who</th><th>Interval</th><th>{T.client} / {T.project}</th>{tab === 'late' ? <><th>Late</th><th>Last nudged</th></> : <th>Checked in</th>}{(canNudge || canCheck) && <th />}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.claim_id}>
              <td style={{ fontWeight: 700 }}>{r.name}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.start)} – {fmtTime(r.end)}<div className="page-sub" style={{ fontSize: 12 }}>{r.role || ''}</div></td>
              <td>{r.client || 'Internal'}{r.project ? <span className="page-sub"> · {r.project}</span> : null}</td>
              {tab === 'late' ? <>
                <td><span className="db-badge" style={{ background: r.minutes_late >= 15 ? '#FEE2E2' : '#FEF3C7', color: r.minutes_late >= 15 ? '#991B1B' : '#92400E' }}>{r.minutes_late} min</span></td>
                <td className="page-sub" style={{ fontSize: 12.5 }}>{r.last_nudged ? ago(r.last_nudged) : '—'}</td>
              </> : <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}</td>}
              {(canNudge || canCheck) && (
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {tab === 'late' && canNudge && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px' }} disabled={!!busy} onClick={() => nudge([r.claim_id], 'n' + r.claim_id)}>{busy === 'n' + r.claim_id ? '…' : '🔔 Nudge'}</button>}
                  {tab === 'late' && canCheck && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px', marginLeft: 6 }} disabled={!!busy} onClick={() => check([r.claim_id], inAt, 'i' + r.claim_id, r.name)}>{busy === 'i' + r.claim_id ? '…' : '✓ Check in'}</button>}
                  {tab === 'on' && canCheck && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px' }} disabled={!!busy} onClick={() => { if (window.confirm(`Check ${r.name} out now?`)) check([r.claim_id], 'out', 'o' + r.claim_id, r.name) }}>{busy === 'o' + r.claim_id ? '…' : '⏏ Check out'}</button>}
                </td>
              )}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Wrap>
  )
}

// Open intervals: how many people are available, and alert them (one, several or all).
function OpenIntervals({ open, T, canNudge }) {
  const [avail, setAvail] = useState({})
  const [picked, setPicked] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const ids = open.map(b => b.id)
  useEffect(() => {
    if (!ids.length) return
    supabase.rpc('dash_open_available', { p_blocks: ids }).then(({ data }) => setAvail(data || {}))
  }, [ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  async function alert(blockIds) {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('dash_alert_open', { p_blocks: blockIds, p_note: note || null })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: error.message })
    setMsg({ kind: 'ok', text: data.people ? `Alerted ${data.people} available ${data.people === 1 ? 'person' : 'people'} about ${data.intervals} interval${data.intervals === 1 ? '' : 's'} — notification + push.` : 'Nobody new to alert — everyone available was already alerted in the last 2 hours (or nobody is free then).' })
    setPicked(new Set())
  }
  if (!open.length) return <div className="db-card"><div className="db-empty">Every interval in this range is filled. 🎉</div></div>
  const selected = [...picked]
  return (
    <div className="db-card">
      {canNudge && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <input className="db-sel" style={{ flex: '1 1 260px', fontWeight: 400 }} maxLength={140} placeholder="Optional note to include — e.g. Bonus tokens for this one!" value={note} onChange={e => setNote(e.target.value)} aria-label="Alert note" />
          <button className="btn btn-primary" style={{ fontSize: 13 }} disabled={busy || !selected.length} onClick={() => alert(selected)}>{busy ? 'Sending…' : `🔔 Alert available (${selected.length} selected)`}</button>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} disabled={busy} onClick={() => alert(ids)}>Alert for all {ids.length}</button>
        </div>
      )}
      <Flash msg={msg} />
      <div className="db-tbl-wrap"><table className="db-tbl">
        <thead><tr>{canNudge && <th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" checked={selected.length === ids.length} onChange={e => setPicked(e.target.checked ? new Set(ids) : new Set())} /></th>}
          <th>Date</th><th>Time</th><th>{T.client} / {T.project}</th><th>Role</th><th className="num">Open</th><th className="num">Available <span title="Assigned to this schedule, not working an overlapping interval, not already on it" style={{ cursor: 'help' }}>ⓘ</span></th>{canNudge && <th />}</tr></thead>
        <tbody>{open.map(b => (
          <tr key={b.id}>
            {canNudge && <td><input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} aria-label="Select interval" /></td>}
            <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtDay(b.date)}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtTime(b.start)} – {fmtTime(b.end)}</td>
            <td>{b.client || 'Internal'}{b.project ? <span className="page-sub"> · {b.project}</span> : null}</td><td>{b.role || '—'}</td>
            <td className="num"><b style={{ color: '#DC2626' }}>{b.open}</b> <span className="page-sub">/ {b.spots}</span></td>
            <td className="num">{avail[b.id] ?? '…'}</td>
            {canNudge && <td className="num"><button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '5px 12px', whiteSpace: 'nowrap' }} disabled={busy || !avail[b.id]} onClick={() => alert([b.id])}>🔔 Alert</button></td>}
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  )
}
