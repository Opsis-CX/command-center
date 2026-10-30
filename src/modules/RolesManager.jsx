import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, loadPermissions, permScope, isAccessOwner } from '../lib/permissions'

// ============================================================
// ROLES & PERMISSIONS — self-service (2026-10-29)
// Unlimited, renameable roles. Five9-style grid: one row per module, one checkbox per
// action. Owner is the only protected role. Everything is enforced by the database
// (access_roles / access_role_permissions RLS + safety triggers) — this screen just edits.
// ============================================================

const ACTIONS = [
  ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'],
  ['approve', 'Approve'], ['export', 'Export'], ['manage', 'Manage'],
]
const ICONS = ['👤', '🛡️', '🧭', '🎧', '📊', '🧑‍🏫', '🧲', '💼', '🛠️', '⭐', '🧪', '📞']
const COLORS = ['#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#16A34A', '#B45309', '#475569']

const CSS = `
.rm { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .rm { grid-template-columns: 1fr; } }
.rm-list { padding: 0; overflow: hidden; }
.rm-list-head { padding: 12px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
.rm-search { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; font: inherit; font-size: 13.5px; background: var(--surface); color: var(--ink); }
.rm-role { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: transparent; padding: 11px 12px; cursor: pointer; font-family: inherit; color: var(--ink); }
.rm-role:hover { background: var(--canvas); }
.rm-role.on { background: var(--accent-bg, rgba(0,119,182,.08)); box-shadow: inset 3px 0 0 var(--accent); }
.rm-dot { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; font-size: 16px; flex: none; }
.rm-badge { font-size: 10.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--canvas); color: var(--ink-soft); }
.rm-grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.rm-grid th { text-align: center; font-size: 11.5px; font-weight: 700; color: var(--ink-soft); padding: 8px 4px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); z-index: 1; }
.rm-grid th:first-child { text-align: left; padding-left: 14px; }
.rm-grid td { text-align: center; padding: 7px 4px; border-bottom: 1px solid var(--line); }
.rm-grid td:first-child { text-align: left; padding-left: 14px; font-weight: 600; }
.rm-grid tr.grp td { background: var(--canvas); font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); padding: 8px 14px; }
.rm-grid tr:hover td:not(.na) { background: rgba(0,119,182,.03); }
.rm-cb { width: 17px; height: 17px; accent-color: var(--accent); cursor: pointer; }
.rm-cb:disabled { cursor: not-allowed; }
.rm-na { color: var(--line); }
.rm-row-all { border: 0; background: transparent; color: var(--accent); font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit; padding: 2px 4px; }
.rm-admin { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 16px; padding: 10px 14px; }
.rm-admin label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.rm-swatch { width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; padding: 0; }
.rm-swatch.on { border-color: var(--ink); }
.rm-icon { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-size: 16px; padding: 0; }
.rm-icon.on { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,119,182,.2); }
.rm-msg { padding: 9px 12px; border-radius: 9px; font-size: 13px; margin-bottom: 12px; }
.rm-msg.ok { background: #ECFDF5; color: #047857; }
.rm-msg.err { background: #FEF2F2; color: #B91C1C; }
.rm-chip { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--canvas); color: var(--ink); margin: 2px 4px 2px 0; }
`

function RolesTab() {
  const [catalog, setCatalog] = useState([])
  const [roles, setRoles] = useState([])
  const [grants, setGrants] = useState([])          // { role_id, perm_key }
  const [assigns, setAssigns] = useState([])        // access_assignments
  const [people, setPeople] = useState({})          // id → name
  const [projects, setProjects] = useState({})      // id → name
  const [clients, setClients] = useState({})        // id → name
  const [selId, setSelId] = useState(null)          // role id or 'new'
  const [draft, setDraft] = useState(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)              // { kind: 'ok'|'err', text }
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const canEdit = hasPerm('admin.roles')

  const load = useCallback(async () => {
    const [c, r, g, a, p, pr, cl] = await Promise.all([
      supabase.from('perm_catalog').select('*').order('sort'),
      supabase.from('access_roles').select('*').is('archived_at', null).order('sort').order('name'),
      supabase.from('access_role_permissions').select('role_id, perm_key'),
      supabase.from('access_assignments').select('*'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true),
      supabase.from('projects').select('id, name'),
      supabase.from('clients').select('id, name'),
    ])
    setCatalog(c.data || []); setRoles(r.data || []); setGrants(g.data || []); setAssigns(a.data || [])
    setPeople(Object.fromEntries((p.data || []).map(x => [x.id, x.full_name])))
    setProjects(Object.fromEntries((pr.data || []).map(x => [x.id, x.name])))
    setClients(Object.fromEntries((cl.data || []).map(x => [x.id, x.name])))
    setLoading(false)
    return r.data || []
  }, [])
  useEffect(() => { load().then(rs => { if (rs.length && !selId) setSelId(rs[0].id) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const permsOf = useCallback((roleId) => new Set(grants.filter(g => g.role_id === roleId).map(g => g.perm_key)), [grants])
  const peopleOf = (roleId) => assigns.filter(a => a.role_id === roleId)

  // open a role into the editor
  useEffect(() => {
    if (selId === 'new') return
    const r = roles.find(x => x.id === selId)
    if (r) setDraft({ id: r.id, name: r.name, description: r.description || '', icon: r.icon || '👤', color: r.color || '#0F766E', is_owner: r.is_owner, is_starter: r.is_starter, perms: permsOf(r.id) })
  }, [selId, roles, permsOf])

  const original = useMemo(() => {
    if (!draft || draft.id === null) return null
    const r = roles.find(x => x.id === draft.id)
    return r ? { name: r.name, description: r.description || '', icon: r.icon || '👤', color: r.color || '#0F766E', perms: permsOf(r.id) } : null
  }, [draft, roles, permsOf])
  const dirty = !!draft && (draft.id === null || !original || draft.name !== original.name || draft.description !== original.description
    || draft.icon !== original.icon || draft.color !== original.color || draft.perms.size !== original.perms.size || [...draft.perms].some(k => !original.perms.has(k)))

  // group the catalog: group → module → { label, cells: { action → key }, items }
  const groups = useMemo(() => {
    const out = []
    for (const c of catalog) {
      let g = out.find(x => x.name === c.module_group)
      if (!g) { g = { name: c.module_group, modules: [] }; out.push(g) }
      let m = g.modules.find(x => x.module === c.module)
      if (!m) { m = { module: c.module, label: c.module_label, cells: {}, items: [] }; g.modules.push(m) }
      m.cells[c.action] = c; m.items.push(c)
    }
    return out
  }, [catalog])

  const locked = !canEdit || draft?.is_owner
  const has = (k) => draft?.is_owner || draft?.perms.has(k)
  const toggle = (k) => { if (locked) return; setDraft(d => { const p = new Set(d.perms); p.has(k) ? p.delete(k) : p.add(k); return { ...d, perms: p } }) }
  const setMany = (keys, on) => { if (locked) return; setDraft(d => { const p = new Set(d.perms); keys.forEach(k => on ? p.add(k) : p.delete(k)); return { ...d, perms: p } }) }

  function newRole(from) {
    if (!canEdit) return
    if (dirty && !confirmLeave()) return
    setSelId('new'); setMsg(null)
    setDraft({ id: null, name: from ? `${from.name} (copy)` : 'New role', description: from ? from.description : '', icon: from ? from.icon : '👤',
      color: from ? from.color : '#2563EB', is_owner: false, is_starter: false, perms: from ? new Set(from.is_owner ? catalog.map(c => c.key) : from.perms) : new Set() })
  }
  function pick(id) {
    if (id === selId) return
    if (dirty && !confirmLeave()) return
    setMsg(null); setSelId(id)
  }
  const [leaveAsk, setLeaveAsk] = useState(false)
  function confirmLeave() { if (leaveAsk) { setLeaveAsk(false); return true } setLeaveAsk(true); setMsg({ kind: 'err', text: 'You have unsaved changes — save them, or click again to discard.' }); return false }

  async function save() {
    if (!draft || !canEdit) return
    const name = draft.name.trim()
    if (!name) return setMsg({ kind: 'err', text: 'Give the role a name.' })
    if (roles.some(r => r.id !== draft.id && r.name.toLowerCase() === name.toLowerCase())) return setMsg({ kind: 'err', text: `There's already a role called “${name}”.` })
    setSaving(true); setMsg(null)
    try {
      let id = draft.id
      const fields = { name, description: draft.description.trim() || null, icon: draft.icon, color: draft.color }
      if (!id) {
        const { data, error } = await supabase.from('access_roles').insert({ ...fields, sort: 100 }).select().single()
        if (error) throw error
        id = data.id
      } else {
        const { error } = await supabase.from('access_roles').update(fields).eq('id', id)
        if (error) throw error
      }
      if (!draft.is_owner) {
        const before = draft.id ? permsOf(id) : new Set()
        const add = [...draft.perms].filter(k => !before.has(k))
        const remove = [...before].filter(k => !draft.perms.has(k))
        if (remove.length) { const { error } = await supabase.from('access_role_permissions').delete().eq('role_id', id).in('perm_key', remove); if (error) throw error }
        if (add.length) { const { error } = await supabase.from('access_role_permissions').insert(add.map(k => ({ role_id: id, perm_key: k }))); if (error) throw error }
      }
      await load(); setSelId(id); setLeaveAsk(false)
      await loadPermissions(supabase)   // my own menus update right away if I changed a role I hold
      setMsg({ kind: 'ok', text: `Saved “${name}”.` })
    } catch (e) {
      setMsg({ kind: 'err', text: friendly(e) })
    } finally { setSaving(false) }
  }

  async function archive() {
    if (!draft?.id || draft.is_owner || !canEdit) return
    const n = peopleOf(draft.id).length
    if (n) return setMsg({ kind: 'err', text: `${n} ${n === 1 ? 'person has' : 'people have'} this role. Move them to another role first.` })
    if (!leaveAsk) { setLeaveAsk(true); return setMsg({ kind: 'err', text: `Click Archive again to archive “${draft.name}”.` }) }
    const { error } = await supabase.from('access_roles').update({ archived_at: new Date().toISOString() }).eq('id', draft.id)
    if (error) return setMsg({ kind: 'err', text: friendly(error) })
    setLeaveAsk(false)
    const rs = await load(); setSelId(rs[0]?.id || null); setMsg({ kind: 'ok', text: 'Role archived.' })
  }

  if (loading) return <div className="page-sub" style={{ padding: 20 }}>Loading roles…</div>
  const shown = roles.filter(r => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
  const scopeText = (a) => a.scope_type === 'all' ? ['Everything']
    : [...(a.client_ids || []).map(id => clients[id] || 'Client'), ...(a.project_ids || []).map(id => projects[id] || 'Project')]

  return (
    <div>
      <style>{CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <p className="page-sub" style={{ margin: 0 }}>Create as many roles as you need and check exactly what each one can do. When you give a role to someone (People tab), you choose which projects and clients it applies to.</p>
        {canEdit && <button className="btn btn-primary" onClick={() => newRole(null)}>＋ Create role</button>}
      </div>
      {!canEdit && <div className="rm-msg err" style={{ background: 'var(--canvas)', color: 'var(--ink-soft)' }}>You can look at roles, but changing them needs the “Create and edit roles” permission.</div>}

      <div className="rm">
        {/* ---------- role list ---------- */}
        <div className="card rm-list">
          <div className="rm-list-head">
            <input className="rm-search" placeholder="Search roles…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search roles" />
            <div className="page-sub" style={{ fontSize: 12 }}>{roles.length} role{roles.length === 1 ? '' : 's'}</div>
          </div>
          {selId === 'new' && draft && (
            <button className="rm-role on"><span className="rm-dot" style={{ background: draft.color + '22' }}>{draft.icon}</span><span style={{ flex: 1, fontWeight: 700 }}>{draft.name || 'New role'}</span><span className="rm-badge">New</span></button>
          )}
          {shown.map(r => {
            const n = peopleOf(r.id).length
            return (
              <button key={r.id} className={'rm-role' + (r.id === selId ? ' on' : '')} onClick={() => pick(r.id)}>
                <span className="rm-dot" style={{ background: (r.color || '#0F766E') + '22' }}>{r.icon || '👤'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                  <span className="page-sub" style={{ fontSize: 12 }}>{n} {n === 1 ? 'person' : 'people'}</span>
                </span>
                {r.is_owner ? <span className="rm-badge" title="Protected">🔒 Protected</span> : r.is_starter ? <span className="rm-badge">Starter</span> : <span className="rm-badge">Custom</span>}
              </button>
            )
          })}
        </div>

        {/* ---------- editor ---------- */}
        {draft && (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
              {msg && <div className={'rm-msg ' + msg.kind}>{msg.text}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1.4fr)', gap: 12 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Role name</label>
                  <input value={draft.name} disabled={!canEdit} maxLength={60} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Description</label>
                  <input value={draft.description} disabled={!canEdit} maxLength={200} placeholder="What is this role for?" onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
                </div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}><span className="page-sub" style={{ fontSize: 12, marginRight: 4 }}>Icon</span>
                    {ICONS.map(i => <button key={i} className={'rm-icon' + (draft.icon === i ? ' on' : '')} onClick={() => setDraft(d => ({ ...d, icon: i }))} aria-label={'Icon ' + i}>{i}</button>)}</div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span className="page-sub" style={{ fontSize: 12, marginRight: 4 }}>Color</span>
                    {COLORS.map(c => <button key={c} className={'rm-swatch' + (draft.color === c ? ' on' : '')} style={{ background: c }} onClick={() => setDraft(d => ({ ...d, color: c }))} aria-label={'Color ' + c} />)}</div>
                </div>
              )}
              {draft.is_owner && <div className="rm-msg" style={{ background: '#FFFBEB', color: '#92400E', margin: '12px 0 0' }}>👑 Owners always have every permission. You can rename this role, but it can't lose access or be deleted — so nobody gets locked out of their own company.</div>}
            </div>

            <div style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 300, overflow: 'auto' }}>
              <table className="rm-grid">
                <thead><tr><th style={{ width: '32%' }}>What this role can do</th>{ACTIONS.map(([a, l]) => <th key={a}>{l}</th>)}<th style={{ width: 60 }}></th></tr></thead>
                <tbody>
                  {groups.filter(g => g.name !== 'Administration').map(g => (
                    <React.Fragment key={g.name}>
                      <tr className="grp"><td colSpan={ACTIONS.length + 2}>{g.name}</td></tr>
                      {g.modules.map(m => {
                        const keys = m.items.map(i => i.key)
                        const allOn = keys.every(has)
                        return (
                          <tr key={m.module}>
                            <td>{m.label}</td>
                            {ACTIONS.map(([a]) => {
                              const c = m.cells[a]
                              if (!c) return <td key={a} className="na"><span className="rm-na">—</span></td>
                              return <td key={a} title={c.label + (c.scopeable ? ' · can be limited to projects/clients' : '')}>
                                <input type="checkbox" className="rm-cb" checked={!!has(c.key)} disabled={locked} onChange={() => toggle(c.key)} aria-label={`${m.label}: ${c.label}`} />
                              </td>
                            })}
                            <td>{!locked && <button className="rm-row-all" onClick={() => setMany(keys, !allOn)}>{allOn ? 'None' : 'All'}</button>}</td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  ))}
                  {groups.filter(g => g.name === 'Administration').map(g => (
                    <React.Fragment key={g.name}>
                      <tr className="grp"><td colSpan={ACTIONS.length + 2}>Administration — company-wide settings</td></tr>
                      <tr><td colSpan={ACTIONS.length + 2} style={{ padding: 0 }}>
                        <div className="rm-admin">
                          {g.modules.flatMap(m => m.items).map(c => (
                            <label key={c.key}><input type="checkbox" className="rm-cb" checked={!!has(c.key)} disabled={locked} onChange={() => toggle(c.key)} /> {c.label}</label>
                          ))}
                        </div>
                      </td></tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {draft.id && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Who has this role</div>
                {peopleOf(draft.id).length === 0 ? <div className="page-sub" style={{ fontSize: 12.5 }}>Nobody yet. Give it to people on the People tab.</div>
                  : peopleOf(draft.id).map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, minWidth: 150 }}>{people[a.profile_id] || 'Someone'}</span>
                      <span>{scopeText(a).map((t, i) => <span key={i} className="rm-chip">{t}</span>)}</span>
                    </div>
                  ))}
              </div>
            )}

            {canEdit && (
              <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create role'}</button>
                {dirty && <button className="btn btn-ghost" onClick={() => { setMsg(null); setLeaveAsk(false); if (draft.id) { const id = draft.id; setSelId(null); setTimeout(() => setSelId(id)) } else { setSelId(roles[0]?.id || null); setDraft(null) } }}>Discard changes</button>}
                <span style={{ flex: 1 }} />
                {draft.id && <button className="btn btn-ghost" onClick={() => newRole({ ...draft, perms: draft.perms })}>⧉ Duplicate</button>}
                {draft.id && !draft.is_owner && <button className="btn btn-ghost" style={{ color: 'var(--failed, #B91C1C)' }} onClick={archive}>Archive</button>}
                <span className="page-sub" style={{ fontSize: 12, width: '100%' }}>{draft.is_owner ? 'All permissions' : `${draft.perms.size} of ${catalog.length} permissions`}{dirty ? ' · unsaved changes' : ''}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function friendly(e) {
  const m = String(e?.message || e || '')
  if (/row-level security|permission denied/i.test(m)) return 'You don’t have permission to change roles.'
  if (/duplicate key|access_roles_name_unique/i.test(m)) return 'There’s already a role with that name.'
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong — please try again.'
}


// ============================================================
// ACCESS & PERMISSIONS — tabs (2026-10-30): Roles · People · History
// ============================================================
export default function AccessPermissions() {
  const canPeople = hasPerm('admin.assign') || hasPerm('admin.roles')
  const [tab, setTab] = useState('roles')
  const tabs = [['roles', '🛡️ Roles'], ...(canPeople ? [['people', '👥 People']] : []), ...(hasPerm('admin.audit') ? [['history', '📜 History']] : [])]
  return (
    <div>
      <style>{CSS}</style>
      <h1 className="page-title" style={{ margin: '0 0 10px' }}>Access & Permissions</h1>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ border: 0, background: 'transparent', padding: '9px 14px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            color: tab === k ? 'var(--accent)' : 'var(--ink-soft)', borderBottom: '2px solid ' + (tab === k ? 'var(--accent)' : 'transparent'), marginBottom: -1 }}>{l}</button>
        ))}
      </div>
      {tab === 'roles' && <RolesTab />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  )
}

// ---------- 👥 People: roles (scoped to clients/projects) + per-person adjustments ----------
function scopeLabel(x, clients, projects) {
  if (x.scope_type === 'all') return 'Everything'
  const names = [...(x.client_ids || []).map(id => clients.find(c => c.id === id)?.name), ...(x.project_ids || []).map(id => projects.find(p => p.id === id)?.name)].filter(Boolean)
  return names.length ? names.join(', ') : 'Nothing selected yet'
}

// Pick where something applies: Everything, or specific clients & projects.
function ScopePicker({ value, onChange, clients, projects, inMyScope, myAll }) {
  const { scope_type, client_ids = [], project_ids = [] } = value
  const toggle = (key, id) => {
    const list = value[key] || []
    onChange({ ...value, [key]: list.includes(id) ? list.filter(x => x !== id) : [...list, id] })
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 13.5, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="radio" checked={scope_type === 'scoped'} onChange={() => onChange({ ...value, scope_type: 'scoped' })} /> Only these clients & projects</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: myAll ? 'pointer' : 'not-allowed', opacity: myAll ? 1 : .5 }} title={myAll ? '' : 'Only people with access to everything can give access to everything'}>
          <input type="radio" disabled={!myAll} checked={scope_type === 'all'} onChange={() => onChange({ ...value, scope_type: 'all', client_ids: [], project_ids: [] })} /> Everything</label>
      </div>
      {scope_type === 'scoped' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div><div className="page-sub" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Clients</div>
            {clients.filter(c => inMyScope('c', c.id)).map(c => (
              <label key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, padding: '2px 0', cursor: 'pointer' }}>
                <input type="checkbox" className="rm-cb" checked={client_ids.includes(c.id)} onChange={() => toggle('client_ids', c.id)} /> {c.name}</label>))}
          </div>
          <div><div className="page-sub" style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Projects</div>
            {projects.filter(p => inMyScope('p', p.id)).map(p => (
              <label key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, padding: '2px 0', cursor: 'pointer' }}>
                <input type="checkbox" className="rm-cb" checked={project_ids.includes(p.id)} onChange={() => toggle('project_ids', p.id)} /> {p.name}</label>))}
          </div>
        </div>
      )}
    </div>
  )
}

function PeopleTab() {
  const [people, setPeople] = useState([])
  const [roles, setRoles] = useState([])
  const [grants, setGrants] = useState([])
  const [assigns, setAssigns] = useState([])
  const [overrides, setOverrides] = useState([])
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [catalog, setCatalog] = useState([])
  const [selId, setSelId] = useState(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(null)       // { role_id, scope_type, client_ids, project_ids }
  const [adjusting, setAdjusting] = useState(null) // { perm_key, effect, scope_type, client_ids, project_ids }
  const isOwner = isAccessOwner()
  const myScope = permScope('admin.assign')
  const canAssign = hasPerm('admin.assign')

  const load = useCallback(async () => {
    const [p, r, g, a, o, pr, cl, c] = await Promise.all([
      supabase.from('profiles').select('id, full_name, job_title, email').eq('is_active', true).is('client_id', null).order('full_name'),
      supabase.from('access_roles').select('*').is('archived_at', null).order('sort').order('name'),
      supabase.from('access_role_permissions').select('role_id, perm_key'),
      supabase.from('access_assignments').select('*'),
      supabase.from('access_overrides').select('*'),
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('perm_catalog').select('*').order('sort'),
    ])
    setPeople(p.data || []); setRoles(r.data || []); setGrants(g.data || []); setAssigns(a.data || []); setOverrides(o.data || [])
    setProjects(pr.data || []); setClients(cl.data || []); setCatalog(c.data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const roleById = Object.fromEntries(roles.map(r => [r.id, r]))
  const catByKey = Object.fromEntries(catalog.map(c => [c.key, c]))
  const permsOf = (roleId) => grants.filter(g => g.role_id === roleId).map(g => g.perm_key)
  const grantable = (r) => r.is_owner ? isOwner : permsOf(r.id).every(k => hasPerm(k))
  const inMyScope = (kind, id) => myScope.all || (kind === 'p' ? myScope.projects.includes(id) : myScope.clients.includes(id))
  const sel = people.find(x => x.id === selId)
  const mine = assigns.filter(a => a.profile_id === selId)
  const myAdj = overrides.filter(o => o.profile_id === selId)
  const defaultScope = () => myScope.all ? { scope_type: 'scoped', client_ids: [], project_ids: [] } : { scope_type: 'scoped', client_ids: [...myScope.clients], project_ids: [...myScope.projects] }

  async function run(fn, ok) {
    setBusy(true); setMsg(null)
    const { error } = await fn()
    setBusy(false)
    if (error) { setMsg({ kind: 'err', text: friendly(error) }); return false }
    await load(); if (ok) setMsg({ kind: 'ok', text: ok }); return true
  }
  async function addRole() {
    const r = roleById[adding?.role_id]; if (!r || !sel) return
    const scoped = !r.is_owner && adding.scope_type === 'scoped'
    if (scoped && !adding.client_ids.length && !adding.project_ids.length) return setMsg({ kind: 'err', text: 'Pick at least one client or project — or choose Everything.' })
    if (await run(() => supabase.from('access_assignments').insert({ profile_id: sel.id, role_id: r.id, scope_type: scoped ? 'scoped' : 'all',
      client_ids: scoped ? adding.client_ids : [], project_ids: scoped ? adding.project_ids : [] }), `Gave ${sel.full_name} the ${r.name} role.`)) setAdding(null)
  }
  async function saveAdjustment() {
    const c = catByKey[adjusting?.perm_key]; if (!c || !sel) return
    const scoped = adjusting.effect === 'add' && c.scopeable && adjusting.scope_type === 'scoped'
    if (scoped && !adjusting.client_ids.length && !adjusting.project_ids.length) return setMsg({ kind: 'err', text: 'Pick at least one client or project — or choose Everything.' })
    const row = { profile_id: sel.id, perm_key: c.key, effect: adjusting.effect, scope_type: scoped ? 'scoped' : 'all', client_ids: scoped ? adjusting.client_ids : [], project_ids: scoped ? adjusting.project_ids : [] }
    if (await run(() => supabase.from('access_overrides').upsert(row, { onConflict: 'profile_id,perm_key' }),
      `${adjusting.effect === 'add' ? 'Added' : 'Removed'} “${c.label}” for ${sel.full_name.split(' ')[0]}.`)) setAdjusting(null)
  }
  const [sure, setSure] = useState(null)
  async function removeRow(table, row, label) {
    if (sure !== row.id) { setSure(row.id); return }
    setSure(null)
    await run(() => supabase.from(table).delete().eq('id', row.id), label)
  }

  // What this person can do: roles + adjustments, split into client/project work vs personal tools
  const summary = useMemo(() => {
    if (!sel) return { scoped: [], personal: [] }
    const ownerHere = mine.some(a => roleById[a.role_id]?.is_owner)
    const removed = new Set(myAdj.filter(o => o.effect === 'remove').map(o => o.perm_key))
    const entries = new Map()   // key → { where:Set, everywhere:bool, adj:'add'|null }
    const addEntry = (k, src, adj) => {
      if (!ownerHere && removed.has(k)) return
      const e = entries.get(k) || { where: new Set(), everywhere: false, adj: null }
      if (src.scope_type === 'all') e.everywhere = true
      else scopeLabel(src, clients, projects).split(', ').forEach(n => n !== 'Nothing selected yet' && e.where.add(n))
      if (adj) e.adj = adj
      entries.set(k, e)
    }
    for (const a of mine) { const r = roleById[a.role_id]; if (!r) continue; (r.is_owner ? catalog.map(c => c.key) : permsOf(r.id)).forEach(k => addEntry(k, a)) }
    if (!ownerHere) myAdj.filter(o => o.effect === 'add').forEach(o => addEntry(o.perm_key, o, 'add'))
    const mods = { scoped: new Map(), personal: new Map() }
    for (const [k, e] of entries) {
      const c = catByKey[k]; if (!c) continue
      const bucket = c.scopeable ? mods.scoped : mods.personal
      if (!bucket.has(c.module_label)) bucket.set(c.module_label, [])
      const where = e.everywhere ? 'everywhere' : ([...e.where].join(', ') || 'nowhere yet')
      bucket.get(c.module_label).push({ act: c.module === 'admin' ? c.label : c.action[0].toUpperCase() + c.action.slice(1), where, adj: e.adj })
    }
    return { scoped: [...mods.scoped.entries()], personal: [...mods.personal.entries()], removed: [...removed].filter(() => !ownerHere) }
  }, [sel, mine, myAdj, roleById, catalog, clients, projects]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = people.filter(x => !q.trim() || (x.full_name || '').toLowerCase().includes(q.trim().toLowerCase()))
  const permOptions = useMemo(() => {
    const groups = {}
    catalog.forEach(c => { (groups[c.module_label] = groups[c.module_label] || []).push(c) })
    return Object.entries(groups)
  }, [catalog])

  return (
    <div className="rm">
      <div className="card rm-list">
        <div className="rm-list-head">
          <input className="rm-search" placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" />
          <div className="page-sub" style={{ fontSize: 12 }}>{people.length} people</div>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
          {shown.map(x => {
            const rs = assigns.filter(a => a.profile_id === x.id).map(a => roleById[a.role_id]).filter(Boolean)
            const nAdj = overrides.filter(o => o.profile_id === x.id).length
            return (
              <button key={x.id} className={'rm-role' + (x.id === selId ? ' on' : '')} onClick={() => { setSelId(x.id); setMsg(null); setAdding(null); setAdjusting(null) }}>
                <span className="rm-dot" style={{ background: 'var(--canvas)', fontSize: 13, fontWeight: 700 }}>{(x.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{x.full_name}</span>
                  <span className="page-sub" style={{ fontSize: 12 }}>{rs.length ? rs.map(r => r.icon + ' ' + r.name).join(' · ') : 'No roles yet'}{nAdj ? ` · ✎ ${nAdj} adjustment${nAdj === 1 ? '' : 's'}` : ''}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {!sel ? <div className="card page-sub" style={{ padding: 24 }}>Pick someone to see and change their access.</div> : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
            {msg && <div className={'rm-msg ' + msg.kind}>{msg.text}</div>}
            <div style={{ fontSize: 18, fontWeight: 800 }}>{sel.full_name}</div>
            <div className="page-sub" style={{ fontSize: 13 }}>{[sel.job_title, sel.email].filter(Boolean).join(' · ')}</div>
          </div>

          {/* ---- Roles ---- */}
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Roles</div>
            {mine.length === 0 && <div className="page-sub" style={{ fontSize: 13, marginBottom: 10 }}>No roles yet — they can't see anything until you give them one.</div>}
            {mine.map(a => <AssignmentRow key={a.id} a={a} role={roleById[a.role_id]} clients={clients} projects={projects}
              canEdit={canAssign && !!roleById[a.role_id] && grantable(roleById[a.role_id])} inMyScope={inMyScope} myAll={myScope.all}
              busy={busy} onSave={(patch) => run(() => supabase.from('access_assignments').update(patch).eq('id', a.id), 'Saved.')}
              onRemove={() => removeRow('access_assignments', a, `Removed the ${roleById[a.role_id]?.name} role.`)} sure={sure === a.id} />)}
            {canAssign && !adding && (
              <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setAdding({ role_id: '', ...defaultScope() })}>＋ Give a role</button>
            )}
            {canAssign && adding && (
              <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 12, marginTop: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Give a role</div>
                <select value={adding.role_id} onChange={e => setAdding(x => ({ ...x, role_id: e.target.value }))} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)', minWidth: 240, marginBottom: 10 }}>
                  <option value="">Choose a role…</option>
                  {roles.filter(r => !mine.some(a => a.role_id === r.id) && grantable(r)).map(r => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
                </select>
                {adding.role_id && !roleById[adding.role_id]?.is_owner && (<>
                  <div className="page-sub" style={{ fontSize: 12.5, fontWeight: 700, margin: '4px 0 6px' }}>Where does it apply?</div>
                  <ScopePicker value={adding} onChange={v => setAdding(x => ({ ...x, ...v }))} clients={clients} projects={projects} inMyScope={inMyScope} myAll={myScope.all} />
                </>)}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary" disabled={!adding.role_id || busy} onClick={addRole}>Add role</button>
                  <button className="btn btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* ---- Per-person adjustments ---- */}
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Adjust for {sel.full_name.split(' ')[0]}</div>
            <div className="page-sub" style={{ fontSize: 12.5, marginBottom: 10 }}>Fine-tune just this person without making a new role. ➖ Remove always wins over their roles.</div>
            {myAdj.length === 0 && <div className="page-sub" style={{ fontSize: 13, marginBottom: 8 }}>No adjustments — they get exactly what their roles give.</div>}
            {myAdj.map(o => {
              const c = catByKey[o.perm_key]
              return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', flexWrap: 'wrap' }}>
                  <span className="rm-chip" style={{ background: o.effect === 'add' ? '#ECFDF5' : '#FEF2F2', color: o.effect === 'add' ? '#047857' : '#B91C1C' }}>{o.effect === 'add' ? '➕ Added' : '➖ Removed'}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c ? `${c.module_label}: ${c.label}` : o.perm_key}</span>
                  {o.effect === 'add' && c?.scopeable && <span className="page-sub" style={{ fontSize: 12.5 }}>· {scopeLabel(o, clients, projects)}</span>}
                  {canAssign && <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '3px 9px', color: '#B91C1C' }} disabled={busy}
                    onClick={() => removeRow('access_overrides', o, 'Adjustment removed.')}>{sure === o.id ? 'Click to confirm' : 'Undo'}</button>}
                </div>
              )
            })}
            {canAssign && !adjusting && <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setAdjusting({ perm_key: '', effect: 'add', ...defaultScope() })}>✎ Add an adjustment</button>}
            {canAssign && adjusting && (
              <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: 12, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <select value={adjusting.effect} onChange={e => setAdjusting(x => ({ ...x, effect: e.target.value }))} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' }}>
                    <option value="add">➕ Add</option><option value="remove">➖ Remove</option>
                  </select>
                  <select value={adjusting.perm_key} onChange={e => setAdjusting(x => ({ ...x, perm_key: e.target.value }))} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)', minWidth: 280, flex: 1 }}>
                    <option value="">Choose a permission…</option>
                    {permOptions.map(([mod, items]) => (
                      <optgroup key={mod} label={mod}>
                        {items.filter(c => adjusting.effect === 'remove' || isOwner || hasPerm(c.key)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {adjusting.effect === 'add' && catByKey[adjusting.perm_key]?.scopeable && (<>
                  <div className="page-sub" style={{ fontSize: 12.5, fontWeight: 700, margin: '4px 0 6px' }}>Where does it apply?</div>
                  <ScopePicker value={adjusting} onChange={v => setAdjusting(x => ({ ...x, ...v }))} clients={clients} projects={projects} inMyScope={inMyScope} myAll={myScope.all} />
                </>)}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary" disabled={!adjusting.perm_key || busy} onClick={saveAdjustment}>Save adjustment</button>
                  <button className="btn btn-ghost" onClick={() => setAdjusting(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* ---- What they can do ---- */}
          <div style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>What {sel.full_name.split(' ')[0]} can do</div>
            {!summary.scoped.length && !summary.personal.length ? <div className="page-sub" style={{ fontSize: 13 }}>Nothing yet.</div> : (<>
              {[['For their clients & projects', summary.scoped, 'Only where shown — not anywhere else.'], ['Personal tools', summary.personal, 'Not tied to a client, so these work everywhere.']].map(([title, rows, hint]) => rows.length > 0 && (
                <div key={title} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-soft)', margin: '6px 0 2px' }}>{title}</div>
                  <div className="page-sub" style={{ fontSize: 12, marginBottom: 6 }}>{hint}</div>
                  <table className="rm-grid">
                    <tbody>
                      {rows.map(([label, acts]) => (
                        <tr key={label}><td style={{ width: '24%' }}>{label}</td><td style={{ textAlign: 'left' }}>
                          {(() => {
                            const scoped = title.startsWith('For')
                            const same = scoped && acts.every(x => x.where === acts[0].where)   // one place for the whole row → say it once
                            return (<>
                              {acts.map((x, i) => (
                                <span key={i} className="rm-chip" style={x.adj ? { background: '#ECFDF5', color: '#047857' } : undefined} title={x.adj ? 'Added just for this person' : ''}>
                                  {x.adj ? '➕ ' : ''}{x.act}{scoped && !same ? ` · ${x.where}` : ''}
                                </span>
                              ))}
                              {same && <span className="page-sub" style={{ fontSize: 12, marginLeft: 4 }}>· {acts[0].where}</span>}
                            </>)
                          })()}
                        </td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {summary.removed?.length > 0 && (
                <div className="page-sub" style={{ fontSize: 12.5 }}>➖ Removed for them: {summary.removed.map(k => catByKey[k] ? `${catByKey[k].module_label}: ${catByKey[k].label}` : k).join(' · ')}</div>
              )}
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}

function AssignmentRow({ a, role, clients, projects, canEdit, inMyScope, myAll, busy, onSave, onRemove, sure }) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState({ scope_type: a.scope_type, client_ids: a.client_ids || [], project_ids: a.project_ids || [] })
  useEffect(() => { setVal({ scope_type: a.scope_type, client_ids: a.client_ids || [], project_ids: a.project_ids || [] }) }, [a])
  if (!role) return null
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="rm-dot" style={{ background: (role.color || '#0F766E') + '22', width: 28, height: 28 }}>{role.icon}</span>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{role.name}</div>
          <div className="page-sub" style={{ fontSize: 12.5 }}>Applies to: <b>{role.is_owner ? 'Everything (Owner)' : scopeLabel(a, clients, projects)}</b></div>
        </div>
        {canEdit && !role.is_owner && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '4px 10px' }} onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Change where'}</button>}
        {canEdit && <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '4px 10px', color: '#B91C1C' }} disabled={busy} onClick={onRemove}>{sure ? 'Click to confirm' : 'Remove'}</button>}
      </div>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          <ScopePicker value={val} onChange={setVal} clients={clients} projects={projects} inMyScope={inMyScope} myAll={myAll} />
          <button className="btn btn-primary" style={{ marginTop: 10, fontSize: 13 }} disabled={busy}
            onClick={() => { onSave({ scope_type: val.scope_type, client_ids: val.scope_type === 'all' ? [] : val.client_ids, project_ids: val.scope_type === 'all' ? [] : val.project_ids }); setOpen(false) }}>Save</button>
        </div>
      )}
    </div>
  )
}

// ---------- 📜 History: every role and access change ----------
function HistoryTab() {
  const [rows, setRows] = useState(null)
  const [names, setNames] = useState({})
  const [roleNames, setRoleNames] = useState({})
  useEffect(() => {
    (async () => {
      const [l, p, r] = await Promise.all([
        supabase.from('access_audit_log').select('*').order('at', { ascending: false }).limit(200),
        supabase.from('profiles').select('id, full_name'),
        supabase.from('access_roles').select('id, name'),
      ])
      setRows(l.data || []); setNames(Object.fromEntries((p.data || []).map(x => [x.id, x.full_name]))); setRoleNames(Object.fromEntries((r.data || []).map(x => [x.id, x.name])))
    })()
  }, [])
  if (!rows) return <div className="page-sub">Loading history…</div>
  const say = (x) => {
    const who = names[x.actor_id] || 'System', role = roleNames[x.target_role] || x.detail?.name || 'a role', person = names[x.target_profile] || 'someone'
    switch (x.action) {
      case 'role.insert': return `${who} created the role “${x.detail?.name || role}”`
      case 'role.update': return `${who} updated the role “${x.detail?.name || role}”`
      case 'role.delete': return `${who} deleted the role “${x.detail?.name || role}”`
      case 'perm.add': return `${who} added “${x.detail?.perm}” to ${role}`
      case 'perm.remove': return `${who} removed “${x.detail?.perm}” from ${role}`
      case 'assign.insert': return `${who} gave ${person} the ${role} role`
      case 'assign.update': return `${who} changed where ${person}'s ${role} role applies`
      case 'assign.delete': return `${who} removed ${person}'s ${role} role`
      case 'adjust.insert': case 'adjust.update': return `${who} ${x.detail?.effect === 'remove' ? 'removed' : 'added'} “${x.detail?.perm}” ${x.detail?.effect === 'remove' ? 'for' : 'for'} ${person} (adjustment)`
      case 'adjust.delete': return `${who} undid an adjustment (“${x.detail?.perm}”) for ${person}`
      default: return `${who}: ${x.action}`
    }
  }
  return (
    <div className="card" style={{ padding: 0 }}>
      {rows.length === 0 ? <div className="page-sub" style={{ padding: 20 }}>No changes yet.</div> : rows.map(x => (
        <div key={x.id} style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
          <span className="page-sub" style={{ minWidth: 150, fontSize: 12.5 }}>{new Date(x.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          <span>{say(x)}</span>
        </div>
      ))}
    </div>
  )
}
