import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { formatDuration } from './projectHelpers'

// ============================================================
// TIME TRACKING — drops into the task detail panel.
// One running timer per user at a time; start/stop + manual log.
// ============================================================

function elapsed(startedAt) {
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const h = String(Math.floor(diff / 3600)).padStart(2, '0')
  const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0')
  const s = String(diff % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function TimeTracking({ taskId }) {
  const { timeEntries, setTimeEntries, profiles, userId, tasks, projects, logActivity } = useProjectsData()
  const [manualOpen, setManualOpen] = useState(false)
  const [mHours, setMHours] = useState('')
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10))
  const [mNote, setMNote] = useState('')
  const [, forceTick] = useState(0)
  const tickRef = useRef(null)

  const entries = timeEntries.filter(e => e.task_id === taskId && e.duration_minutes)
  const totalMin = entries.reduce((s, e) => s + e.duration_minutes, 0)
  const running = timeEntries.find(e => e.task_id === taskId && e.user_id === userId && e.started_at && !e.ended_at)

  // live clock tick while a timer runs
  useEffect(() => {
    if (running) {
      tickRef.current = setInterval(() => forceTick(t => t + 1), 1000)
      return () => clearInterval(tickRef.current)
    }
  }, [running])

  async function startTimer() {
    // stop any other running timer for this user first (one at a time)
    const other = timeEntries.find(e => e.user_id === userId && e.started_at && !e.ended_at)
    if (other) await finalize(other)
    const { data, error } = await supabase.from('time_entries').insert({
      task_id: taskId, user_id: userId, started_at: new Date().toISOString(), is_manual: false,
    }).select().single()
    if (error) return
    setTimeEntries(prev => [data, ...prev])
  }

  async function finalize(entry) {
    const endedAt = new Date()
    const mins = Math.max(1, Math.round((endedAt - new Date(entry.started_at)) / 60000))
    await supabase.from('time_entries').update({ ended_at: endedAt.toISOString(), duration_minutes: mins }).eq('id', entry.id)
    setTimeEntries(prev => prev.map(e => e.id === entry.id ? { ...e, ended_at: endedAt.toISOString(), duration_minutes: mins } : e))
    const t = tasks.find(x => x.id === entry.task_id)
    if (t) {
      const proj = projects.find(p => p.id === t.project_id)
      logActivity('logged_time', entry.task_id, t.name, t.project_id, proj?.name, `${formatDuration(mins)}h logged`)
    }
  }

  async function stopTimer() {
    if (running) await finalize(running)
  }

  async function saveManual() {
    const hours = parseFloat(mHours)
    if (!hours || hours <= 0) { window.alert('Enter a valid number of hours'); return }
    if (!mDate) { window.alert('Pick a date'); return }
    const mins = Math.round(hours * 60)
    const startedAt = new Date(mDate + 'T09:00:00').toISOString()
    const { data, error } = await supabase.from('time_entries').insert({
      task_id: taskId, user_id: userId, started_at: startedAt, ended_at: startedAt,
      duration_minutes: mins, note: mNote.trim() || null, is_manual: true,
    }).select().single()
    if (error) { window.alert('Error saving time entry'); return }
    setTimeEntries(prev => [data, ...prev])
    setManualOpen(false); setMHours(''); setMNote('')
    const t = tasks.find(x => x.id === taskId)
    if (t) {
      const proj = projects.find(p => p.id === t.project_id)
      logActivity('logged_time', taskId, t.name, t.project_id, proj?.name, `${formatDuration(mins)}h logged manually`)
    }
  }

  async function deleteEntry(id) {
    if (!window.confirm('Delete this time entry?')) return
    await supabase.from('time_entries').delete().eq('id', id)
    setTimeEntries(prev => prev.filter(e => e.id !== id))
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginBottom: 7 }}>Time tracked</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatDuration(totalMin)}h</div>
          <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>total logged</div>
        </div>
        {running ? (
          <button onClick={stopTimer}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20, border: '1px solid var(--failed)', background: 'var(--failed-bg)', color: 'var(--failed)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--failed)' }} />
            {elapsed(running.started_at)} · Stop
          </button>
        ) : (
          <button onClick={startTimer}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-soft)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink-soft)' }} />
            Start timer
          </button>
        )}
      </div>

      {/* entries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {entries.slice(0, 10).map(e => {
          const person = profiles.find(p => p.id === e.user_id)
          const canDelete = e.user_id === userId
          const dateLabel = e.started_at ? new Date(e.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'var(--bg-soft, #f7f7f5)', borderRadius: 8, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{person?.full_name || 'Unknown'}</span>
              {e.note && <span style={{ color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.note}</span>}
              <span style={{ color: 'var(--ink-soft)', marginLeft: 'auto' }}>{dateLabel}</span>
              <span style={{ fontWeight: 600, color: 'var(--ink-soft)' }}>{formatDuration(e.duration_minutes)}h</span>
              {canDelete && <button onClick={() => deleteEntry(e.id)} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 12 }}>✕</button>}
            </div>
          )
        })}
        {entries.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No time logged yet.</div>}
      </div>

      {!manualOpen ? (
        <button onClick={() => setManualOpen(true)} className="btn btn-ghost" style={{ fontSize: 12 }}>+ Log time manually</button>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Hours</label>
              <input type="number" min="0" step="0.25" value={mHours} onChange={e => setMHours(e.target.value)} placeholder="1.5" style={inp} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Date</label>
              <input type="date" value={mDate} onChange={e => setMDate(e.target.value)} style={inp} />
            </div>
          </div>
          <input type="text" value={mNote} onChange={e => setMNote(e.target.value)} placeholder="What did you work on? (optional)" style={inp} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setManualOpen(false)} className="btn btn-ghost" style={{ fontSize: 12 }}>Cancel</button>
            <button onClick={saveManual} className="btn btn-primary" style={{ fontSize: 12 }}>Save entry</button>
          </div>
        </div>
      )}
    </div>
  )
}

const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: '100%', background: 'var(--surface)', color: 'var(--ink)' }
