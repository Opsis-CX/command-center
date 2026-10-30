import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, permScope } from '../lib/permissions'
import { useTerms, loadTerms } from '../lib/terms'

// ============================================================
// 🏢 Clients & Projects (2026-10-30) — self-service company structure.
// Client → as many projects as needed; internal projects have no client.
// Who can change what (enforced by the database):
//   • clients: "Add and remove clients" (Administrator level)
//   • projects: "Create and manage projects" for that client/project (Manager level, in scope)
//   • your own words: "Change company settings and branding" (Administrator level)
// Archiving is always recoverable.
// ============================================================

const INTERNAL = '__internal'
const COLORS = ['#2563EB', '#7C3AED', '#EA580C', '#0F766E', '#DB2777', '#16A34A', '#B45309', '#475569']

const CSS = `
.cp { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .cp { grid-template-columns: 1fr; } }
.cp-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: transparent; padding: 11px 12px; cursor: pointer; font-family: inherit; color: var(--ink); }
.cp-item:hover { background: var(--canvas); }
.cp-item.on { background: var(--accent-bg, rgba(0,119,182,.08)); box-shadow: inset 3px 0 0 var(--accent); }
.cp-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.cp-proj { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.cp-dot { width: 12px; height: 12px; border-radius: 4px; flex: none; }
.cp-msg { padding: 9px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 12px; }
.cp-msg.ok { background: #ECFDF5; color: #047857; } .cp-msg.err { background: #FEF2F2; color: #B91C1C; }
.cp-link { border: 0; background: transparent; color: var(--accent); font-weight: 700; font-size: 12.5px; cursor: pointer; font-family: inherit; padding: 2px 4px; }
`
const friendly = (e) => {
  const m = String(e?.message || e || '')
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to make that change."
  if (/projects_unique_name_per_client|clients_unique_name|duplicate key/i.test(m)) return 'That name is already used here — pick another.'
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong — please try again.'
}

export default function ClientsProjects() {
  const T = useTerms()
  const [clients, setClients] = useState([])
  const [archivedClients, setArchivedClients] = useState([])
  const [projects, setProjects] = useState([])
  const [assigns, setAssigns] = useState([])
  const [sel, setSel] = useState(null)        // client id or INTERNAL
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newClient, setNewClient] = useState(null)   // name being typed, or null
  const [newProject, setNewProject] = useState('')
  const [renaming, setRenaming] = useState(null)      // { kind, id, name }
  const [sure, setSure] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editTerms, setEditTerms] = useState(null)

  const canClients = hasPerm('clients.manage')
  const canSettings = hasPerm('admin.settings')
  const scope = permScope('tasks.manage')
  const canProjectsFor = (cid) => scope.all || (cid === INTERNAL ? false : scope.clients.includes(cid))
  const canProject = (p) => scope.all || scope.projects.includes(p.id) || (p.client_id && scope.clients.includes(p.client_id))

  const load = useCallback(async () => {
    const [c, ac, p, a] = await Promise.all([
      supabase.from('clients').select('id, name, archived_at').is('archived_at', null).order('name'),
      supabase.from('clients').select('id, name, archived_at').not('archived_at', 'is', null).order('name'),
      supabase.from('projects').select('id, name, description, color, client_id, deleted_at').is('deleted_at', null).order('name'),
      supabase.from('access_assignments').select('profile_id, scope_type, client_ids, project_ids'),
    ])
    setClients(c.data || []); setArchivedClients(ac.data || []); setProjects(p.data || []); setAssigns(a.data || [])
    return c.data || []
  }, [])
  useEffect(() => { load().then(cs => setSel(s => s || cs[0]?.id || INTERNAL)) }, [load])

  async function run(fn, ok) {
    setBusy(true); setMsg(null)
    const { error } = await fn()
    setBusy(false)
    if (error) { setMsg({ kind: 'err', text: friendly(error) }); return false }
    await load(); if (ok) setMsg({ kind: 'ok', text: ok }); return true
  }

  // people whose access touches this client / project (explicitly)
  const peopleFor = (cid, pid) => new Set(assigns.filter(a => a.scope_type === 'scoped' && ((cid && a.client_ids?.includes(cid)) || (pid && a.project_ids?.includes(pid)))).map(a => a.profile_id)).size

  const shown = clients.filter(c => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())
    || projects.some(p => p.client_id === c.id && p.name.toLowerCase().includes(q.trim().toLowerCase())))
  const selClient = clients.find(c => c.id === sel)
  const theirProjects = projects.filter(p => sel === INTERNAL ? !p.client_id : p.client_id === sel)
  const internalCount = projects.filter(p => !p.client_id).length

  async function addClient() {
    const name = (newClient || '').trim(); if (!name) return
    if (await run(() => supabase.from('clients').insert({ name, show_in_tasks: true }), `Added ${T.client.toLowerCase()} “${name}”.`)) {
      setNewClient(null)
      const { data } = await supabase.from('clients').select('id').ilike('name', name).is('archived_at', null).maybeSingle()
      if (data) setSel(data.id)
    }
  }
  async function addProject() {
    const name = newProject.trim(); if (!name) return
    const { data: me } = await supabase.auth.getUser()
    if (await run(() => supabase.from('projects').insert({ name, client_id: sel === INTERNAL ? null : sel, created_by: me?.user?.id,
      color: COLORS[projects.length % COLORS.length] }), `Added ${T.project.toLowerCase()} “${name}”.`)) setNewProject('')
  }
  async function saveRename() {
    const name = (renaming?.name || '').trim(); if (!name) return
    const table = renaming.kind === 'client' ? 'clients' : 'projects'
    if (await run(() => supabase.from(table).update({ name }).eq('id', renaming.id), 'Renamed.')) setRenaming(null)
  }
  async function moveProject(p, toClient) {
    await run(() => supabase.from('projects').update({ client_id: toClient === INTERNAL ? null : toClient }).eq('id', p.id),
      `Moved “${p.name}” to ${toClient === INTERNAL ? 'internal projects' : clients.find(c => c.id === toClient)?.name}.`)
  }
  async function archiveProject(p) {
    if (sure !== p.id) { setSure(p.id); return }
    setSure(null)
    await run(() => supabase.rpc('soft_delete_project', { p_project: p.id }), `Archived “${p.name}” — restore it any time from Projects → 🗑 Recently deleted.`)
  }
  async function archiveClient(c) {
    if (sure !== c.id) { setSure(c.id); return }
    setSure(null)
    if (await run(() => supabase.from('clients').update({ archived_at: new Date().toISOString() }).eq('id', c.id), `Archived “${c.name}”.`)) setSel(clients.find(x => x.id !== c.id)?.id || INTERNAL)
  }
  async function restoreClient(c) {
    if (await run(() => supabase.from('clients').update({ archived_at: null }).eq('id', c.id), `Restored “${c.name}”.`)) setSel(c.id)
  }
  async function saveTerms() {
    const rows = [
      { key: 'client', singular: editTerms.client.trim(), plural: editTerms.clients.trim() },
      { key: 'project', singular: editTerms.project.trim(), plural: editTerms.projects.trim() },
    ]
    if (rows.some(r => !r.singular || !r.plural)) return setMsg({ kind: 'err', text: 'Fill in all four words.' })
    if (await run(() => supabase.from('org_terms').upsert(rows, { onConflict: 'key' }), 'Saved — these words now show across Command Center.')) { await loadTerms(true); setEditTerms(null) }
  }

  return (
    <div>
      <style>{CSS}</style>
      {msg && <div className={'cp-msg ' + msg.kind}>{msg.text}</div>}

      {/* ---- your own words ---- */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        {!editTerms ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Your words</div>
              <div className="page-sub" style={{ fontSize: 12.5 }}>Your company calls them <b>{T.clients}</b> and <b>{T.projects}</b>. Change the words anytime — access and data stay exactly the same.</div>
            </div>
            {canSettings && <button className="btn btn-ghost" onClick={() => setEditTerms({ ...T })}>✎ Change words</button>}
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>What does your company call them?</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[['client', 'One client (e.g. Account)'], ['clients', 'Many (e.g. Accounts)'], ['project', 'One project (e.g. Campaign)'], ['projects', 'Many (e.g. Campaigns)']].map(([k, ph]) => (
                <label key={k} style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>{ph}
                  <input className="cp-in" style={{ marginTop: 4 }} maxLength={30} value={editTerms[k]} onChange={e => setEditTerms(t => ({ ...t, [k]: e.target.value }))} /></label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={saveTerms}>Save words</button>
              <button className="btn btn-ghost" onClick={() => setEditTerms(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="cp">
        {/* ---- clients list ---- */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--line)', display: 'grid', gap: 8 }}>
            <input className="cp-in" placeholder={`Search ${T.clients.toLowerCase()} & ${T.projects.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} />
            {canClients && (newClient === null
              ? <button className="btn btn-primary" onClick={() => setNewClient('')}>＋ Add {T.client.toLowerCase()}</button>
              : <div style={{ display: 'flex', gap: 6 }}>
                  <input className="cp-in" autoFocus maxLength={80} placeholder={`${T.client} name`} value={newClient}
                    onChange={e => setNewClient(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addClient(); if (e.key === 'Escape') setNewClient(null) }} />
                  <button className="btn btn-primary" disabled={busy || !newClient.trim()} onClick={addClient}>Add</button>
                </div>)}
          </div>
          {shown.map(c => {
            const n = projects.filter(p => p.client_id === c.id).length
            return (
              <button key={c.id} className={'cp-item' + (sel === c.id ? ' on' : '')} onClick={() => { setSel(c.id); setMsg(null); setRenaming(null) }}>
                <span style={{ fontSize: 18 }}>🏢</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                  <span className="page-sub" style={{ fontSize: 12 }}>{n} {n === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()}</span>
                </span>
              </button>
            )
          })}
          <button className={'cp-item' + (sel === INTERNAL ? ' on' : '')} onClick={() => { setSel(INTERNAL); setMsg(null) }}>
            <span style={{ fontSize: 18 }}>🏠</span>
            <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Internal {T.projects.toLowerCase()}</span>
              <span className="page-sub" style={{ fontSize: 12 }}>No {T.client.toLowerCase()} · {internalCount}</span></span>
          </button>
          {archivedClients.length > 0 && (
            <div>
              <button className="cp-item" style={{ fontSize: 13, color: 'var(--ink-soft)', borderBottom: 0 }} onClick={() => setShowArchived(v => !v)}>
                📦 Archived {T.clients.toLowerCase()} ({archivedClients.length}) <span style={{ marginLeft: 'auto' }}>{showArchived ? '▾' : '▸'}</span>
              </button>
              {showArchived && archivedClients.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 8px', fontSize: 13 }}>
                  <span style={{ flex: 1, color: 'var(--ink-soft)' }}>{c.name}</span>
                  {canClients && <button className="cp-link" onClick={() => restoreClient(c)}>↩ Restore</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- selected client: its projects ---- */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {sel !== INTERNAL && renaming?.kind === 'client' ? (
              <>
                <input className="cp-in" style={{ maxWidth: 320 }} autoFocus maxLength={80} value={renaming.name}
                  onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null) }} />
                <button className="btn btn-primary" disabled={busy} onClick={saveRename}>Save</button>
                <button className="btn btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{sel === INTERNAL ? `Internal ${T.projects.toLowerCase()}` : selClient?.name}</div>
                  <div className="page-sub" style={{ fontSize: 12.5 }}>
                    {sel === INTERNAL ? `${T.projects} that don't belong to a ${T.client.toLowerCase()} — your own team's work.`
                      : `${theirProjects.length} ${theirProjects.length === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()} · ${peopleFor(sel)} ${peopleFor(sel) === 1 ? 'person has' : 'people have'} access to all of ${selClient?.name}`}
                  </div>
                </div>
                {sel !== INTERNAL && canClients && <button className="btn btn-ghost" onClick={() => setRenaming({ kind: 'client', id: sel, name: selClient?.name || '' })}>✎ Rename</button>}
                {sel !== INTERNAL && canClients && <button className="btn btn-ghost" style={{ color: '#B91C1C' }} disabled={busy}
                  title={theirProjects.length ? `Archive or move its ${T.projects.toLowerCase()} first` : ''}
                  onClick={() => archiveClient(selClient)}>{sure === sel ? 'Click to confirm' : 'Archive'}</button>}
              </>
            )}
          </div>

          <div style={{ padding: '4px 16px 16px' }}>
            {theirProjects.length === 0 && <div className="page-sub" style={{ padding: '14px 0', fontSize: 13 }}>No {T.projects.toLowerCase()} yet{canProjectsFor(sel) ? ' — add the first one below.' : '.'}</div>}
            {theirProjects.map(p => (
              <div key={p.id} className="cp-proj">
                <span className="cp-dot" style={{ background: p.color || '#64748B' }} />
                {renaming?.kind === 'project' && renaming.id === p.id ? (
                  <>
                    <input className="cp-in" style={{ maxWidth: 280 }} autoFocus maxLength={80} value={renaming.name}
                      onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null) }} />
                    <button className="cp-link" onClick={saveRename}>Save</button><button className="cp-link" style={{ color: 'var(--ink-soft)' }} onClick={() => setRenaming(null)}>Cancel</button>
                  </>
                ) : (
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div className="page-sub" style={{ fontSize: 12 }}>{peopleFor(null, p.id)} {peopleFor(null, p.id) === 1 ? 'person has' : 'people have'} access to just this {T.project.toLowerCase()}</div>
                  </div>
                )}
                {canProject(p) && renaming?.id !== p.id && (
                  <>
                    <button className="cp-link" onClick={() => setRenaming({ kind: 'project', id: p.id, name: p.name })}>✎ Rename</button>
                    <select className="cp-in" style={{ width: 'auto', padding: '4px 8px', fontSize: 12.5 }} value="" disabled={busy}
                      onChange={e => e.target.value && moveProject(p, e.target.value)} aria-label="Move to">
                      <option value="">Move to…</option>
                      {clients.filter(c => c.id !== p.client_id && canProjectsFor(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      {p.client_id && scope.all && <option value={INTERNAL}>Internal {T.projects.toLowerCase()}</option>}
                    </select>
                    <button className="cp-link" style={{ color: '#B91C1C' }} disabled={busy} onClick={() => archiveProject(p)}>{sure === p.id ? 'Click to confirm' : 'Archive'}</button>
                  </>
                )}
              </div>
            ))}
            {canProjectsFor(sel) || (sel === INTERNAL && scope.all) ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input className="cp-in" maxLength={80} placeholder={`New ${T.project.toLowerCase()} name — e.g. Web Leads`} value={newProject}
                  onChange={e => setNewProject(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addProject() }} />
                <button className="btn btn-primary" disabled={busy || !newProject.trim()} onClick={addProject}>＋ Add {T.project.toLowerCase()}</button>
              </div>
            ) : (
              <div className="page-sub" style={{ fontSize: 12.5, marginTop: 10 }}>You can see these {T.projects.toLowerCase()}, but adding or changing them needs “Create and manage projects” for this {T.client.toLowerCase()}.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
