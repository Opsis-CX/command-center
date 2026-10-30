import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { taskError } from '../lib/taskRights'

// 🗑 Recently deleted (2026-10-30) — deleted tasks and projects the person is allowed to
// restore (the database decides: my_recently_deleted / restore_project / the task rules).
// Restoring a project brings back exactly the tasks that were deleted with it.
export default function ProjectTrash() {
  const { refresh } = useProjectsData()
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_recently_deleted')
    if (error) { setMsg({ kind: 'err', text: taskError(error) }); setRows([]); return }
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function restore(r) {
    setBusy(r.id); setMsg(null)
    const { error } = r.kind === 'project'
      ? await supabase.rpc('restore_project', { p_project: r.id })
      : await supabase.from('tasks').update({ deleted_at: null }).eq('id', r.id)
    setBusy(null)
    if (error) return setMsg({ kind: 'err', text: taskError(error) })
    setMsg({ kind: 'ok', text: r.kind === 'project' ? `Restored “${r.name}” and its ${r.task_count || 0} task${r.task_count === 1 ? '' : 's'}.` : `Restored “${r.name}”.` })
    await load(); refresh?.()
  }

  if (!rows) return <p className="page-sub" style={{ padding: 16 }}>Loading…</p>
  const shown = rows.filter(r => !q.trim() || (r.name || '').toLowerCase().includes(q.trim().toLowerCase()))
  const when = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>🗑 Recently deleted</div>
          <div className="page-sub" style={{ fontSize: 12.5 }}>Deleted tasks and projects you're allowed to restore. Nothing here is gone for good.</div>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" aria-label="Search deleted items"
          style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)' }} />
      </div>
      {msg && <div style={{ margin: '12px 16px 0', padding: '8px 12px', borderRadius: 8, fontSize: 13, background: msg.kind === 'ok' ? '#ECFDF5' : '#FEF2F2', color: msg.kind === 'ok' ? '#047857' : '#B91C1C' }}>{msg.text}</div>}
      {shown.length === 0 ? (
        <div className="page-sub" style={{ padding: 24, textAlign: 'center' }}>{rows.length ? 'Nothing matches your search.' : 'Nothing has been deleted that you can restore.'}</div>
      ) : shown.map(r => (
        <div key={r.kind + r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18 }}>{r.kind === 'project' ? '📁' : '☑️'}</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
            <div className="page-sub" style={{ fontSize: 12 }}>
              {r.kind === 'project' ? `Project · ${r.task_count || 0} task${r.task_count === 1 ? '' : 's'} deleted with it` : (r.project_name ? `Task in ${r.project_name}` : 'Task')}
              {' · '}deleted {when(r.deleted_at)}{r.deleted_by_name ? ` by ${r.deleted_by_name}` : ''}
            </div>
          </div>
          <button className="btn btn-ghost" disabled={busy === r.id} onClick={() => restore(r)}>{busy === r.id ? 'Restoring…' : '↩ Restore'}</button>
        </div>
      ))}
    </div>
  )
}
