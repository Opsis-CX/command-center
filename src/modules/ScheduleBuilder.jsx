import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// SCHEDULE BUILDER — Stage 2 (admin)
// Create/edit schedules, manage intervals (blocks), CSV import,
// and set the audience (who can see each schedule).
// UI says "interval"; DB tables stay shift_blocks/shift_claims.
// ============================================================

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function nextWednesdayISO() {
  const now = new Date(); const day = now.getDay()
  const daysUntilWed = (3 - day + 7) % 7 || 7
  const d = new Date(now); d.setDate(now.getDate() + daysUntilWed)
  return d.toISOString().slice(0, 10)
}

export default function ScheduleBuilder() {
  const [schedules, setSchedules] = useState([])
  const [blocks, setBlocks] = useState([])
  const [claims, setClaims] = useState([])
  const [callTypes, setCallTypes] = useState([])
  const [profiles, setProfiles] = useState([])
  const [audience, setAudience] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [editSchedule, setEditSchedule] = useState(null) // schedule obj or {} for new
  const [editBlock, setEditBlock] = useState(null)         // {scheduleId, block?}
  const [importFor, setImportFor] = useState(null)         // scheduleId

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [schRes, blkRes, clmRes, ctRes, profRes, audRes, cliRes] = await Promise.all([
        supabase.from('schedules').select('*').order('week_start_date', { ascending: false }),
        supabase.from('shift_blocks').select('*').order('block_date').order('start_time'),
        supabase.from('shift_claims').select('*'),
        supabase.from('call_types').select('*').order('name'),
        supabase.from('profiles').select('id, full_name, email, is_active').eq('is_active', true).order('full_name'),
        supabase.from('schedule_audience').select('*'),
        supabase.from('clients').select('*').order('name'),
      ])
      if (schRes.error) throw schRes.error
      setSchedules(schRes.data || [])
      setBlocks(blkRes.data || [])
      setClaims(clmRes.data || [])
      setCallTypes(ctRes.data || [])
      setProfiles(profRes.data || [])
      setAudience(audRes.data || [])
      setClients(cliRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 2800) }

  async function deleteSchedule(s) {
    if (!window.confirm(`Delete "${s.title}" and all its intervals and claims? This cannot be undone.`)) return
    const { error } = await supabase.from('schedules').delete().eq('id', s.id)
    if (error) { flash('Error: ' + error.message); return }
    flash('Schedule deleted'); load()
  }

  async function deleteBlock(b) {
    if (!window.confirm('Delete this interval and any claims on it?')) return
    const { error } = await supabase.from('shift_blocks').delete().eq('id', b.id)
    if (error) { flash('Error: ' + error.message); return }
    flash('Interval deleted'); load()
  }

  if (loading) return <p className="page-sub">Loading…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Schedule builder</h1>
          <p className="page-sub">Create schedules, add intervals, and choose who can see them.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditSchedule({})}>+ New schedule</button>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--ink)', color: '#fff', padding: '11px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>{toast}</div>}

      {schedules.length === 0 ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No schedules yet. Click <b>+ New schedule</b> to create one.</div></div>
      ) : schedules.map(s => {
        const sBlocks = blocks.filter(b => b.schedule_id === s.id).sort((a, b) => (a.block_date + a.start_time).localeCompare(b.block_date + b.start_time))
        const totalSpots = sBlocks.reduce((sum, b) => sum + b.total_spots, 0)
        const totalClaimed = sBlocks.reduce((sum, b) => sum + claims.filter(c => c.shift_block_id === b.id).length, 0)
        const callTypeName = callTypes.find(ct => ct.id === s.call_type_id)?.name || 'No position'
        const clientName = clients.find(cl => cl.id === s.client_id)?.name || 'No client'
        const audienceCount = audience.filter(a => a.schedule_id === s.id).length
        return (
          <div className="card" key={s.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {s.title}{' '}
                  <span className="badge" style={{ background: s.status === 'published' ? 'var(--passed-bg)' : s.status === 'archived' ? 'var(--failed-bg)' : 'var(--needed-bg)', color: s.status === 'published' ? 'var(--passed)' : s.status === 'archived' ? 'var(--failed)' : 'var(--needed)' }}>{s.status}</span>
                </div>
                <div className="page-sub" style={{ marginTop: 3 }}>
                  {clientName} · {callTypeName} · Week of {new Date(s.week_start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {sBlocks.length} interval{sBlocks.length !== 1 ? 's' : ''} · {totalClaimed}/{totalSpots} claimed · {audienceCount} in audience
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" onClick={() => setEditBlock({ scheduleId: s.id })}>+ Add interval</button>
                <button className="btn btn-ghost" onClick={() => setImportFor(s.id)}>Import CSV</button>
                <button className="btn btn-ghost" onClick={() => setEditSchedule(s)}>Edit</button>
                <button className="btn btn-ghost" style={{ color: 'var(--failed)' }} onClick={() => deleteSchedule(s)}>Delete</button>
              </div>
            </div>
            {sBlocks.length ? sBlocks.map(b => {
              const cl = claims.filter(c => c.shift_block_id === b.id)
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--canvas)', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                  <div style={{ flex: 1 }}>
                    <b>{formatTime(b.start_time)}–{formatTime(b.end_time)}</b>
                    {b.role ? ` · ${b.role}` : ''}
                    {' · '}{new Date(b.block_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' · '}{cl.length}/{b.total_spots} claimed
                  </div>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setEditBlock({ scheduleId: s.id, block: b })}>Edit</button>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px', color: 'var(--failed)' }} onClick={() => deleteBlock(b)}>Delete</button>
                </div>
              )
            }) : <div className="page-sub" style={{ padding: '6px 0' }}>No intervals yet.</div>}
          </div>
        )
      })}

      {editSchedule && <ScheduleModal schedule={editSchedule} callTypes={callTypes} clients={clients} profiles={profiles} audience={audience}
        onClose={() => setEditSchedule(null)} onSaved={() => { setEditSchedule(null); load(); flash('Schedule saved') }} />}
      {editBlock && <BlockModal editBlock={editBlock} schedules={schedules}
        onClose={() => setEditBlock(null)} onSaved={() => { setEditBlock(null); load(); flash('Interval saved') }} />}
      {importFor && <ImportModal scheduleId={importFor}
        onClose={() => setImportFor(null)} onDone={(n) => { setImportFor(null); load(); flash(`Imported ${n} interval${n !== 1 ? 's' : ''}`) }} />}
    </div>
  )
}

// ---------- SCHEDULE CREATE/EDIT ----------
function ScheduleModal({ schedule, callTypes, clients, profiles, audience, onClose, onSaved }) {
  const isNew = !schedule.id
  const [title, setTitle] = useState(schedule.title || '')
  const [weekStart, setWeekStart] = useState(schedule.week_start_date || nextWednesdayISO())
  const [status, setStatus] = useState(schedule.status || 'draft')
  const [callTypeId, setCallTypeId] = useState(schedule.call_type_id || (callTypes.filter(c => c.active !== false)[0]?.id || ''))
  const [clientId, setClientId] = useState(schedule.client_id || '')
  const [picked, setPicked] = useState(() => new Set(audience.filter(a => a.schedule_id === schedule.id).map(a => a.profile_id)))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function togglePerson(id) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function save() {
    if (!title.trim()) { setErr('Add a title.'); return }
    if (!callTypeId) { setErr('Pick a call type.'); return }
    setSaving(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const payload = { title: title.trim(), week_start_date: weekStart, status, call_type_id: callTypeId, client_id: clientId || null }
      let scheduleId = schedule.id
      if (isNew) {
        payload.created_by = user?.id ?? null
        const { data, error } = await supabase.from('schedules').insert(payload).select().single()
        if (error) throw error
        scheduleId = data.id
      } else {
        const { error } = await supabase.from('schedules').update(payload).eq('id', schedule.id)
        if (error) throw error
      }
      // Sync audience: remove all then insert picked (simple + reliable)
      await supabase.from('schedule_audience').delete().eq('schedule_id', scheduleId)
      if (picked.size) {
        const rows = [...picked].map(pid => ({ schedule_id: scheduleId, profile_id: pid }))
        const { error: ae } = await supabase.from('schedule_audience').insert(rows)
        if (ae) throw ae
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const activeCallTypes = callTypes.filter(c => c.active !== false)

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{isNew ? 'New schedule' : 'Edit schedule'}</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>Set the details, then choose who can see and claim it.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="field"><label>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Week of July 7" autoFocus /></div>
        <div className="field"><label>Week start date</label>
          <input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} /></div>
        <div className="field"><label>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft">Draft (not visible to agents)</option>
            <option value="published">Published (visible per audience + release time)</option>
            <option value="archived">Archived</option>
          </select></div>
        <div className="field"><label>Client</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">— Select client —</option>
            {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Position</label>
          <select value={callTypeId} onChange={e => setCallTypeId(e.target.value)}>
            {activeCallTypes.length ? activeCallTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)
              : <option value="">No positions — create one first</option>}
          </select>
          <div className="hint">Only people certified for this position (where a certification requires it) can claim.</div>
        </div>

        <div className="field">
          <label>Audience <span style={{ fontWeight: 400 }}>(who can see this schedule)</span></label>
          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, maxHeight: 220, overflow: 'auto' }}>
            {profiles.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', background: picked.has(p.id) ? 'var(--accent-bg)' : 'transparent' }}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePerson(p.id)} />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.full_name}</span>
              </label>
            ))}
          </div>
          <div className="hint">{picked.size} selected. Only these people (plus admins) will see it.</div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- INTERVAL (BLOCK) CREATE/EDIT ----------
function BlockModal({ editBlock, schedules, onClose, onSaved }) {
  const b = editBlock.block
  const isNew = !b
  const sched = schedules.find(s => s.id === editBlock.scheduleId)
  const [date, setDate] = useState(b?.block_date || sched?.week_start_date || '')
  const [role, setRole] = useState(b?.role || '')
  const [start, setStart] = useState(b?.start_time?.slice(0, 5) || '')
  const [end, setEnd] = useState(b?.end_time?.slice(0, 5) || '')
  const [spots, setSpots] = useState(b?.total_spots || 1)
  const [notes, setNotes] = useState(b?.notes || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!date || !start || !end || !spots || spots < 1) { setErr('Fill in date, times, and spots.'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        schedule_id: editBlock.scheduleId, block_date: date, start_time: start, end_time: end,
        role: role.trim() || null, total_spots: parseInt(spots, 10), notes: notes.trim() || null,
      }
      if (isNew) {
        const { error } = await supabase.from('shift_blocks').insert(payload); if (error) throw error
      } else {
        const { error } = await supabase.from('shift_blocks').update(payload).eq('id', b.id); if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal">
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{isNew ? 'New interval' : 'Edit interval'}</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>{sched?.title}</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="field"><label>Role <span style={{ fontWeight: 400 }}>(optional)</span></label><input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. CSR, QA" /></div>
          <div className="field"><label>Start time</label><input type="time" value={start} onChange={e => setStart(e.target.value)} /></div>
          <div className="field"><label>End time</label><input type="time" value={end} onChange={e => setEnd(e.target.value)} /></div>
        </div>
        <div className="field"><label>Total spots available</label><input type="number" min="1" value={spots} onChange={e => setSpots(e.target.value)} style={{ width: 120 }} /></div>
        <div className="field"><label>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything agents should know" /></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save interval'}</button>
        </div>
      </div>
    </div>
  )
}

// ---------- CSV IMPORT ----------
function normalizeDate(raw) {
  if (!raw) return null
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}
function normalizeTime(raw) {
  if (!raw) return null; raw = raw.trim()
  let m = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (m) { const h = +m[1], min = +m[2]; if (h >= 0 && h < 24 && min >= 0 && min < 60) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`; return null }
  m = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/)
  if (m) { let h = +m[1]; const min = +m[2]; const p = m[3].toUpperCase(); if (h < 1 || h > 12 || min < 0 || min > 59) return null; if (p === 'AM') h = h === 12 ? 0 : h; else h = h === 12 ? 12 : h + 12; return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` }
  return null
}
function parseCSVLine(line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = '' } else cur += ch }
  }
  out.push(cur); return out.map(s => s.trim())
}

function ImportModal({ scheduleId, onClose, onDone }) {
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)

  function onFile(e) {
    const file = e.target.files[0]; if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => parse(ev.target.result)
    reader.readAsText(file)
  }
  function parse(text) {
    const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '')
    if (lines.length < 2) { setErrors(['File looks empty — needs a header row plus data.']); setRows([]); return }
    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase())
    const di = header.findIndex(h => h.includes('date'))
    const si = header.findIndex(h => h.includes('start'))
    const ei = header.findIndex(h => h.includes('end'))
    const spi = header.findIndex(h => h.includes('spot'))
    const ri = header.findIndex(h => h.includes('role'))
    const ni = header.findIndex(h => h.includes('note'))
    if (di < 0 || si < 0 || ei < 0 || spi < 0) { setErrors(['Missing required columns: Date, Start Time, End Time, Spots.']); setRows([]); return }
    const good = []; const bad = []
    for (let i = 1; i < lines.length; i++) {
      const c = parseCSVLine(lines[i]); const rn = i + 1
      const date = normalizeDate(c[di] || ''), start = normalizeTime(c[si] || ''), end = normalizeTime(c[ei] || ''), spots = parseInt(c[spi], 10)
      const re = []
      if (!date) re.push(`row ${rn}: bad date "${c[di]}"`)
      if (!start) re.push(`row ${rn}: bad start "${c[si]}"`)
      if (!end) re.push(`row ${rn}: bad end "${c[ei]}"`)
      if (!spots || spots < 1) re.push(`row ${rn}: spots must be ≥ 1`)
      if (re.length) bad.push(...re)
      else good.push({ date, start, end, spots, role: (ri > -1 ? c[ri] : '') || null, notes: (ni > -1 ? c[ni] : '') || null })
    }
    setRows(good); setErrors(bad)
  }
  function template() {
    const csv = 'Date,Start Time,End Time,Spots,Role,Notes\r\n2026-07-08,09:00,12:00,2,CSR,Morning queue'
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'interval-import-template.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }
  async function doImport() {
    if (!rows.length) return
    setSaving(true)
    const payload = rows.map(r => ({ schedule_id: scheduleId, block_date: r.date, start_time: r.start, end_time: r.end, total_spots: r.spots, role: r.role, notes: r.notes }))
    const { error } = await supabase.from('shift_blocks').insert(payload)
    setSaving(false)
    if (error) { setErrors([`Import failed: ${error.message}`]); return }
    onDone(rows.length)
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 560 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Import intervals from CSV</h3>
        <p className="page-sub" style={{ marginBottom: 16 }}>Columns: Date, Start Time, End Time, Spots, Role, Notes. Date YYYY-MM-DD; time HH:MM or H:MM AM/PM.</p>
        <button className="btn btn-ghost" style={{ marginBottom: 14 }} onClick={template}>↓ Download template</button>
        <div className="field">
          <label>Choose CSV file</label>
          <input type="file" accept=".csv" onChange={onFile} />
          {fileName && <div className="hint">{fileName}</div>}
        </div>
        {errors.length > 0 && <div style={{ background: 'var(--failed-bg)', color: 'var(--failed)', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 12, maxHeight: 120, overflow: 'auto' }}>{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}
        {rows.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{rows.length} interval{rows.length !== 1 ? 's' : ''} ready ({rows.reduce((s, r) => s + r.spots, 0)} spots)</div>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--line-soft)' }}>
                  <span style={{ width: 90 }}>{r.date}</span><span>{formatTime(r.start)}–{formatTime(r.end)}</span>
                  <span>· {r.spots} spot{r.spots !== 1 ? 's' : ''}</span>{r.role && <span>· {r.role}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={doImport} disabled={saving || !rows.length}>{saving ? 'Importing…' : `Import ${rows.length || ''} interval${rows.length !== 1 ? 's' : ''}`}</button>
        </div>
      </div>
    </div>
  )
}
