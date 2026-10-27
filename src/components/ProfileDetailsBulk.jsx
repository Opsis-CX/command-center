import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// Admins: fill in job title, team and manager for everyone at once.
// Shown on People & Tags. The database only lets admins change these three
// fields (guard_profile_privilege_columns), so this card is admin-only.
// ============================================================
const inp = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }

export default function ProfileDetailsBulk() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [edits, setEdits] = useState({})   // id -> { job_title, team, manager_id }
  const [filter, setFilter] = useState('missing') // missing | all
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data, error } = await supabase.from('profiles')
      .select('id, full_name, role, job_title, team, manager_id, avatar_url')
      .eq('is_active', true).is('client_id', null).eq('is_service_account', false).order('full_name')
    if (error) { setErr(error.message); return }
    setRows(data || []); setEdits({})
  }
  useEffect(() => { if (open) load() }, [open])

  const val = (r, f) => (edits[r.id] && f in edits[r.id]) ? edits[r.id][f] : (r[f] || '')
  const setVal = (r, f, v) => setEdits(prev => ({ ...prev, [r.id]: { ...(prev[r.id] || {}), [f]: v } }))
  const teams = useMemo(() => [...new Set(rows.map(r => r.team).filter(Boolean))].sort(), [rows])
  const missing = (r) => !r.job_title || !r.team || !r.manager_id
  const shown = rows.filter(r => (filter === 'all' || missing(r)) && (!q || r.full_name.toLowerCase().includes(q.toLowerCase())))
  const changed = Object.entries(edits).filter(([id, e]) => {
    const r = rows.find(x => x.id === id)
    return r && ['job_title', 'team', 'manager_id'].some(f => f in e && (e[f] || null) !== (r[f] || null))
  })

  async function saveAll() {
    setBusy(true); setErr(''); setMsg('')
    let ok = 0
    for (const [id, e] of changed) {
      const fields = {}
      for (const f of ['job_title', 'team', 'manager_id']) if (f in e) fields[f] = (typeof e[f] === 'string' ? e[f].trim() : e[f]) || null
      const { error } = await supabase.from('profiles').update(fields).eq('id', id)
      if (error) { setErr(`${rows.find(r => r.id === id)?.full_name}: ${error.message}`); break }
      ok++
    }
    setBusy(false)
    if (ok) { setMsg(`Saved ${ok} ${ok === 1 ? 'person' : 'people'}.`); setTimeout(() => setMsg(''), 4000) }
    load()
  }

  const total = rows.length, done = rows.filter(r => !missing(r)).length
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Profile details</h3>
          <p className="page-sub" style={{ margin: 0 }}>Job title, team and manager for everyone — they show on each person's profile.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Edit profile details'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
              <option value="missing">Missing something</option>
              <option value="all">Everyone</option>
            </select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name…" style={{ ...inp, width: 200 }} />
            <span className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>{done} of {total} complete</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" disabled={busy || changed.length === 0} onClick={saveAll}>
              {busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save'}
            </button>
          </div>
          <datalist id="pdb-teams">{teams.map(t => <option key={t} value={t} />)}</datalist>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead><tr>{['Person', 'Job title', 'Team', 'Manager'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--ink-soft)', borderBottom: '2px solid var(--line)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', fontSize: 13.5, whiteSpace: 'nowrap' }}>
                      <a href={`/profile/${r.id}`}>{r.full_name}</a>
                      <div className="page-sub" style={{ margin: 0, fontSize: 11.5 }}>{r.role}</div>
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                      <input value={val(r, 'job_title')} maxLength={80} onChange={e => setVal(r, 'job_title', e.target.value)} placeholder="Job title" style={inp} /></td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                      <input value={val(r, 'team')} maxLength={60} list="pdb-teams" onChange={e => setVal(r, 'team', e.target.value)} placeholder="Team" style={inp} /></td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                      <select value={val(r, 'manager_id')} onChange={e => setVal(r, 'manager_id', e.target.value)} style={inp}>
                        <option value="">No manager</option>
                        {rows.filter(x => x.id !== r.id).map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                      </select></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={4} className="page-sub" style={{ padding: 12 }}>{filter === 'missing' ? 'Everyone is filled in. 🎉' : 'No matches.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {err && <div role="alert" className="login-err" style={{ marginTop: 8 }}>{err}</div>}
          {msg && <div role="status" style={{ fontSize: 13, color: 'var(--passed)', marginTop: 8 }}>{msg}</div>}
        </div>
      )}
    </div>
  )
}
