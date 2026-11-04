import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { hasPerm, usingNewPermissions } from '../lib/permissions'

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
// ET wall-clock helpers for the "interval ending soon" reminder.
function toMin(t) { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
function etMinutesNow() { const n = etNow(); return n.getHours() * 60 + n.getMinutes() }
function fmtClock(t) { const [h, m] = String(t).slice(0, 5).split(':').map(Number); const ap = h < 12 ? 'AM' : 'PM'; const hh = ((h + 11) % 12) + 1; return `${hh}:${String(m).padStart(2, '0')} ${ap}` }
const REMIND_BEFORE_MIN = 30   // start reminding this many minutes before interval end
const REMIND_GRACE_MIN = 60    // keep reminding this many minutes after, until submitted

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
  const [emailMsg, setEmailMsg] = useState('')
  const [emailing, setEmailing] = useState(false)
  const [historyKey, setHistoryKey] = useState(0)   // bump to refresh the history list after a save
  // interval-end reminder: latest end time (today) among the person's claimed shifts
  const [myEnd, setMyEnd] = useState(null)   // { min, time } or null
  const [, setTick] = useState(0)            // re-render each minute to update the window

  // Load today's claimed interval end once (static for the day).
  useEffect(() => {
    if (!userId) return
    let active = true
    ;(async () => {
      const today = isoDate(etNow())
      const [claimsRes, blocksRes] = await Promise.all([
        supabase.from('shift_claims').select('shift_block_id').eq('profile_id', userId),
        supabase.from('shift_blocks').select('id, block_date, end_time').eq('block_date', today),
      ])
      if (!active) return
      const mine = new Set((claimsRes.data || []).map(c => c.shift_block_id))
      const ends = (blocksRes.data || []).filter(b => mine.has(b.id) && b.end_time).map(b => ({ min: toMin(b.end_time), time: b.end_time }))
      setMyEnd(ends.length ? ends.sort((a, b) => b.min - a.min)[0] : null)
    })()
    return () => { active = false }
  }, [userId])

  // Tick every minute so the reminder appears/clears without a reload.
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 60000); return () => clearInterval(id) }, [])

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
      setHistoryKey(k => k + 1)
      emailCopy(date)   // send the submitter a copy for their records
    } catch (e) { setErr(e.message || 'Could not save.') }
    finally { setSaving(false) }
  }

  async function emailCopy(reportDate) {
    setEmailing(true); setEmailMsg('Emailing a copy…')
    try {
      const { data, error } = await supabase.functions.invoke('send-eod-copy', { body: { report_date: reportDate } })
      if (error || data?.error) { setEmailMsg('Couldn’t email a copy — ' + (data?.error || error?.message || 'try again')); return }
      setEmailMsg('📧 A copy was emailed to you.')
    } catch (e) { setEmailMsg('Couldn’t email a copy — ' + (e.message || 'try again')) }
    finally { setEmailing(false) }
  }

  const isTodayView = date === isoDate(etNow())
  const untilEnd = myEnd ? myEnd.min - etMinutesNow() : null
  const showReminder = isTodayView && !submittedAt && untilEnd != null && untilEnd <= REMIND_BEFORE_MIN && untilEnd >= -REMIND_GRACE_MIN

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>My end-of-day report</h3>
        <input type="date" value={date} max={isoDate(etNow())} onChange={e => setDate(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--canvas)', color: 'var(--ink)' }} />
      </div>
      <p className="page-sub" style={{ marginBottom: 14 }}>Your tracked tasks fill in automatically. Add anything the tracker can't capture, then save.</p>

      {showReminder && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--accent-bg, rgba(0,119,182,.08))', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
          <span style={{ fontSize: 18 }}>⏰</span>
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            {untilEnd >= 0
              ? <>Your interval ends at <b>{fmtClock(myEnd.time)}</b> (in {untilEnd} min) — take a minute to fill out your end-of-day report before you sign off.</>
              : <>Your interval ended at <b>{fmtClock(myEnd.time)}</b> — don't forget to submit your end-of-day report.</>}
          </div>
        </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : submittedAt ? 'Update report' : 'Submit report'}</button>
            {submittedAt && <button className="btn btn-ghost" onClick={() => emailCopy(date)} disabled={emailing}>{emailing ? 'Emailing…' : '📧 Email me a copy'}</button>}
            {submittedAt && <span className="page-sub" style={{ fontSize: 12 }}>Last saved {new Date(submittedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
            {emailMsg && <span className="page-sub" style={{ fontSize: 12, color: emailMsg.startsWith('📧') ? '#16A34A' : 'var(--ink-soft)' }}>{emailMsg}</span>}
          </div>
        </>
      )}
      <MyPastReports userId={userId} refreshKey={historyKey} onEmail={emailCopy} emailing={emailing} />
    </div>
  )
}

// ---------- personal history: look back at past submitted EODs ----------
function MyPastReports({ userId, refreshKey, onEmail, emailing }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!userId || !open) return
    let active = true
    ;(async () => {
      setErr('')
      const { data, error } = await supabase.from('daily_reports').select('*')
        .eq('profile_id', userId).order('report_date', { ascending: false }).limit(120)
      if (!active) return
      if (error) { setErr(error.message || 'Could not load your past reports.'); setRows([]) }
      else setRows(data || [])
    })()
    return () => { active = false }
  }, [userId, open, refreshKey])

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 18, paddingTop: 14 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 0, cursor: 'pointer', fontFamily: 'inherit', padding: 0, color: 'var(--ink)' }}>
        <span style={{ fontSize: 12, opacity: .6, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>My past reports</span>
        <span className="page-sub" style={{ fontSize: 12 }}>— look back at any EOD you've submitted</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {err && <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
          {rows === null ? <p className="page-sub" style={{ fontSize: 12.5 }}>Loading…</p>
            : rows.length === 0 ? <p className="page-sub" style={{ fontSize: 12.5 }}>No submitted reports yet.</p>
              : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {rows.map(r => {
                    const isOpen = openId === r.id
                    const tracked = { rows: Array.isArray(r.tasks_snapshot) ? r.tasks_snapshot : [], total: r.total_minutes || 0 }
                    return (
                      <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                        <button onClick={() => setOpenId(isOpen ? null : r.id)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--canvas)', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{prettyDate(r.report_date)}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-soft)' }}>{hrs(r.total_minutes || 0)}h</span>
                          <span style={{ fontSize: 11, opacity: .6, transform: isOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
                        </button>
                        {isOpen && (
                          <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
                            <TrackedTable tracked={tracked} />
                            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                              <ReportBlock title="Additional work / comments" body={r.additional_work} />
                              <ReportBlock title="Agent / trend concerns" body={r.concerns} />
                              <ReportBlock title="Notes" body={r.notes} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                              <button className="btn btn-ghost" onClick={() => onEmail(r.report_date)} disabled={emailing}>📧 Email me a copy</button>
                              <span className="page-sub" style={{ fontSize: 11 }}>Submitted {r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
        </div>
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
      // Bound to that day's blocks (was an unfiltered full-table pull that silently
      // truncated at 1000 rows as shift_claims grew).
      const { data: claims } = blockIds.size
        ? await supabase.from('shift_claims').select('shift_block_id, profile_id').in('shift_block_id', [...blockIds])
        : { data: [] }
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
  // Admins file their own report too — previously they only saw the roll-up
  // and had no way to enter their commentary at all.
  if (isAdmin) return (
    <div style={{ marginTop: 22 }}>
      <PersonalEod userId={user?.id} />
      <div style={{ marginTop: 18 }}><AdminEod /></div>
    </div>
  )
  if (role !== 'agent') return <div style={{ marginTop: 22 }}><PersonalEod userId={user?.id} /></div>
  return null
}


// ============================================================
// 📝 END OF DAY REPORT page (Team Updates, 2026-11-04) — replaces the Dashboard card.
//   ✍️ My report         → write today's report + your past reports (anyone who submits)
//   📥 Submitted reports → By day (who filed / who didn't) or All reports (date range,
//                          person, search). Admins, or "View the team's end-of-day reports".
// ============================================================
export function EodPage() {
  const { user, appRole, isAdmin } = useAuth()
  const role = String(appRole || '').toLowerCase()
  const newPerms = usingNewPermissions()
  const canSubmit = newPerms ? hasPerm('team.eod_submit') : (isAdmin || role !== 'agent')
  const canViewTeam = newPerms ? hasPerm('team.eod_view') : !!isAdmin
  const tabs = [...(canSubmit ? [['mine', '✍️ My report']] : []), ...(canViewTeam ? [['team', '📥 Submitted reports']] : [])]
  const [tab, setTab] = useState(tabs[0]?.[0] || 'mine')
  const [view, setView] = useState('list')
  if (!tabs.length) return <p className="page-sub">End-of-day reports aren't part of your role.</p>
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 className="page-title">📝 End of Day Report</h1>
      <p className="page-sub">Your tracked time fills in automatically — add what the tracker can't show, then submit. You'll get a copy by email.</p>
      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', margin: '6px 0 16px' }}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ border: 0, background: 'transparent', padding: '10px 14px', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
              color: tab === k ? 'var(--accent)' : 'var(--ink-soft)', borderBottom: '2px solid ' + (tab === k ? 'var(--accent)' : 'transparent'), marginBottom: -1 }}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'mine' && canSubmit && <PersonalEod userId={user?.id} />}
      {tab === 'team' && canViewTeam && (
        <div>
          <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            {[['list', 'All reports'], ['day', 'By day (who filed)']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} style={{ border: 0, padding: '7px 14px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                background: view === k ? 'var(--accent)' : 'var(--surface)', color: view === k ? 'var(--accent-ink)' : 'var(--ink)' }}>{l}</button>
            ))}
          </div>
          {view === 'list' ? <SubmittedReports /> : <AdminEod />}
        </div>
      )}
    </div>
  )
}

// All submitted reports: date range + person + search; each opens to the full report.
function SubmittedReports() {
  const today = isoDate(etNow())
  const back = (n) => { const d = etNow(); d.setDate(d.getDate() - n); return isoDate(d) }
  const [from, setFrom] = useState(back(13))
  const [to, setTo] = useState(today)
  const [person, setPerson] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [people, setPeople] = useState({})
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setRows(null); setErr('')
    ;(async () => {
      const { data, error } = await supabase.from('daily_reports').select('*').gte('report_date', from).lte('report_date', to)
        .not('submitted_at', 'is', null).order('report_date', { ascending: false }).order('submitted_at', { ascending: false }).limit(1000)
      if (!alive) return
      if (error) { setErr(error.message); setRows([]); return }
      const ids = [...new Set((data || []).map(r => r.profile_id))]
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        if (alive) setPeople(prev => ({ ...prev, ...Object.fromEntries((ps || []).map(p => [p.id, p.full_name])) }))
      }
      setRows(data || [])
    })()
    return () => { alive = false }
  }, [from, to])

  const tl = q.trim().toLowerCase()
  const shown = (rows || []).filter(r => (!person || r.profile_id === person)
    && (!tl || [r.additional_work, r.concerns, r.notes, people[r.profile_id], ...(r.tasks_snapshot || []).map(t => `${t.task} ${t.client || ''}`)].join(' ').toLowerCase().includes(tl)))
  const byDate = shown.reduce((m, r) => { (m[r.report_date] = m[r.report_date] || []).push(r); return m }, {})
  const inp = { border: '1px solid var(--line)', borderRadius: 8, padding: '6px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }
  const names = Object.entries(people).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''))

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600 }}>From <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 600 }}>To <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} style={inp} /></label>
        <select value={person} onChange={e => setPerson(e.target.value)} style={inp} aria-label="Person">
          <option value="">Everyone</option>{names.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reports, tasks, clients…" style={{ ...inp, flex: '1 1 200px' }} aria-label="Search reports" />
        <span className="page-sub" style={{ fontSize: 12.5 }}>{rows ? `${shown.length} report${shown.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      {err ? <div style={{ background: '#FEF2F2', color: '#B91C1C', borderRadius: 8, padding: '8px 11px', fontSize: 12.5 }}>{err}</div>
        : !rows ? <p className="page-sub">Loading…</p>
        : shown.length === 0 ? <p className="page-sub">No reports were submitted for these dates{person || tl ? ' that match your filters' : ''}.</p>
        : Object.entries(byDate).map(([d, list]) => (
          <div key={d} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-soft)', margin: '6px 0' }}>{prettyDate(d)} · {list.length}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map(r => {
                const open = openId === r.id
                return (
                  <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                    <button onClick={() => setOpenId(open ? null : r.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--canvas)', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink)' }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{people[r.profile_id] || 'Someone'}</span>
                      <span className="page-sub" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{(r.additional_work || r.notes || r.concerns || '').slice(0, 90)}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{hrs(r.total_minutes || 0)}h tracked</span>
                      {r.concerns && <span title="Has agent / trend concerns" style={{ fontSize: 11, fontWeight: 700, color: '#B45309', background: '#FFFBEB', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>⚠ Concerns</span>}
                      <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{new Date(r.submitted_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}</span>
                      <span style={{ fontSize: 11, opacity: .6, transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
                    </button>
                    {open && (
                      <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
                        <TrackedTable tracked={{ rows: r.tasks_snapshot || [], total: r.total_minutes || 0 }} />
                        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                          <ReportBlock title="Additional work / comments" body={r.additional_work} />
                          <ReportBlock title="Agent / trend concerns" body={r.concerns} />
                          <ReportBlock title="Notes" body={r.notes} />
                          <div className="page-sub" style={{ fontSize: 11 }}>Submitted {new Date(r.submitted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET{r.updated_at && r.updated_at !== r.submitted_at ? ' · edited later' : ''}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
    </div>
  )
}
