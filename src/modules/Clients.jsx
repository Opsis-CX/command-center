import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, fetchAllRows } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { can, hasPerm, permScope, usingNewPermissions } from '../lib/permissions'
import { useFinanceAccess } from '../lib/financeAccess'
import { useTerms, loadTerms } from '../lib/terms'

// ============================================================
// CLIENTS (revamped 2026-10-30) — where the company structure lives:
// Client → as many Projects as needed (+ internal projects with no client).
// Access & Permissions reads clients/projects from here; it doesn't set them up.
//
// Kept from the original page: shared client list (Projects + Scheduling), the two flags
// ("Invoicing" — Finance managers; "Task management" — task dropdowns), this week's hours vs
// cap with the attention banner (caps are SET in Finance; numbers come from
// get_client_hours_week()), task / schedule counts, and "Under <parent>" from Finance.
// Changed: deleting a client is now a recoverable Archive (no permanent delete).
// Who can change what (database-enforced where the new permissions system is on):
//   add / archive clients → "Add and remove clients"; rename & flags → "Edit client details";
//   projects → "Create and manage projects" for that client; your words → company settings.
// ============================================================

const THRESHOLDS = [50, 80, 90, 100]
const INTERNAL = '__internal'
const COLORS = ['#2563EB', '#7C3AED', '#EA580C', '#0F766E', '#DB2777', '#16A34A', '#B45309', '#475569']

function capColor(pct) {
  if (pct == null) return 'var(--ink-soft)'
  if (pct >= 100) return '#dc2626'
  if (pct >= 90) return '#ea580c'
  if (pct >= 80) return '#d97706'
  return '#16a34a'
}
function fmtHrs(n) {
  const v = Number(n) || 0
  return v % 1 === 0 ? String(v) : v.toFixed(1)
}
function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const friendly = (e) => {
  const m = String(e?.message || e || '')
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to make that change."
  if (/projects_unique_name_per_client|clients_unique_name|duplicate key/i.test(m)) return 'That name is already used here — pick another.'
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong — please try again.'
}

const CSS = `
.cl { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .cl { grid-template-columns: 1fr; } }
.cl-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: transparent; padding: 10px 12px; cursor: pointer; font-family: inherit; color: var(--ink); }
.cl-item:hover { background: var(--canvas); }
.cl-item.on { background: var(--accent-bg, rgba(0,119,182,.08)); box-shadow: inset 3px 0 0 var(--accent); }
.cl-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); box-sizing: border-box; }
.cl-sec { padding: 14px 16px; border-bottom: 1px solid var(--line); }
.cl-sec h3 { margin: 0 0 8px; font-size: 13px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-soft); }
.cl-proj { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.cl-proj:last-of-type { border-bottom: 0; }
.cl-dot { width: 12px; height: 12px; border-radius: 4px; flex: none; }
.cl-link { border: 0; background: transparent; color: var(--accent); font-weight: 700; font-size: 12.5px; cursor: pointer; font-family: inherit; padding: 2px 4px; }
.cl-chip { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--canvas); white-space: nowrap; }
.cl-msg { padding: 9px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 12px; }
.cl-msg.ok { background: #ECFDF5; color: #047857; } .cl-msg.err { background: #FEF2F2; color: #B91C1C; }
`

export default function Clients() {
  const { appRole } = useAuth()
  const T = useTerms()
  const fin = useFinanceAccess()
  const newPerms = usingNewPermissions()
  // where the new permissions system is on, use its checkboxes; otherwise the old rule
  const canAddClients = newPerms ? hasPerm('clients.manage') : can(appRole, 'clients.edit')
  const canEdit = newPerms ? (hasPerm('clients.edit') || hasPerm('clients.manage')) : can(appRole, 'clients.edit')
  const canSettings = newPerms ? hasPerm('admin.settings') : false
  const projScope = newPerms ? permScope('tasks.manage') : { all: canEdit, projects: [], clients: [] }
  const canProjectsFor = (cid) => projScope.all || (cid !== INTERNAL && projScope.clients.includes(cid))
  const canProject = (p) => projScope.all || projScope.projects.includes(p.id) || (p.client_id && projScope.clients.includes(p.client_id))

  const [clients, setClients] = useState([])
  const [archivedClients, setArchivedClients] = useState([])
  const [projects, setProjects] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [scheduleCounts, setScheduleCounts] = useState({})
  const [hours, setHours] = useState({})
  const [week, setWeek] = useState(null)
  const [hoursOk, setHoursOk] = useState(false)
  const [invoicing, setInvoicing] = useState({})
  const [parents, setParents] = useState({})
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(null)          // { name, invoicing, tasks }
  const [newProject, setNewProject] = useState('')
  const [renaming, setRenaming] = useState(null)      // { kind, id, name }
  const [sure, setSure] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editTerms, setEditTerms] = useState(null)

  const load = useCallback(async () => {
    const [cliRes, prRes, taskRes, schRes, hrsRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('projects').select('*').order('name'),
      fetchAllRows(() => supabase.from('tasks').select('client_id').is('deleted_at', null).order('id')),
      supabase.from('schedules').select('client_id'),
      supabase.rpc('get_client_hours_week'),
    ])
    const all = cliRes.data || []
    setClients(all.filter(c => !c.archived_at)); setArchivedClients(all.filter(c => c.archived_at))
    setProjects((prRes.data || []).filter(p => !p.deleted_at))
    const tc = {}, sc = {}
    ;(taskRes.data || []).forEach(t => { if (t.client_id) tc[t.client_id] = (tc[t.client_id] || 0) + 1 })
    ;(schRes.data || []).forEach(s => { if (s.client_id) sc[s.client_id] = (sc[s.client_id] || 0) + 1 })
    setTaskCounts(tc); setScheduleCounts(sc)
    const h = hrsRes.data
    if (h && !h.error && Array.isArray(h.clients)) {
      const map = {}; h.clients.forEach(r => { map[r.client_id] = r })
      setHours(map); setWeek({ week_start: h.week_start, week_end: h.week_end }); setHoursOk(true)
    } else setHoursOk(false)
    setLoading(false)
    return all.filter(c => !c.archived_at)
  }, [])
  useEffect(() => { load().then(cs => setSel(s => s || cs[0]?.id || INTERNAL)) }, [load])

  useEffect(() => {
    if (!fin?.manager) { setInvoicing({}); return }
    supabase.from('finance_client_profiles').select('client_id,in_invoicing,parent_client_id').then(({ data }) => {
      const m = {}, pm = {}; (data || []).forEach(r => { m[r.client_id] = r.in_invoicing; if (r.parent_client_id) pm[r.client_id] = r.parent_client_id })
      setInvoicing(m); setParents(pm)
    })
  }, [fin?.manager])   // eslint-disable-line

  async function run(fn, ok) {
    setBusy(true); setMsg(null)
    const { error } = await fn()
    setBusy(false)
    if (error) { setMsg({ kind: 'err', text: friendly(error) }); return false }
    await load(); if (ok) setMsg({ kind: 'ok', text: ok }); return true
  }

  // ---------- clients ----------
  async function addClient() {
    const name = (adding?.name || '').trim(); if (!name) return
    if (clients.some(c => c.name.toLowerCase() === name.toLowerCase())) return setMsg({ kind: 'err', text: `There's already a ${T.client.toLowerCase()} called “${name}”.` })
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.from('clients').insert({ name, show_in_tasks: adding.tasks }).select().single()
    if (error) { setBusy(false); return setMsg({ kind: 'err', text: friendly(error) }) }
    if (fin?.manager && !adding.invoicing) await supabase.rpc('finance_client_set_flags', { p_client: data.id, p_in_invoicing: false, p_show_in_tasks: null })
    if (fin?.manager) setInvoicing(prev => ({ ...prev, [data.id]: adding.invoicing }))
    setBusy(false); setAdding(null); await load(); setSel(data.id)
    setMsg({ kind: 'ok', text: `Added “${name}” — now add its ${T.projects.toLowerCase()}.` })
  }
  async function setFlag(c, patch) {
    setMsg(null)
    if (fin?.manager) {
      const { error } = await supabase.rpc('finance_client_set_flags', { p_client: c.id, p_in_invoicing: null, p_show_in_tasks: null, ...patch })
      if (error) return setMsg({ kind: 'err', text: friendly(error) })
    } else if ('p_show_in_tasks' in patch) {
      const { error } = await supabase.from('clients').update({ show_in_tasks: patch.p_show_in_tasks }).eq('id', c.id)
      if (error) return setMsg({ kind: 'err', text: friendly(error) })
    }
    if ('p_show_in_tasks' in patch) setClients(prev => prev.map(x => x.id === c.id ? { ...x, show_in_tasks: patch.p_show_in_tasks } : x))
    if ('p_in_invoicing' in patch) setInvoicing(prev => ({ ...prev, [c.id]: patch.p_in_invoicing }))
    setMsg({ kind: 'ok', text: 'p_in_invoicing' in patch ? (patch.p_in_invoicing ? `${c.name} is in invoicing.` : `${c.name} is out of invoicing (its hours are not invoiced).`)
      : (patch.p_show_in_tasks ? `${c.name} shows in task dropdowns.` : `${c.name} is hidden from task dropdowns.`) })
  }
  // Archive a client together with its projects (and their tasks); restoring brings them back.
  async function archiveClient(c) {
    if (sure !== c.id) { setSure(c.id); return }
    setSure(null); setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('archive_client', { p_client: c.id })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: friendly(error) })
    await load(); setSel(clients.find(x => x.id !== c.id)?.id || INTERNAL)
    const n = data?.projects || 0
    setMsg({ kind: 'ok', text: `Archived “${c.name}”${n ? ` and its ${n} ${n === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()}` : ''}. Restore ${n ? 'them' : 'it'} any time from 📦 Archived.` })
  }
  async function restoreClient(c, alsoEarlier = false) {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('restore_client', { p_client: c.id, p_also_earlier: alsoEarlier })
    setBusy(false)
    if (error) return setMsg({ kind: 'err', text: friendly(error) })
    await load(); setSel(c.id)
    const n = data?.projects || 0, earlier = data?.earlier || []
    setMsg({ kind: 'ok', text: alsoEarlier ? `Restored ${n} more ${n === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()}.`
      : `Restored “${c.name}”${n ? ` and its ${n} ${n === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()}` : ''}.`,
      earlier: alsoEarlier ? [] : earlier, client: c })
  }
  async function saveRename() {
    const name = (renaming?.name || '').trim(); if (!name) return
    if (await run(() => supabase.from(renaming.kind === 'client' ? 'clients' : 'projects').update({ name }).eq('id', renaming.id), 'Renamed.')) setRenaming(null)
  }

  // ---------- projects ----------
  async function addProject() {
    const name = newProject.trim(); if (!name) return
    const { data: me } = await supabase.auth.getUser()
    if (await run(() => supabase.from('projects').insert({ name, client_id: sel === INTERNAL ? null : sel, created_by: me?.user?.id,
      color: COLORS[projects.length % COLORS.length] }), `Added ${T.project.toLowerCase()} “${name}”.`)) setNewProject('')
  }
  async function moveProject(p, toClient) {
    await run(() => supabase.from('projects').update({ client_id: toClient === INTERNAL ? null : toClient }).eq('id', p.id),
      `Moved “${p.name}” to ${toClient === INTERNAL ? `internal ${T.projects.toLowerCase()}` : clients.find(c => c.id === toClient)?.name}.`)
  }
  async function archiveProject(p) {
    if (sure !== p.id) { setSure(p.id); return }
    setSure(null)
    await run(() => supabase.rpc('soft_delete_project', { p_project: p.id }), `Archived “${p.name}” — restore it any time from Projects → 🗑 Recently deleted.`)
  }

  // ---------- your words ----------
  async function saveTerms() {
    const rows = [
      { key: 'client', singular: editTerms.client.trim(), plural: editTerms.clients.trim() },
      { key: 'project', singular: editTerms.project.trim(), plural: editTerms.projects.trim() },
    ]
    if (rows.some(r => !r.singular || !r.plural)) return setMsg({ kind: 'err', text: 'Fill in all four words.' })
    if (await run(() => supabase.from('org_terms').upsert(rows, { onConflict: 'key' }), 'Saved — these words now show across Command Center.')) { await loadTerms(true); setEditTerms(null) }
  }

  const flagged = useMemo(() => {
    if (!hoursOk) return []
    return clients.map(c => hours[c.id])
      .filter(r => r && r.cap > 0 && ((r.pct != null && r.pct >= 80) || (r.projected_pct != null && r.projected_pct >= 100)))
      .sort((a, b) => (b.pct || 0) - (a.pct || 0))
  }, [clients, hours, hoursOk])

  if (loading) return <p className="page-sub">Loading {T.clients.toLowerCase()}…</p>

  const weekLabel = week ? `${fmtDay(week.week_start)} – ${fmtDay(week.week_end)}` : ''
  const shown = clients.filter(c => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())
    || projects.some(p => p.client_id === c.id && p.name.toLowerCase().includes(q.trim().toLowerCase())))
  const selClient = clients.find(c => c.id === sel)
  const theirProjects = projects.filter(p => sel === INTERNAL ? !p.client_id : p.client_id === sel)
  const internalCount = projects.filter(p => !p.client_id).length
  const h = selClient ? hours[selClient.id] : null
  const cap = h && Number(h.cap) > 0 ? Number(h.cap) : null

  return (
    <div>
      <style>{CSS}</style>
      <div style={{ marginBottom: 16 }}>
        <h1 className="page-title">{T.clients}</h1>
        <p className="page-sub">Your {T.clients.toLowerCase()} and their {T.projects.toLowerCase()} — the structure used across Projects, Scheduling, Reporting and Access & Permissions.</p>
      </div>

      {msg && (
        <div className={'cl-msg ' + msg.kind}>
          {msg.text}
          {msg.earlier?.length > 0 && (
            <div style={{ marginTop: 6 }}>
              It also has {msg.earlier.length} {msg.earlier.length === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()} archived earlier: <b>{msg.earlier.map(x => x.name).join(', ')}</b>.{' '}
              <button className="cl-link" disabled={busy} onClick={() => restoreClient(msg.client, true)}>↩ Restore {msg.earlier.length === 1 ? 'it' : 'them'} too</button>
            </div>
          )}
        </div>
      )}

      {/* cap banner (unchanged) */}
      {hoursOk && flagged.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 16, borderLeft: `3px solid ${capColor(flagged[0].pct)}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Weekly hours cap — attention ({weekLabel})</div>
          {flagged.map(r => {
            const over = r.pct >= 100, pace = r.pct < 100 && r.projected_pct >= 100
            return (
              <div key={r.client_id} style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: capColor(over ? 100 : r.pct) }}>{r.name}</span>{' — '}
                {over ? `over cap: ${fmtHrs(r.delivered_hours)} of ${fmtHrs(r.cap)} hrs (${r.pct}%)` : `${fmtHrs(r.delivered_hours)} of ${fmtHrs(r.cap)} hrs used (${r.pct}%)`}
                {pace && <span style={{ color: '#d97706' }}>{' · on pace for '}{fmtHrs(r.projected_hours)} hrs ({r.projected_pct}%) with {fmtHrs(r.scheduled_remaining)} still scheduled</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* your words */}
      {canSettings && (
        <div className="card" style={{ padding: '10px 16px', marginBottom: 16 }}>
          {!editTerms ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="page-sub" style={{ flex: 1, minWidth: 240, fontSize: 12.5 }}>Your company calls them <b>{T.clients}</b> and <b>{T.projects}</b>. Change the words anytime — access and data stay exactly the same.</div>
              <button className="btn btn-ghost" onClick={() => setEditTerms({ ...T })}>✎ Change words</button>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>What does your company call them?</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                {[['client', 'One client (e.g. Account)'], ['clients', 'Many (e.g. Accounts)'], ['project', 'One project (e.g. Campaign)'], ['projects', 'Many (e.g. Campaigns)']].map(([k, ph]) => (
                  <label key={k} style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>{ph}
                    <input className="cl-in" style={{ marginTop: 4 }} maxLength={30} value={editTerms[k]} onChange={e => setEditTerms(t => ({ ...t, [k]: e.target.value }))} /></label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-primary" disabled={busy} onClick={saveTerms}>Save words</button>
                <button className="btn btn-ghost" onClick={() => setEditTerms(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="cl">
        {/* ---------- list ---------- */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid var(--line)', display: 'grid', gap: 8 }}>
            <input className="cl-in" placeholder={`Search ${T.clients.toLowerCase()} & ${T.projects.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} />
            {canAddClients && (adding === null
              ? <button className="btn btn-primary" onClick={() => setAdding({ name: '', invoicing: true, tasks: true })}>＋ Add {T.client.toLowerCase()}</button>
              : <div style={{ display: 'grid', gap: 8 }}>
                  <input className="cl-in" autoFocus maxLength={80} placeholder={`${T.client} name — e.g. Acme Corp`} value={adding.name}
                    onChange={e => setAdding(a => ({ ...a, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addClient(); if (e.key === 'Escape') setAdding(null) }} />
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
                    {fin?.manager && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={adding.invoicing} onChange={e => setAdding(a => ({ ...a, invoicing: e.target.checked }))} /> Invoicing</label>}
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={adding.tasks} onChange={e => setAdding(a => ({ ...a, tasks: e.target.checked }))} /> Task management</label>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" disabled={busy || !adding.name.trim()} onClick={addClient}>Add</button>
                    <button className="btn btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
                  </div>
                </div>)}
          </div>
          {hoursOk && <div className="page-sub" style={{ padding: '6px 12px', fontSize: 11, borderBottom: '1px solid var(--line)' }}>Weekly hours · {weekLabel}</div>}
          {shown.length === 0 && <div className="page-sub" style={{ padding: 16, fontSize: 13 }}>{clients.length ? 'Nothing matches your search.' : `No ${T.clients.toLowerCase()} yet.`}</div>}
          {shown.map(c => {
            const n = projects.filter(p => p.client_id === c.id).length
            const hr = hours[c.id], cp = hr && Number(hr.cap) > 0 ? hr.pct : null
            return (
              <button key={c.id} className={'cl-item' + (sel === c.id ? ' on' : '')} onClick={() => { setSel(c.id); setMsg(null); setRenaming(null); setSure(null) }}>
                <span style={{ fontSize: 18 }}>🏢</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                  <span className="page-sub" style={{ fontSize: 12 }}>{n} {n === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()}{fin?.manager && parents[c.id] ? ` · under ${clients.find(x => x.id === parents[c.id])?.name || 'another client'}` : ''}</span>
                </span>
                {hoursOk && cp != null && <span className="cl-chip" style={{ color: capColor(cp) }} title="This week's hours vs cap">{cp}%</span>}
              </button>
            )
          })}
          <button className={'cl-item' + (sel === INTERNAL ? ' on' : '')} onClick={() => { setSel(INTERNAL); setMsg(null); setSure(null) }}>
            <span style={{ fontSize: 18 }}>🏠</span>
            <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Internal {T.projects.toLowerCase()}</span>
              <span className="page-sub" style={{ fontSize: 12 }}>No {T.client.toLowerCase()} · {internalCount}</span></span>
          </button>
          {archivedClients.length > 0 && (
            <div>
              <button className="cl-item" style={{ fontSize: 13, color: 'var(--ink-soft)', borderBottom: 0 }} onClick={() => setShowArchived(v => !v)}>
                📦 Archived {T.clients.toLowerCase()} ({archivedClients.length}) <span style={{ marginLeft: 'auto' }}>{showArchived ? '▾' : '▸'}</span>
              </button>
              {showArchived && archivedClients.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 8px', fontSize: 13 }}>
                  <span style={{ flex: 1, color: 'var(--ink-soft)' }}>{c.name}</span>
                  {canAddClients && <button className="cl-link" onClick={() => restoreClient(c)}>↩ Restore</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---------- detail ---------- */}
        <div className="card" style={{ padding: 0 }}>
          {/* header */}
          <div className="cl-sec" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {sel !== INTERNAL && renaming?.kind === 'client' ? (
              <>
                <input className="cl-in" style={{ maxWidth: 320 }} autoFocus maxLength={80} value={renaming.name}
                  onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null) }} />
                <button className="btn btn-primary" disabled={busy} onClick={saveRename}>Save</button>
                <button className="btn btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{sel === INTERNAL ? `Internal ${T.projects.toLowerCase()}` : selClient?.name}</div>
                  <div className="page-sub" style={{ fontSize: 12.5 }}>
                    {sel === INTERNAL ? `${T.projects} that don't belong to a ${T.client.toLowerCase()} — your own team's work.`
                      : `${theirProjects.length} ${theirProjects.length === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()} · ${taskCounts[sel] || 0} task${(taskCounts[sel] || 0) === 1 ? '' : 's'} · ${scheduleCounts[sel] || 0} schedule${(scheduleCounts[sel] || 0) === 1 ? '' : 's'}`}
                  </div>
                </div>
                {sel !== INTERNAL && canEdit && <button className="btn btn-ghost" onClick={() => setRenaming({ kind: 'client', id: sel, name: selClient?.name || '' })}>✎ Rename</button>}
                {sel !== INTERNAL && canAddClients && (
                  <button className="btn btn-ghost" style={{ color: '#B91C1C' }} disabled={busy}
                    title={theirProjects.length ? `Archives it together with its ${theirProjects.length} ${theirProjects.length === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()} — restore them all from 📦 Archived` : 'Recoverable — restore from 📦 Archived'}
                    onClick={() => archiveClient(selClient)}>{sure === sel ? (theirProjects.length ? `Archive with ${theirProjects.length} ${theirProjects.length === 1 ? T.project.toLowerCase() : T.projects.toLowerCase()}?` : 'Click to confirm') : 'Archive'}</button>
                )}
              </>
            )}
          </div>

          {/* projects */}
          <div className="cl-sec">
            <h3>{T.projects}</h3>
            {theirProjects.length === 0 && <div className="page-sub" style={{ padding: '4px 0 8px', fontSize: 13 }}>No {T.projects.toLowerCase()} yet{canProjectsFor(sel) ? ' — add the first one below.' : '.'}</div>}
            {theirProjects.map(p => (
              <div key={p.id} className="cl-proj">
                <span className="cl-dot" style={{ background: p.color || '#64748B' }} />
                {renaming?.kind === 'project' && renaming.id === p.id ? (
                  <>
                    <input className="cl-in" style={{ maxWidth: 280 }} autoFocus maxLength={80} value={renaming.name}
                      onChange={e => setRenaming(r => ({ ...r, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(null) }} />
                    <button className="cl-link" onClick={saveRename}>Save</button><button className="cl-link" style={{ color: 'var(--ink-soft)' }} onClick={() => setRenaming(null)}>Cancel</button>
                  </>
                ) : <div style={{ flex: 1, minWidth: 180, fontWeight: 600, fontSize: 14 }}>{p.name}{p.description ? <div className="page-sub" style={{ fontSize: 12, fontWeight: 400 }}>{p.description}</div> : null}</div>}
                {canProject(p) && renaming?.id !== p.id && (
                  <>
                    <button className="cl-link" onClick={() => setRenaming({ kind: 'project', id: p.id, name: p.name })}>✎ Rename</button>
                    <select className="cl-in" style={{ width: 'auto', padding: '4px 8px', fontSize: 12.5 }} value="" disabled={busy}
                      onChange={e => e.target.value && moveProject(p, e.target.value)} aria-label="Move to">
                      <option value="">Move to…</option>
                      {clients.filter(c => c.id !== p.client_id && canProjectsFor(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      {p.client_id && projScope.all && <option value={INTERNAL}>Internal {T.projects.toLowerCase()}</option>}
                    </select>
                    <button className="cl-link" style={{ color: '#B91C1C' }} disabled={busy} onClick={() => archiveProject(p)}>{sure === p.id ? 'Click to confirm' : 'Archive'}</button>
                  </>
                )}
              </div>
            ))}
            {(canProjectsFor(sel) || (sel === INTERNAL && projScope.all)) ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input className="cl-in" maxLength={80} placeholder={`New ${T.project.toLowerCase()} — e.g. Web Leads`} value={newProject}
                  onChange={e => setNewProject(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addProject() }} />
                <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} disabled={busy || !newProject.trim()} onClick={addProject}>＋ Add {T.project.toLowerCase()}</button>
              </div>
            ) : sel !== INTERNAL && <div className="page-sub" style={{ fontSize: 12.5, marginTop: 8 }}>Adding or changing {T.projects.toLowerCase()} needs “Create and manage projects” for this {T.client.toLowerCase()}.</div>}
          </div>

          {/* this week's hours (unchanged numbers; caps are set in Finance) */}
          {sel !== INTERNAL && hoursOk && h && (
            <div className="cl-sec">
              <h3>This week's hours · {weekLabel}</h3>
              {cap > 0 ? (
                <div style={{ maxWidth: 460 }}>
                  <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--line-soft, var(--line))', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0, width: `${Math.min(h.projected_pct || 0, 100)}%`, background: capColor(h.projected_pct), opacity: 0.22 }} />
                    <div style={{ position: 'absolute', inset: 0, width: `${Math.min(h.pct || 0, 100)}%`, background: capColor(h.pct) }} />
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 5 }}>
                    <span style={{ color: capColor(h.pct), fontWeight: 700 }}>{fmtHrs(h.delivered_hours)}</span>{` of ${fmtHrs(cap)} hrs (${h.pct}%)`}
                    {h.scheduled_remaining > 0 && ` · ${fmtHrs(h.scheduled_remaining)} still scheduled`}
                    {h.projected_pct >= 100 && h.pct < 100 && <span style={{ color: '#d97706', fontWeight: 600 }}>{` · on pace for ${h.projected_pct}%`}</span>}
                  </div>
                </div>
              ) : <div className="page-sub" style={{ fontSize: 12.5 }}>{fmtHrs(h.delivered_hours)} hrs this week · no cap set</div>}
              {fin?.manager && <a href="/finance" style={{ fontSize: 12.5, display: 'inline-block', marginTop: 6 }} title="Caps are set in Finance: weekly or monthly, with dates and your own alert levels">{cap > 0 ? 'Manage caps' : 'Set a cap'} in Finance →</a>}
              <div className="page-sub" style={{ fontSize: 11.5, marginTop: 6 }}>Alerts at {THRESHOLDS.join('% / ')}% of cap. Hours: Five9 billable time for dialer {T.clients.toLowerCase()}, claimed shift hours for back-office {T.clients.toLowerCase()}, plus task timers and auto-billed meetings (Mon–Sun, ET).</div>
            </div>
          )}

          {/* settings */}
          {sel !== INTERNAL && selClient && (
            <div className="cl-sec" style={{ borderBottom: 0 }}>
              <h3>Settings</h3>
              <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: canEdit ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={selClient.show_in_tasks !== false} disabled={!canEdit} onChange={e => setFlag(selClient, { p_show_in_tasks: e.target.checked })} />
                  <span><b>Task management</b> <span className="page-sub" style={{ fontSize: 12 }}>— offer this {T.client.toLowerCase()} in task dropdowns</span></span>
                </label>
                {fin?.manager && (parents[selClient.id]
                  ? <div className="page-sub" style={{ fontSize: 12.5 }}>Billed under <b>{clients.find(x => x.id === parents[selClient.id])?.name || 'another client'}</b> (set in Finance).</div>
                  : <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={invoicing[selClient.id] !== false} onChange={e => setFlag(selClient, { p_in_invoicing: e.target.checked })} />
                      <span><b>Invoicing</b> <span className="page-sub" style={{ fontSize: 12 }}>— include this {T.client.toLowerCase()}'s hours in Finance billing</span></span>
                    </label>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
