import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// ============================================================
// CLIENTS — company-wide client list, shared by the Projects
// module (tasks.client_id) and Scheduling (schedules.client_id).
// View-only for some roles; edit controls gated to clients.edit.
//
// Weekly hours cap (clients.max_weekly_hours, NULL = no cap):
// each client can carry a max billable hours per Mon–Sun week.
// Delivered hours = Five9 billable time for dialer clients +
// ended claimed shift hours for back-office clients + time
// entries (task timers / auto-billed meetings). Alerts fire at
// 50 / 80 / 90 / 100% (server-side, hourly cron
// `client-hour-caps-hourly` → check_client_hour_caps()), plus a
// forward warning when remaining scheduled shifts would take the
// week over. Numbers here come from get_client_hours_week().
// ============================================================

const THRESHOLDS = [50, 80, 90, 100]

function capColor(pct) {
  if (pct == null) return 'var(--ink-soft)'
  if (pct >= 100) return 'var(--failed)'
  if (pct >= 90) return '#ea580c'
  if (pct >= 80) return '#d97706'
  return '#16a34a'
}

function fmtHrs(n) {
  const v = Number(n || 0)
  return (Math.round(v * 10) / 10).toFixed(1)
}

function fmtDay(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Clients() {
  const { appRole } = useAuth()
  const canEdit = can(appRole, 'clients.edit')
  const [clients, setClients] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [scheduleCounts, setScheduleCounts] = useState({})
  const [hours, setHours] = useState({})       // client_id -> weekly hours row
  const [week, setWeek] = useState(null)       // { week_start, week_end }
  const [hoursOk, setHoursOk] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [capEditId, setCapEditId] = useState(null)
  const [capDraft, setCapDraft] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [cliRes, taskRes, schRes, hrsRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      fetchAllRows(() => supabase.from('tasks').select('client_id').is('deleted_at', null).order('id')),
      supabase.from('schedules').select('client_id'),
      supabase.rpc('get_client_hours_week'),
    ])
    setClients(cliRes.data || [])
    // count references
    const tc = {}, sc = {}
    ;(taskRes.data || []).forEach(t => { if (t.client_id) tc[t.client_id] = (tc[t.client_id] || 0) + 1 })
    ;(schRes.data || []).forEach(s => { if (s.client_id) sc[s.client_id] = (sc[s.client_id] || 0) + 1 })
    setTaskCounts(tc); setScheduleCounts(sc)
    // weekly hours (admin / reporting staff only — RPC returns {error:'forbidden'} otherwise)
    const h = hrsRes.data
    if (h && !h.error && Array.isArray(h.clients)) {
      const map = {}
      h.clients.forEach(r => { map[r.client_id] = r })
      setHours(map)
      setWeek({ week_start: h.week_start, week_end: h.week_end })
      setHoursOk(true)
    } else {
      setHoursOk(false)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 2500) }

  async function addClient() {
    const name = newName.trim()
    if (!name) return
    if (clients.some(c => c.name.toLowerCase() === name.toLowerCase())) { flash('That client already exists'); return }
    const { data, error } = await supabase.from('clients').insert({ name }).select().single()
    if (error) { flash('Error adding client'); return }
    setClients(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName(''); flash('Client added')
  }

  async function saveRename(id) {
    const name = editName.trim()
    if (!name) return
    const { error } = await supabase.from('clients').update({ name }).eq('id', id)
    if (error) { flash('Error renaming'); return }
    setClients(prev => prev.map(c => c.id === id ? { ...c, name } : c).sort((a, b) => a.name.localeCompare(b.name)))
    setEditingId(null); flash('Renamed')
  }

  async function saveCap(id) {
    const raw = capDraft.trim()
    let cap = null
    if (raw !== '') {
      cap = Number(raw)
      if (!Number.isFinite(cap) || cap <= 0) { flash('Enter a positive number of hours, or clear it to remove the cap'); return }
      cap = Math.round(cap * 100) / 100
    }
    const { error } = await supabase.from('clients').update({ max_weekly_hours: cap }).eq('id', id)
    if (error) { flash('Error saving cap — admin only'); return }
    setClients(prev => prev.map(c => c.id === id ? { ...c, max_weekly_hours: cap } : c))
    // recompute this row's percentages locally so the meter updates immediately
    setHours(prev => {
      const row = prev[id]
      if (!row) return prev
      const pct = cap ? Math.round((row.delivered_hours / cap) * 1000) / 10 : null
      const ppct = cap ? Math.round((row.projected_hours / cap) * 1000) / 10 : null
      return { ...prev, [id]: { ...row, cap, pct, projected_pct: ppct } }
    })
    setCapEditId(null)
    flash(cap ? `Cap set to ${fmtHrs(cap)} hrs/week` : 'Cap removed')
  }

  async function deleteClient(c) {
    const tCount = taskCounts[c.id] || 0
    const sCount = scheduleCounts[c.id] || 0
    let warn = `Delete "${c.name}"?`
    if (tCount || sCount) {
      const parts = []
      if (tCount) parts.push(`${tCount} task${tCount !== 1 ? 's' : ''}`)
      if (sCount) parts.push(`${sCount} schedule${sCount !== 1 ? 's' : ''}`)
      warn = `Delete "${c.name}"? It's referenced by ${parts.join(' and ')} — those will be left without a client (not deleted).`
    }
    if (!window.confirm(warn)) return
    const { error } = await supabase.from('clients').delete().eq('id', c.id)
    if (error) { flash('Error deleting'); return }
    setClients(prev => prev.filter(x => x.id !== c.id)); flash('Client deleted')
  }

  // clients currently in trouble this week — drives the banner
  const flagged = useMemo(() => {
    if (!hoursOk) return []
    return clients
      .map(c => hours[c.id])
      .filter(r => r && r.cap > 0 && ((r.pct != null && r.pct >= 80) || (r.projected_pct != null && r.projected_pct >= 100)))
      .sort((a, b) => (b.pct || 0) - (a.pct || 0))
  }, [clients, hours, hoursOk])

  if (loading) return <p className="page-sub">Loading clients…</p>

  const weekLabel = week ? `${fmtDay(week.week_start)} – ${fmtDay(week.week_end)}` : ''

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Clients</h1>
        <p className="page-sub">One shared client list, used across Projects and Scheduling.</p>
      </div>

      {msg && <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--accent)', display: 'inline-block' }}>{msg}</div>}

      {/* cap banner */}
      {hoursOk && flagged.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 20, maxWidth: 860, borderLeft: `3px solid ${capColor(flagged[0].pct)}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Weekly hours cap — attention ({weekLabel})
          </div>
          {flagged.map(r => {
            const over = r.pct >= 100
            const pace = r.pct < 100 && r.projected_pct >= 100
            return (
              <div key={r.client_id} style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: capColor(over ? 100 : r.pct) }}>{r.name}</span>
                {' — '}
                {over
                  ? `over cap: ${fmtHrs(r.delivered_hours)} of ${fmtHrs(r.cap)} hrs (${r.pct}%)`
                  : `${fmtHrs(r.delivered_hours)} of ${fmtHrs(r.cap)} hrs used (${r.pct}%)`}
                {pace && (
                  <span style={{ color: '#d97706' }}>
                    {' · on pace for '}{fmtHrs(r.projected_hours)} hrs ({r.projected_pct}%) with {fmtHrs(r.scheduled_remaining)} still scheduled
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* add */}
      {canEdit && (
      <div className="card" style={{ padding: 16, marginBottom: 20, maxWidth: 480 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 6 }}>Add a new client</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addClient() }}
            placeholder="e.g. Acme Corp"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
          <button onClick={addClient} className="btn btn-primary">Add</button>
        </div>
      </div>
      )}

      {/* list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 860 }}>
        {hoursOk && (
          <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-soft)', background: 'var(--bg-soft, transparent)' }}>
            Weekly hours · {weekLabel} · alerts at {THRESHOLDS.join('% / ')}%
          </div>
        )}
        {clients.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>No clients yet.</div>
        ) : clients.map(c => {
          const tCount = taskCounts[c.id] || 0
          const sCount = scheduleCounts[c.id] || 0
          const h = hours[c.id]
          const cap = c.max_weekly_hours
          const pct = h && cap > 0 ? h.pct : null
          const ppct = h && cap > 0 ? h.projected_pct : null
          const barPct = pct == null ? 0 : Math.min(pct, 100)
          const projBarPct = ppct == null ? 0 : Math.min(ppct, 100)
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: '1px solid var(--line-soft)' }}>
              {editingId === c.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveRename(c.id); if (e.key === 'Escape') setEditingId(null) }}
                    autoFocus
                    style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }} />
                  <button onClick={() => saveRename(c.id)} className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>Save</button>
                  <button onClick={() => setEditingId(null)} className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>Cancel</button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 1 }}>
                      {tCount} task{tCount !== 1 ? 's' : ''} · {sCount} schedule{sCount !== 1 ? 's' : ''}
                    </div>

                    {/* weekly hours meter */}
                    {hoursOk && h && (
                      <div style={{ marginTop: 7, maxWidth: 380 }}>
                        {cap > 0 ? (
                          <>
                            <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--line-soft)', overflow: 'hidden' }}>
                              {/* projected (ghost) */}
                              <div style={{ position: 'absolute', inset: 0, width: `${projBarPct}%`, background: capColor(ppct), opacity: 0.22 }} />
                              {/* delivered */}
                              <div style={{ position: 'absolute', inset: 0, width: `${barPct}%`, background: capColor(pct) }} />
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 3 }}>
                              <span style={{ color: capColor(pct), fontWeight: 600 }}>{fmtHrs(h.delivered_hours)}</span>
                              {` of ${fmtHrs(cap)} hrs this week`}
                              {pct != null && ` (${pct}%)`}
                              {h.scheduled_remaining > 0 && ` · ${fmtHrs(h.scheduled_remaining)} still scheduled`}
                              {ppct != null && ppct >= 100 && pct < 100 && (
                                <span style={{ color: '#d97706', fontWeight: 600 }}>{` · on pace for ${h.projected_pct}%`}</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                            {fmtHrs(h.delivered_hours)} hrs this week · no cap set
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* cap editor */}
                  {hoursOk && (
                    capEditId === c.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input value={capDraft} onChange={e => setCapDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveCap(c.id); if (e.key === 'Escape') setCapEditId(null) }}
                          autoFocus type="number" min="0" step="0.5" placeholder="hrs/wk"
                          style={{ width: 80, padding: '5px 7px', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 12.5, fontFamily: 'inherit' }} />
                        <button onClick={() => saveCap(c.id)} className="btn btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}>Save</button>
                        <button onClick={() => setCapEditId(null)} className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }}>Cancel</button>
                      </div>
                    ) : canEdit ? (
                      <button onClick={() => { setCapEditId(c.id); setCapDraft(cap ? String(cap) : '') }}
                        className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap' }}
                        title="Max billable hours per Mon–Sun week. Leave blank for no cap.">
                        {cap > 0 ? `Cap ${fmtHrs(cap)} h/wk` : 'Set cap'}
                      </button>
                    ) : cap > 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Cap {fmtHrs(cap)} h/wk</span>
                    ) : null
                  )}

                  {canEdit && <>
                    <button onClick={() => { setEditingId(c.id); setEditName(c.name) }} title="Rename"
                      style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, padding: 4 }}>✎</button>
                    <button onClick={() => deleteClient(c)} title="Delete"
                      style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--failed)', fontSize: 13, padding: 4 }}>🗑</button>
                  </>}
                </>
              )}
            </div>
          )
        })}
      </div>

      {hoursOk && (
        <p className="page-sub" style={{ maxWidth: 860, marginTop: 12, fontSize: 11.5 }}>
          Hours counted: Five9 billable time for dialer clients, ended claimed shift hours for back-office clients,
          plus task timers and auto-billed meetings. Week runs Mon–Sun (ET). Alerts land in your notifications
          at {THRESHOLDS.join('%, ')}% of cap, once each per client per week, plus a heads-up when the hours still
          on the schedule would take the week over.
        </p>
      )}
    </div>
  )
}
