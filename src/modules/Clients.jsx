import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can } from '../lib/permissions'

// ============================================================
// CLIENTS — company-wide client list, shared by the Projects
// module (tasks.client_id) and Scheduling (schedules.client_id).
// View-only for some roles; edit controls gated to clients.edit.
// ============================================================

export default function Clients() {
  const { appRole } = useAuth()
  const canEdit = can(appRole, 'clients.edit')
  const [clients, setClients] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [scheduleCounts, setScheduleCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [cliRes, taskRes, schRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('tasks').select('client_id').is('deleted_at', null),
      supabase.from('schedules').select('client_id'),
    ])
    setClients(cliRes.data || [])
    // count references
    const tc = {}, sc = {}
    ;(taskRes.data || []).forEach(t => { if (t.client_id) tc[t.client_id] = (tc[t.client_id] || 0) + 1 })
    ;(schRes.data || []).forEach(s => { if (s.client_id) sc[s.client_id] = (sc[s.client_id] || 0) + 1 })
    setTaskCounts(tc); setScheduleCounts(sc)
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

  if (loading) return <p className="page-sub">Loading clients…</p>

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Clients</h1>
        <p className="page-sub">One shared client list, used across Projects and Scheduling.</p>
      </div>

      {msg && <div className="card" style={{ padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--accent)', display: 'inline-block' }}>{msg}</div>}

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
      <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 620 }}>
        {clients.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>No clients yet.</div>
        ) : clients.map(c => {
          const tCount = taskCounts[c.id] || 0
          const sCount = scheduleCounts[c.id] || 0
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
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 1 }}>
                      {tCount} task{tCount !== 1 ? 's' : ''} · {sCount} schedule{sCount !== 1 ? 's' : ''}
                    </div>
                  </div>
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
    </div>
  )
}
