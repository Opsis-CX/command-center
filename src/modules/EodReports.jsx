import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// END-OF-DAY REPORTS
// One role-aware Dashboard card:
//   • Admins            → team roll-up for a chosen day (admin-only view).
//   • Non-agents        → their own report: tracked tasks auto-fill, they add
//                         the anecdotal comments, then save.
//   • Agents            → nothing (feature is for non-agents).
//
// Source of truth for "what they did" is `time_entries` — if it wasn't tracked,
// it isn't here. Comments live in a new `daily_reports` table (see setup SQL).
// ============================================================

// ET day helpers (mirrors Dashboard/Schedule so a "day" means an ET calendar day).
function etNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })) }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function etDateOf(iso) { return isoDate(new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York' }))) }
const hrs = (min) => (min / 60).toFixed(2)
const prettyDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

// Pull a person's tracked time for one ET date, grouped by task.
async function fetchTracked(userId, date) {
  // Query a padded UTC window, then keep only rows whose ET date matches.
  const start = new Date(date + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 1)
  const end = new Date(date + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 2)
  const { data: te, error } = await supabase.from('time_entries').select('*')
    .eq('user_id', userId).not('duration_minutes', 'is', null)
    .gte('started_at', start.toISOString()).lt('started_at', end.toISOString())
  if (error) throw error
  const entries = (te || []).filter(e => e.started_at && etDateOf(e.started_at) === date)
  return groupEntries(entries)
}

// Shared grouping: entries (already date-filtered) -> [{task, client, minutes, notes[]}], total.
async function groupEntries(entries, taskCache, clientCache) {
  const taskIds = [...new Set(entries.map(e => e.task_id).filter(Boolean))]
  let tById = taskCache || {}
  let cById = clientCache || {}
  if (!taskCache && taskIds.length) {
    const { data: tks } = await supabase.from('tasks').select('id, name, client_id').in('id', taskIds)
    tById = Object.fromEntries((tks || []).map(t => [t.id, t]))
    const clientIds = [...new Set((tks || []).map(t => t.client_id).filter(Boolean))]
    if (clientIds.length) {
      const { data: cls } = await supabase.from('clients').select('id, name').in('id', clientIds)
      cById = Object.fromEntries((cls || []).map(c => [c.id, c]))
    }
  }
  const byTask = {}
  for (const e of entries) {
    const k = e.task_id || '__none__'
    if (!byTask[k]) {
      const t = tById[e.task_id]
      byTask[k] = { task: t?.name || '(untitled task)', client: t?.client_id ? (cById[t.client_id]?.name || null) : null, minutes: 0, notes: [] }
    }
    byTask[k].minutes += e.duration_minutes || 0
    if (e.note) byTask[k].notes.push(e.note)
  }
  const rows = Object.values(byTask).sort((a, b) => b.minutes - a.minutes)
  const total = rows.reduce((s, r) => s + r.minutes, 0)
  return { rows, total }
}

// Friendly note when the table hasn't been created yet.
function tableMissing(err) {
  const m = (err?.message || '') + (err?.details || '')
  return /daily_reports/.test(m) && /(does not exist|relation|schema cache|find the table)/i.test(m)
}
function SetupNote() {
  return (
    <div className="page-sub" style={{ fontSize: 12.5, background: 'var(--accent-bg, rgba(0,119,182,.06))', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}>
      The <code>daily_reports</code> table isn't set up yet. Run the setup SQL, then reload.
    </div>
  )
}

const label = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', margin: '0 0 5px', display: 'block' }
const area = { width: '100%', minHeight: 58, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)', resize: 'vertical' }

// Read-only tracked-tasks table used by both views.
function TrackedTable({ tracked }) {
  if (!tracked || tracked.rows.length === 0) return <div className="page-sub" style={{ fontSize: 12.5 }}>No time tracked for this day.</div>
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: 'var(--canvas)' }}>
            <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--line)', fontWeight: 700 }}>Task</th>
            <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--line)', fontWeight: 700 }}>Client</th>
            <th style={{ textAlign: 'right', padding: '6px 10px', borderBottom: '1px solid var(--line)', fontWeight: 700, whiteSpace: 'nowrap' }}>Hours</th>
          </tr>
        </thead>
        <tbody>
          {tracked.rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-soft)' }}>
                {r.task}
                {r.notes.length > 0 && <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{r.notes.join(' · ')}</div>}
              </td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-soft)', color: 'var(--ink-soft)' }}>{r.client || '—'}</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-soft)', textAlign: 'right', fontWeight: 600 }}>{hrs(r.minutes)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} style={{ padding: '7px 10px', fontWeight: 700 }}>Total tracked</td>
            <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{hrs(tracked.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------- personal editor (non-agents) ----------
function PersonalEod({ userId }) {
  const [date, setDate] = useState(isoDate(etNow()))
  const [tracked, setTracked] = useState(null)
  const [c, setC] = useState({ additional_work: '', concerns: '', notes: '' })
  const [submittedAt, setSubmittedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true); setErr(''); setMissing(false)
    try {
      const t = await fetchTracked(userId, date)
      setTracked(t)
      const { data: rep, error } = await supabase.from('daily_reports').select('*')
        .eq('profile_id', userId).eq('report_date', date).maybeSingle()
      if (error) { if (tableMissing(error)) { setMissing(true) } else throw error }
      setC({ additional_work: rep?.additional_work || '', concerns: rep?.concerns || '', notes: rep?.notes || '' })
      setSubmittedAt(rep?.submitted_at || null)
    } catch (e) { setErr(e.message || 'Could not load your report.') }
    finally { setLoading(false) }
  }, [userId, date])
  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setErr('')
    try {
      const { error } = await supabase.from('daily_reports').upsert({
        profile_id: userId, report_date: date,
        tasks_snapshot: tracked?.rows || [], total_minutes: tracked?.total || 0,
        additional_work: c.additional_work.trim() || null,
        concerns: c.concerns.trim() || null,
        notes: c.notes.trim() || null,
        submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,report_date' })
      if (error) { if (tableMissing(error)) setMissing(true); throw error }
      setSubmittedAt(new Date().toISOString())
    } catch (e) { setErr(e.message || 'Could not save.') }
    finally { setSaving(false) }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>My end-of-day report</h3>
        <input type="date" value={date} max={isoDate(etNow())} onChange={e => setDate(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)' }} />
      </div>
      <p className="page-sub" style={{ marginBottom: 14 }}>Your tracked tasks fill in automatically. Add anything the tracker can't capture, then save.</p>

      {missing ? <SetupNote /> : loading ? <p className="page-sub">Loading…</p> : (
        <>
          <div style={{ marginBottom: 16 }}>
            <span style={label}>Tracked tasks — {prettyDate(date)}</span>
            <TrackedTable tracked={tracked} />
          </div>
          <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
            <div><span style={label}>Additional work / comments</span>
              <textarea style={area} value={c.additional_work} onChange={e => setC({ ...c, additional_work: e.target.value })} placeholder="Anything you did that isn't captured above…" /></div>
            <div><span style={label}>Agent / trend concerns</span>
              <textarea style={area} value={c.concerns} onChange={e => setC({ ...c, concerns: e.target.value })} placeholder="N/A if none" /></div>
            <div><span style={label}>Notes</span>
              <textarea style={area} value={c.notes} onChange={e => setC({ ...c, notes: e.target.value })} placeholder="Live listens, training, anything else…" /></div>
          </div>
          {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : submittedAt ? 'Update report' : 'Submit report'}</button>
            {submittedAt && <span className="page-sub" style={{ fontSize: 12 }}>Last saved {new Date(submittedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- admin roll-up ----------
function AdminEod() {
  const [date, setDate] = useState(isoDate(etNow()))
  const [rows, setRows] = useState([])
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setMissing(false)
    try {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, role, is_active').eq('is_active', true)
      const nonAgents = (profs || []).filter(p => String(p.role || '').toLowerCase() !== 'agent')
      const ids = nonAgents.map(p => p.id)

      // tracked time for all non-agents on this date (one query), then group per person
      const start = new Date(date + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 1)
      const end = new Date(date + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 2)
      let entries = []
      if (ids.length) {
        const { data: te } = await supabase.from('time_entries').select('*')
          .in('user_id', ids).not('duration_minutes', 'is', null)
          .gte('started_at', start.toISOString()).lt('started_at', end.toISOString())
        entries = (te || []).filter(e => e.started_at && etDateOf(e.started_at) === date)
      }
      // resolve task + client labels once for all entries
      const taskIds = [...new Set(entries.map(e => e.task_id).filter(Boolean))]
      let tById = {}, cById = {}
      if (taskIds.length) {
        const { data: tks } = await supabase.from('tasks').select('id, name, client_id').in('id', taskIds)
        tById = Object.fromEntries((tks || []).map(t => [t.id, t]))
        const clientIds = [...new Set((tks || []).map(t => t.client_id).filter(Boolean))]
        if (clientIds.length) {
          const { data: cls } = await supabase.from('clients').select('id, name').in('id', clientIds)
          cById = Object.fromEntries((cls || []).map(c => [c.id, c]))
        }
      }
      const byPerson = {}
      for (const id of ids) byPerson[id] = []
      for (const e of entries) (byPerson[e.user_id] = byPerson[e.user_id] || []).push(e)

      // reports for the date
      let reports = []
      const repRes = await supabase.from('daily_reports').select('*').eq('report_date', date)
      if (repRes.error) { if (tableMissing(repRes.error)) setMissing(true); else throw repRes.error }
      reports = repRes.data || []
      const repByPerson = Object.fromEntries(reports.map(r => [r.profile_id, r]))

      // who was scheduled that day
      const { data: blocks } = await supabase.from('shift_blocks').select('id, block_date').eq('block_date', date)
      const blockIds = new Set((blocks || []).map(b => b.id))
      const { data: claims } = await supabase.from('shift_claims').select('shift_block_id, profile_id')
      const scheduled = new Set((claims || []).filter(c => blockIds.has(c.shift_block_id)).map(c => c.profile_id))

      const built = []
      for (const p of nonAgents) {
        const tracked = await groupEntries(byPerson[p.id] || [], tById, cById)
        const rep = repByPerson[p.id] || null
        const isScheduled = scheduled.has(p.id)
        // show anyone who was scheduled, tracked time, or filed a report
        if (!isScheduled && tracked.total === 0 && !rep) continue
        built.push({ id: p.id, name: p.full_name, role: p.role, scheduled: isScheduled, tracked, rep })
      }
      built.sort((a, b) => (b.scheduled - a.scheduled) || (b.tracked.total - a.tracked.total))
      setRows(built)
    } catch (e) { setErr(e.message || 'Could not load reports.') }
    finally { setLoading(false) }
  }, [date])
  useEffect(() => { load() }, [load])

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>End-of-day reports</h3>
        <input type="date" value={date} max={isoDate(etNow())} onChange={e => setDate(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)' }} />
      </div>
      <p className="page-sub" style={{ marginBottom: 14 }}>{prettyDate(date)} · non-agents who were on, tracked time, or filed a report. Tracked hours come straight from the time tracker.</p>

      {missing ? <SetupNote /> : loading ? <p className="page-sub">Loading…</p> : err ? (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5 }}>{err}</div>
      ) : rows.length === 0 ? <p className="page-sub">Nobody to show for this day.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(r => {
            const open = openId === r.id
            return (
              <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                <button onClick={() => setOpenId(open ? null : r.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--canvas)', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.name}</span>
                  {r.scheduled && <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 10, padding: '1px 7px' }}>Scheduled</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-soft)' }}>{hrs(r.tracked.total)}h tracked</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: r.rep ? '#16A34A' : 'var(--ink-soft)' }}>{r.rep ? 'Report ✓' : 'No report'}</span>
                  <span style={{ fontSize: 11, opacity: .6, transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
                </button>
                {open && (
                  <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
                    <TrackedTable tracked={r.tracked} />
                    {r.rep ? (
                      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                        <ReportBlock title="Additional work / comments" body={r.rep.additional_work} />
                        <ReportBlock title="Agent / trend concerns" body={r.rep.concerns} />
                        <ReportBlock title="Notes" body={r.rep.notes} />
                        <div className="page-sub" style={{ fontSize: 11 }}>Submitted {r.rep.submitted_at ? new Date(r.rep.submitted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</div>
                      </div>
                    ) : <div className="page-sub" style={{ fontSize: 12.5, marginTop: 10 }}>No written report submitted — tracked time shown above is all that was logged.</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ReportBlock({ title, body }) {
  return (
    <div>
      <span style={label}>{title}</span>
      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: body ? 'var(--ink)' : 'var(--ink-soft)' }}>{body || '—'}</div>
    </div>
  )
}

// ---------- role-aware entry point ----------
export default function EodReportCard() {
  const { user, appRole, isAdmin } = useAuth()
  const role = String(appRole || '').toLowerCase()
  if (isAdmin) return <div style={{ marginTop: 22 }}><AdminEod /></div>
  if (role && role !== 'agent') return <div style={{ marginTop: 22 }}><PersonalEod userId={user?.id} /></div>
  return null
}
