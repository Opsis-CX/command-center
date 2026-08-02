import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// TIME (admin) — one place to find and adjust anyone's tracked
// time across all tasks. Filter by person, date range, and text;
// sort "longest first" to surface runaway timers; stop / edit /
// delete inline. Admin-only (RLS also enforces this server-side).
// ============================================================

const hrs = (mins) => (Math.round(((mins || 0) / 60) * 100) / 100).toFixed(2)
const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function liveClock(startedAt) {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(diff / 3600))}:${p(Math.floor((diff % 3600) / 60))}:${p(diff % 60)}`
}
const LONG_MIN = 8 * 60 // entries at/over 8h are flagged as likely runaways

export default function TimeAdmin() {
  const { isAdmin } = useAuth()

  const today = new Date()
  const start = new Date(); start.setDate(today.getDate() - 14)
  const [fromDate, setFromDate] = useState(ymd(start))
  const [toDate, setToDate] = useState(ymd(today))
  const [personId, setPersonId] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent') // 'recent' | 'longest'

  const [people, setPeople] = useState([])
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [, tick] = useState(0)
  const tickRef = useRef(null)

  const [editId, setEditId] = useState(null)
  const [eHours, setEHours] = useState('')
  const [eDate, setEDate] = useState('')
  const [eNote, setENote] = useState('')

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name')
      .then(({ data }) => setPeople(data || []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const fromIso = new Date(fromDate + 'T00:00:00').toISOString()
    const toObj = new Date(toDate + 'T00:00:00'); toObj.setDate(toObj.getDate() + 1)
    let q = supabase.from('time_entries').select('*').gte('started_at', fromIso).lt('started_at', toObj.toISOString())
    if (personId !== 'all') q = q.eq('user_id', personId)
    const { data: te, error } = await q.order('started_at', { ascending: false })
    if (error) { setErr(error.message); setRows([]); setLoading(false); return }
    const entries = te || []
    const uids = [...new Set(entries.map(e => e.user_id).filter(Boolean))]
    const tids = [...new Set(entries.map(e => e.task_id).filter(Boolean))]
    const [profRes, taskRes] = await Promise.all([
      uids.length ? supabase.from('profiles').select('id, full_name').in('id', uids) : Promise.resolve({ data: [] }),
      tids.length ? supabase.from('tasks').select('id, name, project_id').in('id', tids) : Promise.resolve({ data: [] }),
    ])
    const tasks = taskRes.data || []
    const pids = [...new Set(tasks.map(t => t.project_id).filter(Boolean))]
    const projRes = pids.length ? await supabase.from('projects').select('id, name').in('id', pids) : { data: [] }
    const pMap = Object.fromEntries((profRes.data || []).map(p => [p.id, p.full_name]))
    const tMap = Object.fromEntries(tasks.map(t => [t.id, t]))
    const prMap = Object.fromEntries((projRes.data || []).map(p => [p.id, p.name]))
    const enriched = entries.map(e => {
      const t = tMap[e.task_id]
      const running = !!e.started_at && !e.ended_at
      return {
        ...e,
        personName: pMap[e.user_id] || 'Unknown',
        taskName: t?.name || '(no task)',
        projectName: t ? (prMap[t.project_id] || '') : '',
        running,
        mins: e.duration_minutes != null ? e.duration_minutes : (running ? Math.floor((Date.now() - new Date(e.started_at).getTime()) / 60000) : 0),
      }
    })
    setRows(enriched); setLoading(false)
  }, [fromDate, toDate, personId])

  useEffect(() => { load() }, [load])

  const anyRunning = (rows || []).some(r => r.running)
  useEffect(() => {
    if (anyRunning) {
      tickRef.current = setInterval(() => tick(t => t + 1), 1000)
      return () => clearInterval(tickRef.current)
    }
  }, [anyRunning])

  const filtered = useMemo(() => {
    let list = rows || []
    const qq = query.trim().toLowerCase()
    if (qq) list = list.filter(r => `${r.taskName} ${r.projectName} ${r.personName} ${r.note || ''}`.toLowerCase().includes(qq))
    return [...list].sort((a, b) => sort === 'longest'
      ? (b.mins - a.mins)
      : (new Date(b.started_at) - new Date(a.started_at)))
  }, [rows, query, sort])

  const totalMin = filtered.reduce((s, r) => s + (r.duration_minutes || 0), 0)

  async function stopEntry(r) {
    const endedAt = new Date()
    const mins = Math.max(1, Math.round((endedAt - new Date(r.started_at)) / 60000))
    const { error } = await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_minutes: mins }).eq('id', r.id)
    if (error) { window.alert('Could not stop: ' + error.message); return }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, ended_at: endedAt.toISOString(), duration_minutes: mins, running: false, mins } : x))
  }

  function beginEdit(r) {
    setEditId(r.id)
    setEHours(String(Math.round((r.mins / 60) * 100) / 100))
    setEDate((r.started_at || new Date().toISOString()).slice(0, 10))
    setENote(r.note || '')
  }

  async function saveEdit(r) {
    const h = parseFloat(eHours)
    if (!h || h <= 0) { window.alert('Enter a valid number of hours'); return }
    if (!eDate) { window.alert('Pick a date'); return }
    const mins = Math.round(h * 60)
    const startedAt = new Date(eDate + 'T09:00:00').toISOString()
    const endedAt = new Date(new Date(startedAt).getTime() + mins * 60000).toISOString()
    const patch = { duration_minutes: mins, started_at: startedAt, ended_at: endedAt, note: eNote.trim() || null }
    const { error } = await supabase.from('time_entries').update(patch).eq('id', r.id)
    if (error) { window.alert('Could not save: ' + error.message); return }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, ...patch, running: false, mins } : x))
    setEditId(null)
  }

  async function deleteEntry(r) {
    if (!window.confirm(`Delete ${r.personName}'s ${hrs(r.mins)}h on "${r.taskName}"? This can't be undone.`)) return
    const { error } = await supabase.from('time_entries').delete().eq('id', r.id)
    if (error) { window.alert('Could not delete: ' + error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  if (!isAdmin) return <div className="page"><h1 className="page-title">Time</h1><p className="page-sub">This page is for admins.</p></div>

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1 className="page-title">Time</h1>
      <p className="page-sub">Find and adjust anyone's tracked time. Sort by “Longest first” to catch timers left running.</p>

      {/* filters */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="Person">
          <select value={personId} onChange={e => setPersonId(e.target.value)} style={inp}>
            <option value="all">Everyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field label="From"><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inp} /></Field>
        <Field label="To"><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inp} /></Field>
        <Field label="Search task / project / note">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. reporting" style={{ ...inp, minWidth: 200 }} />
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={e => setSort(e.target.value)} style={inp}>
            <option value="recent">Most recent</option>
            <option value="longest">Longest first</option>
          </select>
        </Field>
        <button className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={load}>↻ Refresh</button>
      </div>

      {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', marginBottom: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}>
        <span><strong style={{ color: 'var(--ink)' }}>{filtered.length}</strong> entries</span>
        <span><strong style={{ color: 'var(--ink)' }}>{hrs(totalMin)}h</strong> total (completed)</span>
      </div>

      {loading ? <p className="page-sub">Loading…</p>
        : filtered.length === 0 ? <div className="card" style={{ textAlign: 'center', padding: 28 }}><p className="page-sub" style={{ margin: 0 }}>No time entries match these filters.</p></div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(r => {
                const flagged = r.running || r.mins >= LONG_MIN
                if (editId === r.id) {
                  return (
                    <div key={r.id} className="card" style={{ border: '1px solid var(--accent)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{r.personName} · {r.taskName}{r.projectName ? ` · ${r.projectName}` : ''}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                        <Field label="Hours"><input type="number" min="0" step="0.25" value={eHours} onChange={e => setEHours(e.target.value)} style={inp} /></Field>
                        <Field label="Date"><input type="date" value={eDate} onChange={e => setEDate(e.target.value)} style={inp} /></Field>
                      </div>
                      <input type="text" value={eNote} onChange={e => setENote(e.target.value)} placeholder="Note (optional)" style={{ ...inp, width: '100%', marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditId(null)}>Cancel</button>
                        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => saveEdit(r)}>Save</button>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderLeft: flagged ? '3px solid var(--failed)' : '3px solid transparent' }}>
                    <div style={{ minWidth: 130, fontWeight: 600, fontSize: 13 }}>{r.personName}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.taskName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.projectName || '—'}{r.note ? ` · ${r.note}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 96 }}>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{r.started_at ? new Date(r.started_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</div>
                      {r.running
                        ? <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--failed)' }}>▶ {liveClock(r.started_at)}</div>
                        : <div style={{ fontSize: 13, fontWeight: 700, color: flagged ? 'var(--failed)' : 'var(--ink)' }}>{hrs(r.mins)}h</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {r.running && <button title="Stop timer" onClick={() => stopEntry(r)} style={{ background: 'var(--failed)', border: 0, color: '#fff', borderRadius: 14, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Stop</button>}
                      <button title="Edit" onClick={() => beginEdit(r)} style={iconBtn}>✎</button>
                      <button title="Delete" onClick={() => deleteEntry(r)} style={iconBtn}>✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-soft)' }}>{label}</span>
      {children}
    </label>
  )
}

const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }
const iconBtn = { background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: '2px 4px' }
