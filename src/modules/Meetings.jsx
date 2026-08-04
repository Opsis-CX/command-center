import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// Meetings — in-app notetaker (Phase 1). Upload audio or paste a transcript;
// the `meeting-process` edge function transcribes (Deepgram) + summarizes
// (Claude) into summary / decisions / topics / action items, auto-tags the
// client by attendee email domain, and can push action items into Tasks.
// Virtual-meeting auto-capture (Recall.ai) + client billing report come next.
// ============================================================

const STATUS_STYLE = {
  new: { bg: '#eef2ff', fg: '#3730a3', label: 'New' },
  transcribing: { bg: '#fef9c3', fg: '#854d0e', label: 'Transcribing…' },
  ready: { bg: '#e0f2fe', fg: '#075985', label: 'Ready' },
  summarizing: { bg: '#fef9c3', fg: '#854d0e', label: 'Summarizing…' },
  done: { bg: '#dcfce7', fg: '#166534', label: 'Done' },
  error: { bg: '#fee2e2', fg: '#b91c1c', label: 'Error' },
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.new
  return <span className="badge" style={{ background: s.bg, color: s.fg, fontWeight: 700, fontSize: 12 }}>{s.label}</span>
}

export default function Meetings() {
  const { user, isClientPortal } = useAuth()
  const [meetings, setMeetings] = useState(null)
  const [clients, setClients] = useState([])
  const [selId, setSelId] = useState(null)
  const [detail, setDetail] = useState(null)      // { meeting, items }
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState('')            // '' | 'processing' | 'tasks' | 'saving'
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const [{ data: m }, { data: c }] = await Promise.all([
      supabase.from('meetings').select('id, title, meeting_date, client_name, status, source, created_at').order('meeting_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').order('name'),
    ])
    setMeetings(m || [])
    setClients(c || [])
  }, [])
  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return }
    const [{ data: meeting }, { data: items }] = await Promise.all([
      supabase.from('meetings').select('*').eq('id', id).single(),
      supabase.from('meeting_action_items').select('*').eq('meeting_id', id).order('created_at'),
    ])
    setDetail({ meeting, items: items || [] })
  }, [])
  useEffect(() => { loadDetail(selId) }, [selId, loadDetail])

  if (isClientPortal) return null

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Meetings</h1>
          <p className="page-sub">Upload a recording or paste a transcript — get a summary, decisions, and action items you can turn into tasks. Auto-tagged to the client by attendee email.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowNew(true); setErr('') }}>+ New meeting</button>
      </div>

      {err && <div className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--failed, #b42318)' }}>{err}</div>}

      {showNew && (
        <NewMeeting
          clients={clients} userId={user?.id} busy={busy} setBusy={setBusy}
          onCancel={() => setShowNew(false)}
          onDone={async (id) => { setShowNew(false); await load(); setSelId(id) }}
          onError={setErr}
        />
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* list */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', flex: '1 1 320px', minWidth: 300, maxWidth: 460 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
            All meetings {meetings ? `(${meetings.length})` : ''}
          </div>
          <div style={{ maxHeight: 620, overflow: 'auto' }}>
            {meetings == null && <div style={{ padding: 16 }} className="page-sub">Loading…</div>}
            {meetings && meetings.length === 0 && <div style={{ padding: 16 }} className="page-sub">No meetings yet. Click “New meeting” to add one.</div>}
            {(meetings || []).map(m => (
              <button key={m.id} onClick={() => setSelId(m.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--line)', background: selId === m.id ? 'var(--canvas, #f1f5f9)' : 'transparent', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{m.title || '(untitled)'}</span>
                  <StatusBadge status={m.status} />
                </div>
                <div className="page-sub" style={{ fontSize: 12, marginTop: 2 }}>
                  {fmtDate(m.meeting_date)}{m.client_name ? ` · ${m.client_name}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* detail */}
        <div style={{ flex: '2 1 460px', minWidth: 320 }}>
          {!selId && <div className="card page-sub" style={{ padding: 24 }}>Select a meeting to see its summary and action items.</div>}
          {selId && !detail && <div className="card" style={{ padding: 24 }}><span className="page-sub">Loading…</span></div>}
          {selId && detail && (
            <MeetingDetail
              detail={detail} busy={busy} setBusy={setBusy}
              onRefresh={async () => { await loadDetail(selId); await load() }}
              onError={setErr}
              onDeleted={async () => { setSelId(null); setDetail(null); await load() }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- New meeting form ----------
function NewMeeting({ clients, userId, busy, setBusy, onCancel, onDone, onError }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO())
  const [participants, setParticipants] = useState('')
  const [clientId, setClientId] = useState('')
  const [mode, setMode] = useState('transcript')   // 'transcript' | 'audio'
  const [transcript, setTranscript] = useState('')
  const [file, setFile] = useState(null)

  const inp = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg, #fff)', width: '100%' }
  const lbl = { fontSize: 12, fontWeight: 600, color: 'var(--muted, #64748b)', marginBottom: 4, display: 'block' }

  async function submit() {
    onError('')
    if (mode === 'transcript' && !transcript.trim()) { onError('Paste a transcript, or switch to Upload audio.'); return }
    if (mode === 'audio' && !file) { onError('Choose an audio file, or switch to Paste transcript.'); return }
    setBusy('saving')
    try {
      const parts = participants.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
      const row = {
        title: title.trim() || '(untitled meeting)',
        meeting_date: date || null,
        participants: parts,
        client_id: clientId || null,
        source: mode === 'audio' ? 'upload' : 'manual',
        status: mode === 'audio' ? 'new' : 'ready',
        created_by: userId || null,
        transcript: mode === 'transcript' ? transcript.trim() : null,
      }
      const { data: ins, error: insErr } = await supabase.from('meetings').insert(row).select('id').single()
      if (insErr) throw insErr
      const id = ins.id

      if (mode === 'audio' && file) {
        const safe = file.name.replace(/[^\w.\-]+/g, '_')
        const path = `${id}/${Date.now()}_${safe}`
        const { error: upErr } = await supabase.storage.from('meeting-media').upload(path, file, { contentType: file.type || undefined, upsert: false })
        if (upErr) throw new Error('Upload failed: ' + upErr.message)
        await supabase.from('meetings').update({ recording_path: path }).eq('id', id)
      }

      setBusy('processing')
      const body = { meeting_id: id }
      if (mode === 'transcript') body.transcript = transcript.trim()
      const { error: fnErr } = await supabase.functions.invoke('meeting-process', { body })
      if (fnErr) throw new Error('Processing failed: ' + (fnErr.message || fnErr))
      await onDone(id)
    } catch (e) {
      onError(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  const working = busy === 'saving' || busy === 'processing'
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong>New meeting</strong>
        <button className="btn btn-ghost" onClick={onCancel} disabled={working}>Cancel</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div><label style={lbl}>Title</label><input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Weekly sync — Acme" /></div>
        <div><label style={lbl}>Date</label><input type="date" style={inp} value={date} max={todayISO()} onChange={e => setDate(e.target.value)} /></div>
        <div><label style={lbl}>Client (optional — auto-detected from emails)</label>
          <select style={inp} value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">Auto-detect</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label style={lbl}>Participants (comma or line separated; include emails to auto-tag client)</label>
          <input style={inp} value={participants} onChange={e => setParticipants(e.target.value)} placeholder="Jane Doe, ops@acme.com" /></div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button className="btn" onClick={() => setMode('transcript')} style={{ border: '1px solid var(--line)', background: mode === 'transcript' ? 'var(--accent, #2563eb)' : 'transparent', color: mode === 'transcript' ? '#fff' : 'inherit', borderRadius: 8 }}>Paste transcript</button>
        <button className="btn" onClick={() => setMode('audio')} style={{ border: '1px solid var(--line)', background: mode === 'audio' ? 'var(--accent, #2563eb)' : 'transparent', color: mode === 'audio' ? '#fff' : 'inherit', borderRadius: 8 }}>Upload audio</button>
      </div>

      {mode === 'transcript'
        ? <textarea style={{ ...inp, minHeight: 160, fontFamily: 'inherit' }} value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Paste the meeting transcript here…" />
        : <div>
            <input type="file" accept="audio/*,video/*" onChange={e => setFile(e.target.files?.[0] || null)} />
            <p className="page-sub" style={{ fontSize: 12, marginTop: 6 }}>Audio is transcribed with Deepgram. Large files can take up to a minute or two.</p>
          </div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={submit} disabled={working}>
          {busy === 'saving' ? 'Saving…' : busy === 'processing' ? 'Processing…' : 'Save & summarize'}
        </button>
      </div>
    </div>
  )
}

// ---------- Meeting detail ----------
function MeetingDetail({ detail, busy, setBusy, onRefresh, onError, onDeleted }) {
  const { meeting, items } = detail
  const [showTranscript, setShowTranscript] = useState(false)
  const pendingTasks = useMemo(() => items.filter(i => !i.task_id).length, [items])

  async function reprocess() {
    onError(''); setBusy('processing')
    try {
      const { error } = await supabase.functions.invoke('meeting-process', { body: { meeting_id: meeting.id } })
      if (error) throw new Error(error.message || error)
      await onRefresh()
    } catch (e) { onError(String(e.message || e)) } finally { setBusy('') }
  }
  async function createTasks() {
    onError(''); setBusy('tasks')
    try {
      const { error } = await supabase.functions.invoke('meeting-process', { body: { meeting_id: meeting.id, only_tasks: true } })
      if (error) throw new Error(error.message || error)
      await onRefresh()
    } catch (e) { onError(String(e.message || e)) } finally { setBusy('') }
  }
  async function toggleDone(item) {
    await supabase.from('meeting_action_items').update({ done: !item.done }).eq('id', item.id)
    await onRefresh()
  }
  async function del() {
    if (!confirm('Delete this meeting and its action items? Tasks already created will remain.')) return
    await supabase.from('meetings').delete().eq('id', meeting.id)
    await onDeleted()
  }

  const chip = { display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: 'var(--canvas, #f1f5f9)', border: '1px solid var(--line)', fontSize: 12, marginRight: 6, marginBottom: 6 }
  const working = busy === 'processing' || busy === 'tasks'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>{meeting.title || '(untitled)'}</h2>
            <div className="page-sub" style={{ fontSize: 13, marginTop: 4 }}>
              {fmtDate(meeting.meeting_date)}{meeting.client_name ? ` · ${meeting.client_name}` : ''}
              {(meeting.participants || []).length ? ` · ${meeting.participants.length} participant${meeting.participants.length === 1 ? '' : 's'}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge status={meeting.status} />
            <button className="btn btn-ghost" onClick={reprocess} disabled={working} title="Re-run summary + action items">
              {busy === 'processing' ? 'Working…' : '↻ Re-summarize'}
            </button>
            <button className="btn btn-ghost" onClick={del} disabled={working} style={{ color: 'var(--failed, #b42318)' }}>Delete</button>
          </div>
        </div>
        {meeting.status === 'error' && meeting.error && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--failed-bg, #fef2f2)', color: 'var(--failed, #b42318)', fontSize: 13 }}>{meeting.error}</div>
        )}
      </div>

      {meeting.summary && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Summary</div>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{meeting.summary}</p>
          {(meeting.topics || []).length > 0 && (
            <div style={{ marginTop: 12 }}>
              {meeting.topics.map((t, i) => <span key={i} style={chip}>{t}</span>)}
            </div>
          )}
        </div>
      )}

      {(meeting.decisions || []).length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Decisions</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            {meeting.decisions.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700 }}>Action items {items.length ? `(${items.length})` : ''}</div>
          {pendingTasks > 0 && (
            <button className="btn btn-primary" onClick={createTasks} disabled={working}>
              {busy === 'tasks' ? 'Creating…' : `Create ${pendingTasks} task${pendingTasks === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        {items.length === 0 && <div className="page-sub">No action items{meeting.status === 'done' ? ' were found in this meeting.' : ' yet.'}</div>}
        {items.map(item => (
          <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <input type="checkbox" checked={!!item.done} onChange={() => toggleDone(item)} style={{ marginTop: 3 }} />
            <div style={{ flex: 1 }}>
              <div style={{ textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</div>
              <div className="page-sub" style={{ fontSize: 12, marginTop: 2 }}>
                {item.owner_name ? `Owner: ${item.owner_name}` : 'Owner: unassigned'}
                {item.due_date ? ` · Due ${fmtDate(item.due_date)}` : ''}
                {item.task_id ? ' · ✓ Task created' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {meeting.transcript && (
        <div className="card" style={{ padding: 16 }}>
          <button className="btn btn-ghost" onClick={() => setShowTranscript(s => !s)} style={{ padding: 0 }}>
            {showTranscript ? '▾ Hide transcript' : '▸ Show transcript'}
          </button>
          {showTranscript && (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, marginTop: 10, maxHeight: 420, overflow: 'auto' }}>{meeting.transcript}</pre>
          )}
        </div>
      )}
    </div>
  )
}
