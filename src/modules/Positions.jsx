import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// ============================================================
// POSITIONS
// Manage the roles/positions people are scheduled for.
// Stored in the call_types table; UI calls them "Positions".
// Edit controls gated to roles with positions.edit; others see view-only.
// ============================================================

export default function Positions() {
  const { appRole } = useAuth()
  const canEdit = can(appRole, 'positions.edit')
  const [positions, setPositions] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [editing, setEditing] = useState(null) // position obj or {} for new

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const [ctRes, schRes] = await Promise.all([
        supabase.from('call_types').select('*').order('name'),
        supabase.from('schedules').select('id, call_type_id'),
      ])
      if (ctRes.error) throw ctRes.error
      setPositions(ctRes.data || [])
      setSchedules(schRes.data || [])
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  function flash(m) { setToast(m); setTimeout(() => setToast(''), 2600) }

  async function toggleActive(p) {
    const { error } = await supabase.from('call_types').update({ active: !p.active }).eq('id', p.id)
    if (error) { flash('Error: ' + error.message); return }
    flash(p.active ? 'Position deactivated' : 'Position activated'); load()
  }

  if (loading) return <p className="page-sub">Loading…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Positions</h1>
          <p className="page-sub">The roles people are scheduled for. Each schedule is tied to a position; certifications can require one.</p>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing({})}>+ New position</button>}
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--failed)', marginBottom: 16 }}><b style={{ color: 'var(--failed)' }}>Error.</b><p className="page-sub" style={{ marginTop: 6 }}>{err}</p></div>}
      {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--ink)', color: '#fff', padding: '11px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 2000, boxShadow: '0 8px 24px rgba(0,0,0,.3)' }}>{toast}</div>}

      {positions.length === 0 ? (
        <div className="card"><div className="page-sub" style={{ textAlign: 'center', padding: 24 }}>No positions yet. Click <b>+ New position</b> to add one.</div></div>
      ) : (
        <div className="cards">
          {positions.map(p => {
            const scheduleCount = schedules.filter(s => s.call_type_id === p.id).length
            return (
              <div className="card" key={p.id} style={{ opacity: p.active === false ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600 }}>{p.name}</h3>
                  {p.active === false && <span className="badge" style={{ background: 'var(--failed-bg)', color: 'var(--failed)' }}>inactive</span>}
                </div>
                {p.description && <p className="page-sub" style={{ marginTop: 5 }}>{p.description}</p>}
                <p className="page-sub" style={{ marginTop: 8, fontSize: 12 }}>{scheduleCount} schedule{scheduleCount !== 1 ? 's' : ''}</p>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => setEditing(p)}>Edit</button>
                    <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => toggleActive(p)}>{p.active === false ? 'Activate' : 'Deactivate'}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && <PositionModal position={editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); flash('Position saved') }} />}
    </div>
  )
}

function PositionModal({ position, onClose, onSaved }) {
  const isNew = !position.id
  const [name, setName] = useState(position.name || '')
  const [description, setDescription] = useState(position.description || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!name.trim()) { setErr('Give the position a name.'); return }
    setSaving(true); setErr('')
    try {
      if (isNew) {
        const { error } = await supabase.from('call_types').insert({ name: name.trim(), description: description.trim() || null, active: true })
        if (error) throw error
      } else {
        const { error } = await supabase.from('call_types').update({ name: name.trim(), description: description.trim() || null }).eq('id', position.id)
        if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.code === '23505' ? 'A position with that name already exists.' : e.message); setSaving(false) }
  }

  return (
    <div className="modal-back open" onClick={e => { if (e.target.classList.contains('modal-back')) onClose() }}>
      <div className="modal" style={{ width: 440 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{isNew ? 'New position' : 'Edit position'}</h3>
        <p className="page-sub" style={{ marginBottom: 18 }}>Name it however your team refers to the role.</p>
        {err && <div className="login-err" style={{ marginBottom: 14 }}>{err}</div>}
        <div className="field"><label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. GarageCo — Appointment Setting" autoFocus /></div>
        <div className="field"><label>Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What this position covers" /></div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save position'}</button>
        </div>
      </div>
    </div>
  )
}
