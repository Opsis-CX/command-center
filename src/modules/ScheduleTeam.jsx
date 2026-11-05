import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// SCHEDULE — TEAM / INTERNAL VIEW (2026-11-05)
// Client → Project → people, with an "Open intervals" row on top (identical openings grouped
// into one card). Today / This week / This month. Every number and action comes from the
// sched_* database functions, which check permission + client/project scope + lock status on
// the server (the buttons here only appear when the person may use them).
//   Team view     = agent intervals on client schedules
//   Internal view = internal staff shifts (schedules with no client)
// My View (claiming, trades, check-ins) stays in Schedule.jsx, unchanged.
// ============================================================

export const ST_CSS = `
.st-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.st-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 10px; padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.st-btn:hover:not(:disabled) { border-color: var(--accent); }
.st-btn.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.st-btn:disabled { opacity: .45; cursor: default; }
.st-btn.danger { color: #B91C1C; }
.st-sel { border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 10px; padding: 7px 10px; font: inherit; font-size: 13px; font-weight: 600; }
.st-client { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; margin-bottom: 14px; overflow: hidden; }
.st-chead { display: flex; align-items: center; gap: 14px; padding: 14px 18px; flex-wrap: wrap; cursor: pointer; }
.st-chead h2 { margin: 0; font-size: 19px; font-weight: 800; }
.st-pill { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: var(--canvas); color: var(--ink-soft); }
.st-stat { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 700; color: var(--ink); }
.st-tabs { display: flex; gap: 6px; padding: 0 18px 12px; flex-wrap: wrap; align-items: center; }
.st-grid { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.st-grid th { background: var(--canvas); font-weight: 700; padding: 8px 6px; text-align: center; border-bottom: 1px solid var(--line); white-space: nowrap; }
.st-grid th.today { background: color-mix(in srgb, var(--accent) 14%, var(--canvas)); }
.st-grid td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; text-align: center; }
.st-grid td.who { text-align: left; white-space: nowrap; font-weight: 700; font-size: 13px; padding-left: 14px; position: sticky; left: 0; background: var(--surface); z-index: 1; }
.st-grid tr.openrow td { background: color-mix(in srgb, var(--st-open, #F59E0B) 9%, var(--surface)); }
.st-grid tr.openrow td.who { background: color-mix(in srgb, var(--st-open, #F59E0B) 14%, var(--surface)); }
.st-chip.noshow { background: color-mix(in srgb, var(--st-noshow, #DC2626) 14%, var(--surface)); color: color-mix(in srgb, var(--st-noshow, #DC2626) 75%, #0F172A); border-color: color-mix(in srgb, var(--st-noshow, #DC2626) 45%, transparent); }
.st-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--st-checkedin, #16A34A); display: inline-block; flex: none; }
.st-comfy .st-chip { padding: 8px 9px; font-size: 12.5px; max-width: 180px; }
.st-comfy .st-grid td { padding: 9px 10px; }
.st-comfy .st-grid td.who { font-size: 14px; }
.st-chip { display: flex; align-items: center; justify-content: center; gap: 5px; border-radius: 8px; padding: 5px 6px; margin: 0 auto 4px; font-size: 11.5px; font-weight: 700; cursor: pointer; border: 1px solid transparent; white-space: nowrap; width: 100%; max-width: 150px; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; }
.st-chip.stack { flex-direction: column; gap: 1px; line-height: 1.25; padding: 5px 4px; }
.st-chip .cnt { font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; }
.st-chip.past { background: color-mix(in srgb, var(--st-past, #94A3B8) 16%, var(--surface)); color: color-mix(in srgb, var(--st-past, #94A3B8) 72%, #0F172A); border-color: color-mix(in srgb, var(--st-past, #94A3B8) 45%, transparent); }
.st-chip.current { background: color-mix(in srgb, var(--st-current, #3B82F6) 16%, var(--surface)); color: color-mix(in srgb, var(--st-current, #3B82F6) 72%, #0F172A); border-color: color-mix(in srgb, var(--st-current, #3B82F6) 45%, transparent); }
.st-chip.upcoming { background: color-mix(in srgb, var(--st-upcoming, #8B5CF6) 16%, var(--surface)); color: color-mix(in srgb, var(--st-upcoming, #8B5CF6) 72%, #0F172A); border-color: color-mix(in srgb, var(--st-upcoming, #8B5CF6) 45%, transparent); }
.st-chip.open { background: color-mix(in srgb, var(--st-open, #F59E0B) 16%, var(--surface)); color: color-mix(in srgb, var(--st-open, #F59E0B) 72%, #0F172A); border-color: color-mix(in srgb, var(--st-open, #F59E0B) 45%, transparent); }
.st-chip.locked { background: color-mix(in srgb, var(--st-locked, #64748B) 16%, var(--surface)); color: color-mix(in srgb, var(--st-locked, #64748B) 72%, #0F172A); border-color: color-mix(in srgb, var(--st-locked, #64748B) 45%, transparent); border-style: dashed; }
.st-av { width: 26px; height: 26px; border-radius: 50%; background: var(--accent-bg); color: var(--accent); display: inline-grid; place-items: center; font-weight: 800; font-size: 10.5px; margin-right: 8px; vertical-align: middle; }
.st-modal-bg { position: fixed; inset: 0; background: rgba(15,23,42,.42); z-index: 3000; display: grid; place-items: center; padding: 14px; }
.st-modal { background: var(--surface); color: var(--ink); border-radius: 16px; width: min(560px, 100%); max-height: 90vh; overflow: auto; box-shadow: 0 24px 60px rgba(0,0,0,.25); }
.st-mh { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.st-mh h3 { margin: 0; font-size: 17px; font-weight: 800; flex: 1; }
.st-mb { padding: 16px 20px; }
.st-kv { display: grid; grid-template-columns: 110px 1fr; gap: 7px 12px; font-size: 13.5px; }
.st-kv span:nth-child(odd) { color: var(--ink-soft); }
.st-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.st-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.st-msg { padding: 8px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 10px; }
.st-msg.ok { background: #ECFDF5; color: #047857; } .st-msg.err { background: #FEF2F2; color: #B91C1C; }
.st-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 14px 34px rgba(15,23,42,.16); padding: 12px 14px; width: 250px; text-align: left; }
`
const ICO = {
  cal: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18', ppl: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  chair: 'M6 19v-6h12v6M5 13V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M8 19v2M16 19v2', lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2', plus: 'M12 5v14M5 12h14', exp: 'M12 3v12M7 10l5 5 5-5M5 21h14', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  chev: 'M9 18l6-6-6-6', x: 'M18 6 6 18M6 6l12 12', info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01', copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1', check: 'M20 6 9 17l-5-5',
}
const Ico = ({ d, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>

const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
const mondayOf = (iso) => { const d = new Date(iso + 'T12:00:00'); const k = SETTINGS.week_starts === 0 ? d.getDay() : (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toLocaleDateString('en-CA') }
// ---- Configuration → Schedule (2026-11-05): company settings, loaded once and shared ----
export const SCHED_DEFAULTS = { colors: { past: '#94A3B8', current: '#3B82F6', upcoming: '#8B5CF6', open: '#F59E0B', locked: '#64748B', noshow: '#DC2626', checkedin: '#16A34A' },
  group_by: 'client_project', default_range: 'week', week_starts: 1, time_format: '12', density: 'compact', open_row: 'top', people_sort: 'name', people_limit: 8 }
let SETTINGS = SCHED_DEFAULTS, settingsPromise = null
export function loadScheduleSettings(force) {
  if (!settingsPromise || force) settingsPromise = supabase.from('schedule_settings').select('*').maybeSingle()
    .then(({ data }) => { SETTINGS = data ? { ...SCHED_DEFAULTS, ...data, colors: { ...SCHED_DEFAULTS.colors, ...(data.colors || {}) } } : SCHED_DEFAULTS; return SETTINGS })
  return settingsPromise
}
export function useScheduleSettings() {
  const [s, setS] = useState(SETTINGS)
  useEffect(() => { let alive = true; loadScheduleSettings().then(v => { if (alive) setS(v) }); return () => { alive = false } }, [])
  return s
}
// CSS variables for the interval colors (put on any wrapper; chips read them)
export const colorVars = (colors = {}) => Object.fromEntries(Object.entries({ ...SCHED_DEFAULTS.colors, ...colors }).map(([k, v]) => [`--st-${k}`, v]))
const fmtT = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number)
  if (SETTINGS.time_format === '24') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}` }
const fmtTT = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number)
  if (SETTINGS.time_format === '24') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const dayHead = (iso) => { const d = new Date(iso + 'T12:00:00'); return [d.toLocaleDateString('en-US', { weekday: 'short' }), d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] }
const longDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const hrs = (s, e) => { const [a, b] = [s, e].map(t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }); return ((b - a) / 60).toFixed((b - a) % 60 ? 1 : 0) }
const initials = (n) => (n || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
const errText = (e) => String(e?.message || e || '').replace(/^.*?ERROR:\s*/, '') || 'Something went wrong.'

function rangeFor(mode, anchor) {
  if (mode === 'day') return [anchor, anchor]
  if (mode === 'month') { const d = new Date(anchor + 'T12:00:00'); const a = new Date(d.getFullYear(), d.getMonth(), 1), b = new Date(d.getFullYear(), d.getMonth() + 1, 0); return [a.toLocaleDateString('en-CA'), b.toLocaleDateString('en-CA')] }
  const m = mondayOf(anchor); return [m, addDays(m, 6)]
}
function daysBetween(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out }

export default function ScheduleTeam({ mode: modeProp = 'team', view = null }) {
  // A saved view (Configuration → Schedule → Views) narrows and lays out what the server already allows.
  const mode = view?.base || modeProp
  const settings = useScheduleSettings()
  const groupBy = view?.group_by || settings.group_by
  const openRow = view?.open_row || settings.open_row
  const [scope, setScope] = useState(null)
  const [range, setRange] = useState(view?.default_range || SETTINGS.default_range || 'week')
  const [anchor, setAnchor] = useState(todayET())
  const [clientF, setClientF] = useState('')
  const [projectF, setProjectF] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState({})          // client id → expanded
  const [proj, setProj] = useState({})          // client id → active project id
  const [more, setMore] = useState({})          // project key → show all people
  const [detail, setDetail] = useState(null)    // block id
  const [legend, setLegend] = useState(false)
  const [toast, setToast] = useState(null)
  const [addFor, setAddFor] = useState(null)    // { clientId, projectId }
  const legendRef = useRef(null)

  const [from, to] = rangeFor(range, anchor)
  const days = useMemo(() => daysBetween(from, to), [from, to])
  const today = todayET()

  useEffect(() => { supabase.rpc('sched_scope').then(({ data }) => setScope(data || {})) }, [])
  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.rpc('sched_view', { p_mode: mode, p_from: from, p_to: to, p_client: clientF || null, p_project: projectF || null })
    if (error) { setErr(errText(error)); setData({ blocks: [], clients: [] }); return }
    setData(data)
  }, [mode, from, to, clientF, projectF])
  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => { if (!view?.default_range) setRange(settings.default_range) }, [settings.default_range]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!legend) return
    const h = (e) => { if (legendRef.current && !legendRef.current.contains(e.target)) setLegend(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [legend])
  const flash = (kind, text) => { setToast({ kind, text }); setTimeout(() => setToast(null), 4500) }

  function shift(dir) {
    if (range === 'day') setAnchor(addDays(anchor, dir))
    else if (range === 'week') setAnchor(addDays(anchor, dir * 7))
    else { const d = new Date(anchor + 'T12:00:00'); d.setMonth(d.getMonth() + dir, 1); setAnchor(d.toLocaleDateString('en-CA')) }
  }
  const label = range === 'day' ? longDate(from) : range === 'month' ? new Date(from + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : `${dayHead(from)[1]} – ${dayHead(to)[1]}`

  // filter by search (person, role or time)
  const ql = q.trim().toLowerCase()
  const blocks = useMemo(() => (data?.blocks || [])
    .filter(b => !view?.client_ids?.length || view.client_ids.includes(b.client_id))
    .filter(b => !view?.project_ids?.length || view.project_ids.includes(b.project_id))
    .filter(b => !view?.roles?.length || view.roles.some(r => (b.role || '').toLowerCase().includes(String(r).toLowerCase())))
    .map(b => view?.people && view.people !== 'all' ? { ...b, people: (b.people || []).filter(p => view.people === 'agents' ? p.agent !== false : p.agent === false) } : b)
    .filter(b => !ql || (b.role || '').toLowerCase().includes(ql) || fmtTT(b.start).toLowerCase().includes(ql)
      || (b.people || []).some(p => (p.name || '').toLowerCase().includes(ql))), [data, ql, view])

  function exportCsv() {
    const rows = [['Client', 'Project', 'Date', 'Start', 'End', 'Role', 'Spots', 'Filled', 'Open', 'Locked', 'People']]
    const cName = Object.fromEntries((data?.clients || []).map(c => [c.id || '', c.name]))
    const pName = Object.fromEntries((data?.clients || []).flatMap(c => c.projects).map(p => [p.id || '', p.name]))
    for (const b of blocks) rows.push([cName[b.client_id || ''] || 'Internal', pName[b.project_id || ''] || '', b.date, fmtTT(b.start), fmtTT(b.end), b.role || '', b.total, b.filled,
      b.locked ? 0 : Math.max(b.total - b.filled, 0), b.locked ? 'yes' : 'no', (b.people || []).map(p => p.name || 'Assigned').join('; ')])
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `schedule-${mode}-${from}-to-${to}.csv`; a.click()
  }
  async function lockOpen(blockIds, lock) {
    if (!blockIds.length) return flash('err', lock ? 'Nothing open to lock in this view.' : 'Nothing locked here.')
    if (!window.confirm(lock ? `Lock ${blockIds.length} interval${blockIds.length === 1 ? '' : 's'}? Everyone already assigned stays; the open spots close.` : `Unlock ${blockIds.length} interval${blockIds.length === 1 ? '' : 's'}? Their open spots reopen.`)) return
    const { data: r, error } = await supabase.rpc('sched_lock', { p_blocks: blockIds, p_lock: lock })
    if (error) return flash('err', errText(error))
    flash('ok', `${lock ? 'Locked' : 'Unlocked'} ${r.done} interval${r.done === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped — no permission or already ${lock ? 'locked' : 'unlocked'})` : ''}.`); load()
  }

  // Sections by the chosen grouping: Client → Project (tabs), Client, Project, or one list
  const cName = Object.fromEntries((data?.clients || []).map(c => [c.id || 'internal', c.name]))
  const pName = Object.fromEntries((data?.clients || []).flatMap(c => c.projects).map(p => [p.id || 'none', p.name]))
  const sections = ((() => {
    if (!data) return []
    const byClient = (data.clients || []).map(c => ({ c, b: blocks.filter(x => (x.client_id || 'internal') === (c.id || 'internal')) })).filter(x => x.b.length)
    if (groupBy === 'none') return blocks.length ? [{ key: 'all', title: view?.name || 'All schedules', tabs: [{ key: 'all', label: 'All', blocks }] }] : []
    if (groupBy === 'client') return byClient.map(({ c, b }) => ({ key: c.id || 'internal', title: c.name, sub: `${c.projects.length} project${c.projects.length === 1 ? '' : 's'}`,
      tabs: [{ key: 'all', label: 'All', blocks: b }] }))
    if (groupBy === 'project') {
      const keys = [...new Set(blocks.map(x => `${x.client_id || 'internal'}|${x.project_id || 'none'}`))]
      return keys.map(k => { const [ci, pi] = k.split('|'); const b = blocks.filter(x => `${x.client_id || 'internal'}|${x.project_id || 'none'}` === k)
        return { key: k, title: pName[pi] && pi !== 'none' ? pName[pi] : 'No project', sub: cName[ci] || 'Internal', tabs: [{ key: pi, label: pName[pi] || 'No project', blocks: b }],
          addCtx: () => ({ clientId: ci === 'internal' ? null : ci, projectId: pi === 'none' ? null : pi }) } })
        .sort((x, y) => (x.sub + x.title).localeCompare(y.sub + y.title))
    }
    return byClient.map(({ c, b }) => ({ key: c.id || 'internal', title: c.name, sub: `${c.projects.length} project${c.projects.length === 1 ? '' : 's'}`,
      tabs: c.projects.map(p => ({ key: p.id || 'none', label: p.name, blocks: b.filter(x => (x.project_id || 'none') === (p.id || 'none')) })),
      addCtx: (pk) => ({ clientId: c.id, projectId: pk === 'none' ? null : pk }) }))
  })()).map(sec => ({ ...sec, blocks: sec.tabs.flatMap(t => t.blocks) }))   // header totals use every interval in the section

  if (!scope || !data) return <div><style>{ST_CSS}</style><p className="page-sub">Loading schedule…</p></div>
  const clientOpts = (scope.clients || []).filter(c => !view?.client_ids?.length || view.client_ids.includes(c.id))
  const projOpts = (clientOpts.find(c => c.id === clientF)?.projects) || []

  return (
    <div style={colorVars(settings.colors)} className={settings.density === 'comfortable' ? 'st-comfy' : ''}>
      <style>{ST_CSS}</style>
      {toast && <div className={'st-msg ' + toast.kind} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 4000, boxShadow: '0 10px 30px rgba(0,0,0,.15)', maxWidth: 420 }}>{toast.text}</div>}
      <div className="st-bar">
        <button className="st-btn" onClick={() => shift(-1)} aria-label="Previous">‹</button>
        <span style={{ fontWeight: 800, fontSize: 14, minWidth: 150, textAlign: 'center' }}>{label}</span>
        <button className="st-btn" onClick={() => shift(1)} aria-label="Next">›</button>
        {[['day', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([k, l]) => (
          <button key={k} className={'st-btn' + (range === k ? ' on' : '')} onClick={() => { setRange(k); if (k === 'day' || range === k) setAnchor(today) }}><Ico d={ICO.cal} size={14} />{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {mode === 'team' && <>
          <select className="st-sel" value={clientF} onChange={e => { setClientF(e.target.value); setProjectF('') }} aria-label="Client"><option value="">All clients</option>{clientOpts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="st-sel" value={projectF} onChange={e => setProjectF(e.target.value)} disabled={!clientF} aria-label="Project"><option value="">All projects</option>{projOpts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </>}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 9, top: 9, color: 'var(--ink-soft)' }}><Ico d={ICO.search} size={15} /></span>
          <input className="st-sel" style={{ paddingLeft: 30, width: 220, fontWeight: 400 }} placeholder="Search people, roles or times…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        </div>
        <div ref={legendRef} style={{ position: 'relative' }}>
          <button className="st-btn" onClick={() => setLegend(v => !v)} aria-expanded={legend}><Ico d={ICO.info} size={15} />Legend</button>
          {legend && (
            <div className="st-pop">
              {[['past', 'Past'], ['current', 'Happening now'], ['upcoming', 'Upcoming'], ['open', 'Open spots'], ['locked', 'Locked (open spots closed)']].map(([c, l]) => (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', fontSize: 13 }}><span className={'st-chip ' + c} style={{ width: 34, height: 16, margin: 0, padding: 0 }}>{c === 'locked' ? <Ico d={ICO.lock} size={11} /> : null}</span>{l}</div>
              ))}
              <div className="page-sub" style={{ fontSize: 12, marginTop: 6 }}>● green = checked in · ✓ = done</div>
            </div>
          )}
        </div>
      </div>

      {err && <div className="st-msg err">{err}</div>}
      {sections.length === 0 && <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 26 }}>{mode === 'internal' ? 'No internal shifts in this range.' : 'No intervals in this range for the clients and projects you can see.'}</div></div>}

      {sections.map((sec, si) => {
        const cid = sec.key, isOpen = open[cid] !== undefined ? open[cid] : (si === 0 || sections.length === 1)   // first section starts open
        const cb = sec.blocks
        const assigned = cb.reduce((n, b) => n + b.filled, 0), total = cb.reduce((n, b) => n + b.total, 0)
        const openSpots = cb.filter(b => !b.locked && b.state !== 'past').reduce((n, b) => n + Math.max(b.total - b.filled, 0), 0)
        const lockedSpots = cb.filter(b => b.locked).reduce((n, b) => n + Math.max(b.total - b.filled, 0), 0)
        const people = new Set(cb.flatMap(b => (b.people || []).map(p => p.person_id)))
        const fill = total ? Math.round(100 * assigned / total) : null
        const activeP = sec.tabs.length > 1 ? (proj[cid] !== undefined && sec.tabs.some(t => t.key === proj[cid]) ? proj[cid] : sec.tabs[0].key) : sec.tabs[0].key
        const pb = sec.tabs.find(t => t.key === activeP)?.blocks || []
        return (
          <div key={cid} className="st-client">
            <div className="st-chead" onClick={() => setOpen(o => ({ ...o, [cid]: !isOpen }))} role="button" aria-expanded={isOpen}>
              <span style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--ink-soft)', display: 'inline-flex' }}><Ico d={ICO.chev} size={18} /></span>
              <h2>{sec.title}</h2>
              {sec.sub && <span className="st-pill">{sec.sub}</span>}
              <span className="st-pill">{people.size} {mode === 'internal' ? 'people' : 'agents'}</span>
              <span style={{ flex: 1 }} />
              <span className="st-stat"><Ico d={ICO.cal} />{cb.length} intervals</span>
              <span className="st-stat"><Ico d={ICO.ppl} />{assigned} assigned</span>
              <span className="st-stat" style={{ background: openSpots ? 'color-mix(in srgb, var(--st-open, #F59E0B) 16%, var(--surface))' : 'transparent', color: openSpots ? 'color-mix(in srgb, var(--st-open, #F59E0B) 72%, #0F172A)' : undefined, padding: '3px 9px', borderRadius: 999 }}><Ico d={ICO.chair} />{openSpots} open</span>
              {lockedSpots > 0 && <span className="st-stat" style={{ color: '#475569' }} title="Open spots closed by locking"><Ico d={ICO.lock} />{lockedSpots} locked</span>}
              {fill != null && <span className="st-stat" style={{ color: fill >= 85 ? '#16A34A' : fill >= 70 ? '#B45309' : '#DC2626' }}>◯ {fill}% fill rate</span>}
            </div>
            {isOpen && (
              <>
                <div className="st-tabs">
                  {sec.tabs.length > 1 && sec.tabs.map(t => {
                    const n = new Set(t.blocks.flatMap(b => (b.people || []).map(x => x.person_id))).size
                    return <button key={t.key} className={'st-btn' + (t.key === activeP ? ' on' : '')} onClick={() => setProj(x => ({ ...x, [cid]: t.key }))}>{t.label} ({n})</button>
                  })}
                  <span style={{ flex: 1 }} />
                  {scope.add && sec.addCtx && <button className="st-btn" onClick={() => setAddFor({ ...sec.addCtx(activeP), blocks: pb })}><Ico d={ICO.plus} size={14} />Add interval</button>}
                  {scope.lock && <button className="st-btn" onClick={() => lockOpen(pb.filter(b => !b.locked && b.state !== 'past' && b.filled < b.total).map(b => b.id), true)}><Ico d={ICO.lock} size={14} />Lock open</button>}
                  {scope.lock && pb.some(b => b.locked) && <button className="st-btn" onClick={() => lockOpen(pb.filter(b => b.locked).map(b => b.id), false)}><Ico d={ICO.unlock} size={14} />Unlock</button>}
                  {scope.export && <button className="st-btn" onClick={exportCsv}><Ico d={ICO.exp} size={14} />Export</button>}
                </div>
                <ProjectGrid days={days} today={today} blocks={pb} mode={mode} openRow={openRow} sort={settings.people_sort} limit={settings.people_limit}
                  showAll={!!more[cid + activeP]} onMore={() => setMore(m => ({ ...m, [cid + activeP]: !m[cid + activeP] }))} onOpen={setDetail} />
              </>
            )}
          </div>
        )
      })}

      {detail && <Detail blockId={detail} onClose={() => setDetail(null)} onChanged={(msg) => { if (msg) flash('ok', msg); load() }} onError={(m) => flash('err', m)} />}
      {addFor && <AddInterval ctx={addFor} defaultDate={range === 'day' ? from : today} onClose={() => setAddFor(null)} onDone={(m) => { setAddFor(null); flash('ok', m); load() }} />}
    </div>
  )
}

// ---------- the calendar for one project ----------
function ProjectGrid({ days, today, blocks, mode, showAll, onMore, onOpen, openRow = 'top', sort = 'name', limit = 8 }) {
  const compact = days.length > 7
  // people rows (named) — anyone without a visible name is grouped as "Assigned"
  const rows = useMemo(() => {
    const m = new Map()
    for (const b of blocks) for (const p of b.people || []) {
      const key = p.name ? p.person_id : '__hidden'
      if (!m.has(key)) m.set(key, { key, name: p.name || 'Assigned (names hidden)', hidden: !p.name, items: [] })
      m.get(key).items.push({ b, p })
    }
    const mins = (t) => { const [h, mm] = String(t).split(':').map(Number); return h * 60 + mm }
    const hours = (r) => r.items.reduce((n, x) => n + (mins(x.b.end) - mins(x.b.start)), 0)
    const first = (r) => r.items.map(x => x.b.date + x.b.start).sort()[0] || ''
    return [...m.values()].sort((a, z) => (a.hidden - z.hidden)
      || (sort === 'hours' ? hours(z) - hours(a) : sort === 'first' ? first(a).localeCompare(first(z)) : 0) || a.name.localeCompare(z.name))
  }, [blocks, sort])
  const visible = showAll ? rows : rows.slice(0, limit)
  // open intervals: identical times on the same day grouped into one card
  const openByDay = useMemo(() => {
    const m = {}
    for (const b of blocks) {
      if (b.state === 'past' || b.filled >= b.total) continue
      const k = `${b.date}|${b.start}|${b.end}|${b.locked ? 'L' : ''}`
      if (!m[b.date]) m[b.date] = {}
      const g = (m[b.date][k] = m[b.date][k] || { start: b.start, end: b.end, open: 0, ids: [], locked: b.locked })
      g.open += b.total - b.filled; g.ids.push(b.id)
    }
    return Object.fromEntries(Object.entries(m).map(([d, gs]) => [d, Object.values(gs).sort((a, z) => a.start.localeCompare(z.start))]))
  }, [blocks])
  const totalOpen = Object.values(openByDay).flat().filter(g => !g.locked).reduce((s, g) => s + g.open, 0)
  if (!blocks.length) return <div className="page-sub" style={{ padding: '6px 18px 18px', fontSize: 13 }}>No intervals here in this range.</div>
  const openRowEl = (
          <tr className="openrow" key="openrow">
            <td className="who"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Ico d={ICO.chair} size={18} /><span>Open intervals<div className="page-sub" style={{ fontSize: 11.5, fontWeight: 500 }}>{totalOpen} total open</div></span></span></td>
            {days.map(d => (
              <td key={d}>{(openByDay[d] || []).length === 0 ? <span className="page-sub">—</span> : (openByDay[d] || []).map((g, i) => (
                <div key={i} className={'st-chip stack ' + (g.locked ? 'locked' : 'open')} onClick={() => onOpen(g.ids[0])}
                  title={`${fmtTT(g.start)} – ${fmtTT(g.end)} · ${g.open} ${g.locked ? 'closed (locked)' : 'open'}${g.ids.length > 1 ? ` · ${g.ids.length} intervals at this time` : ''}`}>
                  <span>{compact ? fmtT(g.start) : `${fmtTT(g.start)} – ${fmtTT(g.end)}`}</span>
                  <span className="cnt">{g.locked && <Ico d={ICO.lock} size={10} />}{g.open} {g.locked ? 'closed' : 'open'}</span>
                </div>
              ))}</td>
            ))}
          </tr>
  )
  const Chip = ({ b, p }) => {
    const done = p?.checked_out || p?.status === 'completed'
    return (
      <div className={'st-chip ' + (p?.status === 'no_show' ? 'noshow' : b.locked && b.state !== 'past' ? 'locked' : b.state)} onClick={() => onOpen(b.id)} title={`${fmtTT(b.start)} – ${fmtTT(b.end)}${b.role ? ' · ' + b.role : ''}${b.locked ? ' · locked' : ''}`}>
        {b.locked && <Ico d={ICO.lock} size={11} />}{compact ? `${fmtT(b.start)}` : `${fmtTT(b.start)} – ${fmtTT(b.end)}`}
        {p?.checked_in && !done && <span className="st-dot" />}
        {done && <Ico d={ICO.check} size={11} />}
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto', borderTop: '1px solid var(--line)' }}>
      <table className="st-grid" style={{ minWidth: compact ? days.length * 78 + 180 : 860 }}>
        <thead><tr><th style={{ textAlign: 'left', paddingLeft: 14, position: 'sticky', left: 0, zIndex: 2 }}>{mode === 'internal' ? 'Staff' : 'Team'}</th>
          {days.map(d => { const [w, md] = dayHead(d); return <th key={d} className={d === today ? 'today' : ''}>{w}<div style={{ fontWeight: 500 }}>{md}</div></th> })}</tr></thead>
        <tbody>
          {openRow === 'top' && openRowEl}
          {visible.map(r => (
            <tr key={r.key}>
              <td className="who">{!r.hidden && <span className="st-av">{initials(r.name)}</span>}{r.name}</td>
              {days.map(d => { const its = r.items.filter(x => x.b.date === d).sort((a, z) => a.b.start.localeCompare(z.b.start))
                return <td key={d}>{its.length ? its.map(x => <Chip key={x.b.id + (x.p.claim_id || '')} b={x.b} p={x.p} />) : <span className="page-sub">—</span>}</td> })}
            </tr>
          ))}
          {openRow === 'bottom' && openRowEl}
        </tbody>
      </table>
      {rows.length > limit && <button className="st-btn" style={{ border: 0, color: 'var(--accent)', margin: '8px 10px' }} onClick={onMore}>{showAll ? 'Show fewer' : `+ Show ${rows.length - limit} more`}</button>}
    </div>
  )
}

// ---------- interval details + actions ----------
function Modal({ title, onClose, children, width }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="st-modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="st-modal" role="dialog" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="st-mh"><h3>{title}</h3><button className="st-btn" style={{ border: 0, padding: 4 }} onClick={onClose} aria-label="Close"><Ico d={ICO.x} size={18} /></button></div>
        <div className="st-mb">{children}</div>
      </div>
    </div>
  )
}
const STATE = { past: ['Past interval', '#F1F5F9', '#475569'], current: ['Happening now', '#DBEAFE', '#1E3A8A'], upcoming: ['Upcoming interval', '#EDE9FE', '#5B21B6'] }

function Detail({ blockId, onClose, onChanged, onError }) {
  const [d, setD] = useState(null)
  const [sub, setSub] = useState(null)    // 'assign' | 'edit' | 'copy' | 'move'
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(null)
  const load = useCallback(() => supabase.rpc('sched_detail', { p_block: blockId }).then(({ data, error }) => { if (error) { onError(errText(error)); onClose() } else setD(data) }), [blockId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  async function run(fn, ok, close = false) {
    setBusy(true)
    const { data, error } = await fn()
    setBusy(false)
    if (error) return onError(errText(error))
    onChanged(typeof ok === 'function' ? ok(data) : ok)
    if (close) onClose(); else load()
  }
  if (!d) return <Modal title="Interval details" onClose={onClose} width={660}><p className="page-sub">Loading…</p></Modal>
  const open = Math.max(d.total - d.filled, 0)
  const [sl, sbg, sfg] = STATE[d.state] || STATE.upcoming
  const can = d.can || {}
  const confirmThen = (key, fn) => { if (sure !== key) { setSure(key); return } setSure(null); fn() }
  return (
    <>
      <Modal title="Interval details" onClose={onClose} width={660}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ background: sbg, color: sfg, fontWeight: 800, fontSize: 12.5, padding: '4px 11px', borderRadius: 999 }}>{sl}</span>
          {d.locked && <span style={{ background: '#F1F5F9', color: '#334155', fontWeight: 800, fontSize: 12.5, padding: '4px 11px', borderRadius: 999, display: 'inline-flex', gap: 5, alignItems: 'center' }}><Ico d={ICO.lock} size={13} />Locked</span>}
        </div>
        <div className="st-kv">
          <span>Client</span><b>{d.client || 'Internal'}</b>
          <span>Project</span><span>{d.project || '—'}</span>
          <span>Date</span><span>{longDate(d.date)}</span>
          <span>Time</span><span>{fmtTT(d.start)} – {fmtTT(d.end)} ({hrs(d.start, d.end)}h)</span>
          {d.role && <><span>Role</span><span>{d.role}</span></>}
          <span>Spots</span><span><b>{d.filled}</b> of {d.total} filled · {d.locked ? <b style={{ color: '#475569' }}>{open} closed (locked)</b> : <b style={{ color: open ? '#B45309' : '#16A34A' }}>{open} open</b>}</span>
          <span>Locked</span><span>{d.locked ? `Yes${d.locked_by ? ` — by ${d.locked_by}` : ''}${d.locked_at ? `, ${new Date(d.locked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}` : 'No'}</span>
          {d.notes && <><span>Notes</span><span>{d.notes}</span></>}
        </div>
        {d.people && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>Assigned ({d.people.length})</div>
            {d.people.length === 0 ? <div className="page-sub" style={{ fontSize: 13 }}>Nobody yet.</div> : d.people.map(p => {
              // attendance status + what can be done (server checks permission, scope, and "not yourself")
              const noShow = p.status === 'no_show', out = !!p.checked_out_at, inn = !!p.checked_in_at
              const at = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
              const [lbl, col] = noShow ? ['🚫 No-show', '#B91C1C'] : out ? [`✓ Done · ${at(p.checked_in_at)}–${at(p.checked_out_at)}`, '#64748B']
                : inn ? [`● Checked in ${at(p.checked_in_at)}`, '#16A34A'] : can.started ? ['Not checked in', '#B45309'] : ['Scheduled', 'var(--ink-soft)']
              const act = (a, msg) => run(() => supabase.rpc('sched_attendance', { p_claims: [p.claim_id], p_action: a }),
                (r) => r.done ? msg : (r.reasons?.[0] || 'Nothing changed.'))
              const small = { padding: '4px 9px', fontSize: 11.5 }
              return (
                <div key={p.claim_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  <span className="st-av">{initials(p.name)}</span>
                  <span style={{ flex: 1, minWidth: 140 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: col }}>{lbl}</span>
                  </span>
                  {can.checkin && !inn && !noShow && can.started && <>
                    <button className="st-btn" style={small} disabled={busy} onClick={() => act('in', `Checked ${p.name} in.`)}>✓ Check in</button>
                    <button className="st-btn" style={small} disabled={busy} title="Check in as of the interval's start time" onClick={() => act('in_at_start', `Checked ${p.name} in as of ${fmtTT(d.start)}.`)}>✓ As of {fmtT(d.start)}</button>
                  </>}
                  {can.checkin && inn && !out && <button className="st-btn" style={small} disabled={busy}
                    onClick={() => confirmThen('o' + p.claim_id, () => act('out', `Checked ${p.name} out.`))}>{sure === 'o' + p.claim_id ? 'Confirm' : '⏏ Check out'}</button>}
                  {can.no_show && !inn && !noShow && can.started && <button className="st-btn danger" style={small} disabled={busy}
                    onClick={() => confirmThen('n' + p.claim_id, () => act('no_show', `Marked ${p.name} as a no-show.`))}>{sure === 'n' + p.claim_id ? 'Confirm' : '🚫 No-show'}</button>}
                  {can.no_show && noShow && <button className="st-btn" style={small} disabled={busy}
                    onClick={() => act('clear_no_show', `Cleared ${p.name}'s no-show.`)}>↩ Clear no-show</button>}
                  {can.unassign && !inn && <button className="st-btn danger" style={small} disabled={busy}
                    onClick={() => confirmThen('u' + p.claim_id, () => run(() => supabase.rpc('sched_unassign', { p_claims: [p.claim_id] }), (r) => r.done ? `Unassigned ${p.name}.` : `Couldn't unassign ${p.name}.`))}>{sure === 'u' + p.claim_id ? 'Confirm' : 'Unassign'}</button>}
                </div>
              )
            })}
          </div>
        )}
        {['assign', 'edit', 'copy', 'move', 'delete', 'lock', 'unlock'].some(k => can[k]) && <div style={{ fontWeight: 800, fontSize: 13.5, margin: '16px 0 2px' }}>Actions</div>}
        <div className="st-acts">
          {can.assign && open > 0 && <button className="st-btn on" disabled={busy} onClick={() => setSub('assign')}><Ico d={ICO.user} />Assign shift</button>}
          {can.edit && <button className="st-btn" disabled={busy} onClick={() => setSub('edit')}><Ico d={ICO.edit} />Edit interval</button>}
          {can.copy && <button className="st-btn" disabled={busy} onClick={() => setSub('copy')}><Ico d={ICO.copy} />Copy interval</button>}
          {can.move && <button className="st-btn" disabled={busy || d.filled > 0} title={d.filled > 0 ? 'Unassign people first (or copy instead)' : ''} onClick={() => setSub('move')}><Ico d={ICO.move} />Move interval</button>}
          {can.lock && <button className="st-btn" disabled={busy} onClick={() => confirmThen('lock', () => run(() => supabase.rpc('sched_lock', { p_blocks: [d.id], p_lock: true }), `Locked — ${open} open spot${open === 1 ? '' : 's'} closed; everyone assigned stays.`))}><Ico d={ICO.lock} />{sure === 'lock' ? 'Click to confirm' : 'Lock interval'}</button>}
          {can.unlock && <button className="st-btn" disabled={busy} onClick={() => run(() => supabase.rpc('sched_lock', { p_blocks: [d.id], p_lock: false }), `Unlocked — ${open} open spot${open === 1 ? '' : 's'} reopened.`)}><Ico d={ICO.unlock} />Unlock interval</button>}
          {can.delete && <button className="st-btn danger" disabled={busy || d.filled > 0} title={d.filled > 0 ? 'Unassign everyone first' : ''} onClick={() => confirmThen('del', () => run(() => supabase.rpc('sched_delete', { p_blocks: [d.id] }), (r) => r.done ? 'Interval deleted.' : 'Couldn\'t delete — people are on it.', true))}><Ico d={ICO.trash} />{sure === 'del' ? 'Click to confirm' : 'Delete interval'}</button>}
        </div>
        {can.assign && open === 0 && <div className="page-sub" style={{ fontSize: 12.5, marginTop: 8 }}>No open spots to assign — edit the interval to add spots.</div>}
      </Modal>
      {sub === 'assign' && <Assign d={d} open={open} onClose={() => setSub(null)} onDone={(m) => { setSub(null); onChanged(m); load() }} onError={onError} />}
      {sub === 'edit' && <EditIv d={d} onClose={() => setSub(null)} onDone={(m) => { setSub(null); onChanged(m); load() }} onError={onError} />}
      {sub === 'copy' && <CopyIv d={d} onClose={() => setSub(null)} onDone={(m) => { setSub(null); onChanged(m) }} onError={onError} />}
      {sub === 'move' && <MoveIv d={d} onClose={() => setSub(null)} onDone={(m) => { setSub(null); onChanged(m); load() }} onError={onError} />}
    </>
  )
}

function Assign({ d, open, onClose, onDone, onError }) {
  const [list, setList] = useState(null)
  const [tab, setTab] = useState('eligible')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [fails, setFails] = useState(null)
  useEffect(() => { supabase.rpc('sched_eligible', { p_block: d.id }).then(({ data, error }) => { if (error) { onError(errText(error)); onClose() } else setList(data) }) }, [d.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else if (n.size < open) n.add(id); return n })
  async function go() {
    setBusy(true); setFails(null)
    const { data, error } = await supabase.rpc('sched_assign', { p_block: d.id, p_people: [...picked] })
    setBusy(false)
    if (error) return onError(errText(error))
    const bad = (data.results || []).filter(r => !r.ok)
    if (bad.length) setFails(bad.map(r => `${(list.eligible || []).find(p => p.id === r.id)?.name || 'Someone'}: ${r.reason}`))
    if (data.assigned) onDone(`Assigned ${data.assigned} ${data.assigned === 1 ? 'person' : 'people'}.${bad.length ? ` ${bad.length} couldn't be added.` : ''}`)
  }
  const ql = q.trim().toLowerCase()
  const rows = (tab === 'eligible' ? list?.eligible : list?.ineligible || []) || []
  const shown = rows.filter(p => !ql || p.name.toLowerCase().includes(ql))
  return (
    <Modal title="Assign shift" onClose={onClose} width={480}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
        <Ico d={ICO.cal} size={18} />
        <div style={{ flex: 1 }}><b style={{ fontSize: 13.5 }}>{d.client || 'Internal'}{d.project ? ` – ${d.project}` : ''}</b><div className="page-sub" style={{ fontSize: 12.5 }}>{longDate(d.date)} · {fmtTT(d.start)} – {fmtTT(d.end)}</div></div>
        <span style={{ background: '#EDE9FE', color: '#5B21B6', fontWeight: 800, fontSize: 12, padding: '4px 10px', borderRadius: 999 }}>{open} open slot{open === 1 ? '' : 's'}</span>
      </div>
      <input className="st-in" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" />
      <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
        <button className={'st-btn' + (tab === 'eligible' ? ' on' : '')} onClick={() => setTab('eligible')}>Eligible ({list?.eligible?.length ?? '…'})</button>
        {list?.ineligible && <button className={'st-btn' + (tab === 'ineligible' ? ' on' : '')} onClick={() => setTab('ineligible')}>Not eligible ({list.ineligible.length})</button>}
      </div>
      {fails && <div className="st-msg err">{fails.map((f, i) => <div key={i}>{f}</div>)}</div>}
      <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        {!list ? <div className="page-sub" style={{ padding: 14 }}>Checking who can work this interval…</div>
          : shown.length === 0 ? <div className="page-sub" style={{ padding: 14, fontSize: 13 }}>{tab === 'eligible' ? 'Nobody is eligible — everyone on this schedule is already on it, busy, over hours, or missing a certification.' : 'Nobody here.'}</div>
          : shown.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--line)', cursor: tab === 'eligible' ? 'pointer' : 'default', opacity: tab === 'eligible' ? 1 : .75 }}>
              {tab === 'eligible' ? <input type="checkbox" checked={picked.has(p.id)} disabled={!picked.has(p.id) && picked.size >= open} onChange={() => toggle(p.id)} /> : <span style={{ width: 13 }} />}
              <span className="st-av" style={{ margin: 0 }}>{initials(p.name)}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
              {tab === 'eligible' ? <span style={{ color: '#16A34A', fontSize: 12.5, fontWeight: 700 }}>✓ Available</span> : <span style={{ color: '#B45309', fontSize: 12, fontWeight: 700 }}>{p.reason}</span>}
            </label>
          ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <span className="page-sub" style={{ fontSize: 13, flex: 1 }}>Selected: {picked.size} of {open} slot{open === 1 ? '' : 's'}</span>
        <button className="st-btn" onClick={onClose}>Cancel</button>
        <button className="st-btn on" disabled={busy || !picked.size} onClick={go}>{busy ? 'Assigning…' : 'Assign shift'}</button>
      </div>
    </Modal>
  )
}

function EditIv({ d, onClose, onDone, onError }) {
  const [f, setF] = useState({ start: d.start.slice(0, 5), end: d.end.slice(0, 5), spots: d.total, role: d.role || '', notes: d.notes || '' })
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('sched_edit', { p_block: d.id, p_start: f.start, p_end: f.end, p_spots: Number(f.spots), p_role: f.role, p_notes: f.notes })
    setBusy(false)
    if (error) return onError(errText(error))
    onDone('Interval updated.')
  }
  return (
    <Modal title="Edit interval" onClose={onClose} width={440}>
      {d.filled > 0 && <div className="st-msg" style={{ background: '#FFFBEB', color: '#92400E' }}>{d.filled} {d.filled === 1 ? 'person is' : 'people are'} on this interval, so its time can't change (spots can't go below {d.filled}).</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 10 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>Start<input type="time" className="st-in" disabled={d.filled > 0} value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>End<input type="time" className="st-in" disabled={d.filled > 0} value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>Spots<input type="number" min={Math.max(d.filled, 1)} className="st-in" value={f.spots} onChange={e => setF({ ...f, spots: e.target.value })} /></label>
      </div>
      <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginTop: 10 }}>Role<input className="st-in" value={f.role} onChange={e => setF({ ...f, role: e.target.value })} /></label>
      <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginTop: 10 }}>Notes<textarea className="st-in" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button className="st-btn" onClick={onClose}>Cancel</button><button className="st-btn on" disabled={busy} onClick={save}>Save</button></div>
    </Modal>
  )
}

function CopyIv({ d, onClose, onDone, onError }) {
  const [dates, setDates] = useState([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const { data, error } = await supabase.rpc('sched_copy', { p_block: d.id, p_dates: dates })
    setBusy(false)
    if (error) return onError(errText(error))
    onDone(`Copied to ${data} day${data === 1 ? '' : 's'} (open, unlocked).`)
  }
  return (
    <Modal title="Copy interval" onClose={onClose} width={420}>
      <div className="page-sub" style={{ fontSize: 13, marginBottom: 10 }}>{fmtTT(d.start)} – {fmtTT(d.end)} · {d.total} spots{d.role ? ` · ${d.role}` : ''}. Copies start empty and unlocked.</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="date" className="st-in" value={pick} onChange={e => setPick(e.target.value)} />
        <button className="st-btn" disabled={!pick || dates.includes(pick)} onClick={() => { setDates([...dates, pick].sort()); setPick('') }}>Add day</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>{dates.map(x => <span key={x} className="st-pill" style={{ cursor: 'pointer' }} onClick={() => setDates(dates.filter(y => y !== x))}>{longDate(x)} ✕</span>)}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="st-btn" onClick={onClose}>Cancel</button><button className="st-btn on" disabled={busy || !dates.length} onClick={go}>Copy to {dates.length || ''} day{dates.length === 1 ? '' : 's'}</button></div>
    </Modal>
  )
}

function MoveIv({ d, onClose, onDone, onError }) {
  const [f, setF] = useState({ date: d.date, start: d.start.slice(0, 5), end: d.end.slice(0, 5) })
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const { error } = await supabase.rpc('sched_move', { p_block: d.id, p_date: f.date, p_start: f.start, p_end: f.end })
    setBusy(false)
    if (error) return onError(errText(error))
    onDone(`Moved to ${longDate(f.date)}, ${fmtTT(f.start)}.`)
  }
  return (
    <Modal title="Move interval" onClose={onClose} width={420}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>Date<input type="date" className="st-in" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>Start<input type="time" className="st-in" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700 }}>End<input type="time" className="st-in" value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button className="st-btn" onClick={onClose}>Cancel</button><button className="st-btn on" disabled={busy} onClick={go}>Move</button></div>
    </Modal>
  )
}

function AddInterval({ ctx, defaultDate, onClose, onDone }) {
  const schedules = useMemo(() => [...new Map((ctx.blocks || []).map(b => [b.schedule_id, b])).keys()], [ctx])
  const [schedList, setSchedList] = useState(null)
  const [f, setF] = useState({ schedule: '', date: defaultDate, start: '08:00', end: '12:00', spots: 3, role: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let q = supabase.from('schedules').select('id, title, client_id, project_id').eq('status', 'published')
    q = ctx.clientId ? q.eq('client_id', ctx.clientId) : q.is('client_id', null)
    q.then(({ data }) => {
      const list = (data || []).filter(s => (s.project_id ?? null) === (ctx.projectId ?? null) || schedules.includes(s.id))
      setSchedList(list); if (list[0]) setF(x => ({ ...x, schedule: list[0].id }))
    })
  }, [ctx, schedules])
  async function go() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sched_add', { p_schedule: f.schedule, p_date: f.date, p_start: f.start, p_end: f.end, p_spots: Number(f.spots), p_role: f.role })
    setBusy(false)
    if (error) return setErr(errText(error))
    onDone('Interval added.')
  }
  return (
    <Modal title="Add interval" onClose={onClose} width={460}>
      {err && <div className="st-msg err">{err}</div>}
      {!schedList ? <p className="page-sub">Loading…</p> : schedList.length === 0 ? <p className="page-sub">No published schedule for this project yet — create one in the Schedule builder first.</p> : <>
        {schedList.length > 1 && <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginBottom: 10 }}>Schedule<select className="st-in" value={f.schedule} onChange={e => setF({ ...f, schedule: e.target.value })}>{schedList.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 80px', gap: 10 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>Date<input type="date" className="st-in" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>Start<input type="time" className="st-in" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} /></label>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>End<input type="time" className="st-in" value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></label>
          <label style={{ fontSize: 12.5, fontWeight: 700 }}>Spots<input type="number" min={1} className="st-in" value={f.spots} onChange={e => setF({ ...f, spots: e.target.value })} /></label>
        </div>
        <label style={{ fontSize: 12.5, fontWeight: 700, display: 'block', marginTop: 10 }}>Role (optional)<input className="st-in" value={f.role} onChange={e => setF({ ...f, role: e.target.value })} /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button className="st-btn" onClick={onClose}>Cancel</button><button className="st-btn on" disabled={busy || !f.schedule} onClick={go}>Add interval</button></div>
      </>}
    </Modal>
  )
}
