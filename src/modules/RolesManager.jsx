import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { hasPerm, loadPermissions } from '../lib/permissions'

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

export default function RolesManager() {
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
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>Access & Permissions</h1>
          <p className="page-sub" style={{ margin: '4px 0 0' }}>Create as many roles as you need. Check exactly what each role can do — and when you give a role to someone, choose which projects and clients it applies to.</p>
        </div>
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
                {peopleOf(draft.id).length === 0 ? <div className="page-sub" style={{ fontSize: 12.5 }}>Nobody yet. (Giving roles to people comes next, on each person's Access tab.)</div>
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
