import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// 💬 Chat support lines (Configuration, 2026-11-12)
// Agents don't DM individuals — each agent gets one conversation per support line that looks like a DM.
// Who answers a line: people whose role has "Answer agent support chats" for its client/project,
// plus the teams you add here. The server keeps every conversation's members in sync.
// ============================================================
export default function ChatSupportLines() {
  const [lines, setLines] = useState(null)
  const [clients, setClients] = useState([]), [projects, setProjects] = useState([]), [teams, setTeams] = useState([])
  const [edit, setEdit] = useState(null)
  const [preview, setPreview] = useState({})
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const [l, c, p, t] = await Promise.all([supabase.from('chat_support_lines').select('*').order('sort_order').order('name'),
      supabase.from('clients').select('id, name').order('name'), supabase.from('projects').select('id, name, client_id').is('deleted_at', null).order('name'),
      supabase.from('tags').select('id, name, namespace').order('namespace').order('name')])
    setLines(l.data || []); setClients(c.data || []); setProjects(p.data || []); setTeams(t.data || [])
    ;(l.data || []).forEach(x => supabase.rpc('chat_support_preview', { p_line: x.id }).then(({ data }) => data && setPreview(pv => ({ ...pv, [x.id]: data }))))
  }, [])
  useEffect(() => { load() }, [load])
  const tagName = (id) => { const t = teams.find(x => x.id === id); return t ? `${t.namespace ? t.namespace[0].toUpperCase() + t.namespace.slice(1) + ': ' : ''}${t.name}` : '…' }
  async function save() {
    if (!edit.name?.trim()) return setErr('Name the support line (e.g. “GarageCo Support”).')
    if (!edit.client_id && !edit.project_id) return setErr('Choose the client or project this line is for.')
    setBusy(true); setErr('')
    const row = { name: edit.name.trim(), client_id: edit.client_id || null, project_id: edit.project_id || null, team_tag_ids: edit.team_tag_ids || [], active: edit.active !== false, updated_at: new Date().toISOString() }
    const r = edit.id ? await supabase.from('chat_support_lines').update(row).eq('id', edit.id) : await supabase.from('chat_support_lines').insert(row)
    setBusy(false)
    if (r.error) return setErr(/row-level|policy/i.test(r.error.message) ? "You don't have permission to set up support lines." : r.error.message)
    setEdit(null); load()
  }
  const lbl = { display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)', margin: '12px 0 5px' }
  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, font: 'inherit', fontSize: 14, background: 'var(--surface)', color: 'var(--ink)' }
  return (
    <div style={{ maxWidth: 920 }}>
      <h1 className="page-title">💬 Chat support lines</h1>
      <p className="page-sub">Agents can't send private DMs to individuals. Instead, each agent has a conversation with each project's support line — it looks and works like a DM, only that agent sees their own, and everyone who supports the project can read and answer it (replies show the real person's name).</p>
      <div className="card" style={{ padding: '12px 16px', margin: '14px 0', fontSize: 13, background: 'color-mix(in srgb, #2dd4bf 8%, var(--surface))' }}>
        <b>Who answers a line</b> = people whose role has <b>“Answer agent support chats”</b> for that client/project (Access & Permissions), <b>plus</b> any teams you add below. When an internal person messages an agent, it opens that agent's support conversation, so the team sees it too.
      </div>
      {!lines ? <p className="page-sub">Loading…</p> : <>
        {lines.length === 0 && <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)' }}>No support lines yet.</div>}
        {lines.map(l => { const pv = preview[l.id]
          return (
            <div key={l.id} className="card" style={{ padding: '14px 18px', marginBottom: 10, opacity: l.active ? 1 : .6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22 }}>💬</span>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <b style={{ fontSize: 16 }}>{l.name}</b>{!l.active && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)' }}>Off</span>}
                  <div className="page-sub" style={{ fontSize: 12.5 }}>
                    {[clients.find(c => c.id === l.client_id)?.name, projects.find(p => p.id === l.project_id)?.name].filter(Boolean).join(' · ')}
                    {pv ? ` · ${pv.agents} agent${pv.agents === 1 ? '' : 's'} · ${pv.conversations} conversation${pv.conversations === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                <button className="btn btn-ghost" onClick={() => setEdit({ ...l })}>Edit</button>
              </div>
              {pv && <div style={{ marginTop: 8, fontSize: 12.5 }}><b>Answering:</b> {pv.supporters.length ? pv.supporters.map(s => `${s.name}${s.via === 'team' ? ' (team)' : ''}`).join(', ') : <span style={{ color: '#B91C1C' }}>nobody yet — add a team, or give a role “Answer agent support chats” for this client/project</span>}</div>}
            </div>) })}
        <button className="btn btn-primary" onClick={() => setEdit({ name: '', client_id: '', project_id: '', team_tag_ids: [], active: true })}>＋ New support line</button>
      </>}

      {edit && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setEdit(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', zIndex: 3000, display: 'grid', placeItems: 'center', padding: 14 }}>
          <div role="dialog" aria-label="Support line" style={{ width: 'min(560px, 100%)', background: 'var(--surface)', color: 'var(--ink)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.25)', padding: '18px 20px' }}>
            <b style={{ fontSize: 16 }}>{edit.id ? 'Edit support line' : 'New support line'}</b>
            <label style={lbl}>Name (what agents see)</label>
            <input style={inp} autoFocus value={edit.name} maxLength={80} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. GarageCo Support" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}><label style={lbl}>Client</label>
                <select style={inp} value={edit.client_id || ''} onChange={e => setEdit({ ...edit, client_id: e.target.value, project_id: '' })}><option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div style={{ flex: '1 1 200px' }}><label style={lbl}>Project <span style={{ fontWeight: 400 }}>(optional, narrows it)</span></label>
                <select style={inp} value={edit.project_id || ''} onChange={e => setEdit({ ...edit, project_id: e.target.value })}><option value="">—</option>{projects.filter(p => !edit.client_id || p.client_id === edit.client_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            </div>
            <label style={lbl}>Support teams <span style={{ fontWeight: 400 }}>(optional — people with these tags also answer)</span></label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {(edit.team_tag_ids || []).map(id => <span key={id} style={{ background: 'var(--canvas)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }} onClick={() => setEdit({ ...edit, team_tag_ids: edit.team_tag_ids.filter(x => x !== id) })}>{tagName(id)} ✕</span>)}
            </div>
            <select style={inp} value="" onChange={e => e.target.value && setEdit({ ...edit, team_tag_ids: [...(edit.team_tag_ids || []), e.target.value] })}>
              <option value="">＋ Add a team…</option>{teams.filter(t => !(edit.team_tag_ids || []).includes(t.id)).map(t => <option key={t.id} value={t.id}>{tagName(t.id)}</option>)}
            </select>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13.5 }}><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Line is on</label>
            {err && <div style={{ color: '#B91C1C', fontSize: 13, marginTop: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => { setEdit(null); setErr('') }}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
