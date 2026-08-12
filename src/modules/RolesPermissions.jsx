import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// Roles & Permissions — admin control panel.
// Define what each role can do in each area (None / View / Write / Full).
// A person with two roles automatically gets the HIGHER level of the two in
// every area — access only ever adds, never subtracts. Owner & Admin are always
// Full everywhere. Reads/writes the rbac_* tables only.
// ============================================================

const LEVELS = [
  { v: 0, label: 'None' },
  { v: 1, label: 'View' },
  { v: 2, label: 'Write' },
  { v: 3, label: 'Full' },
]
const LEVEL_COLOR = {
  0: { bg: 'var(--bg-soft, #f2f3f5)', fg: '#8a9099' },
  1: { bg: '#e7f0fb', fg: '#1f5fa8' },
  2: { bg: '#fdf1dc', fg: '#9a6a12' },
  3: { bg: '#e7f3e7', fg: '#2e7d32' },
}

export default function RolesPermissions() {
  const { isAdmin } = useAuth()
  const [areas, setAreas] = useState([])
  const [roles, setRoles] = useState([])
  const [grants, setGrants] = useState({})   // "role|area" -> level
  const [dirty, setDirty] = useState({})      // "role|area" -> true
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState(['', ''])  // combined-role preview

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  async function load() {
    setLoading(true)
    const [a, r, g] = await Promise.all([
      supabase.from('rbac_area').select('*').order('sort'),
      supabase.from('rbac_role').select('*').order('sort'),
      supabase.from('rbac_grant').select('*'),
    ])
    setAreas(a.data || [])
    setRoles(r.data || [])
    const map = {}
    ;(g.data || []).forEach(x => { map[`${x.role_key}|${x.area_key}`] = x.level })
    setGrants(map); setDirty({}); setLoading(false)
  }

  const lvl = (role, area) => grants[`${role}|${area}`] ?? 0
  function setLvl(role, area, v) {
    const k = `${role}|${area}`
    setGrants(p => ({ ...p, [k]: v }))
    setDirty(p => ({ ...p, [k]: true }))
    setMsg('')
  }

  async function save() {
    setSaving(true); setMsg('')
    const rows = Object.keys(dirty).map(k => {
      const [role_key, area_key] = k.split('|')
      return { role_key, area_key, level: grants[k] ?? 0 }
    })
    if (!rows.length) { setSaving(false); return }
    const { error } = await supabase.from('rbac_grant').upsert(rows, { onConflict: 'role_key,area_key' })
    setSaving(false)
    if (error) { setMsg('Could not save: ' + error.message); return }
    setDirty({})
    setMsg('Saved. Changes apply the next time each person signs in or refreshes.')
  }

  const dirtyCount = Object.keys(dirty).length
  const superSet = useMemo(() => new Set(roles.filter(r => r.is_super).map(r => r.key)), [roles])

  // combined-role preview (the "two roles = higher of each" rule)
  const preview = useMemo(() => {
    const chosen = pick.filter(Boolean)
    if (!chosen.length) return null
    const isSuper = chosen.some(r => superSet.has(r))
    return areas.map(a => {
      let m = 0
      if (isSuper) m = 3
      else chosen.forEach(r => { m = Math.max(m, lvl(r, a.key)) })
      return { area: a, level: m }
    })
  }, [pick, grants, areas, superSet])

  if (!isAdmin) return <div style={{ padding: 24 }}>You don't have access to this page.</div>
  if (loading) return <div style={{ padding: 24 }}>Loading roles…</div>

  const th = { position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2, padding: '8px 6px', fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textAlign: 'center', borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap' }
  const roleCell = { position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, padding: '8px 10px', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: '8px 4px 60px', maxWidth: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '4px 0 6px' }}>Roles &amp; Permissions</h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, maxWidth: 760, lineHeight: 1.6, marginTop: 0 }}>
        Set what each role can do in each area. The levels build on each other:
        {' '}<strong>View</strong> = see their own, <strong>Write</strong> = see/manage across the team,
        {' '}<strong>Full</strong> = full control. Someone with two roles automatically gets the
        {' '}higher level of the two in every area — access only ever adds, never disappears.
        {' '}Owner and Admin are always Full everywhere.
      </p>

      {/* save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 10px' }}>
        <button onClick={save} disabled={saving || !dirtyCount} className="btn btn-primary"
          style={{ opacity: dirtyCount ? 1 : .5 }}>
          {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'No changes'}
        </button>
        {msg && <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{msg}</span>}
      </div>

      {/* legend */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {LEVELS.map(L => (
          <span key={L.v} style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: LEVEL_COLOR[L.v].bg, color: LEVEL_COLOR[L.v].fg }}>
            {L.label}
          </span>
        ))}
      </div>

      {/* grid */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...th, left: 0, zIndex: 3, textAlign: 'left', paddingLeft: 10 }}>Role</th>
              {areas.map(a => <th key={a.key} style={th}>{a.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {roles.map(role => (
              <tr key={role.key}>
                <td style={roleCell}>
                  {role.label}{role.is_super && <span style={{ color: 'var(--ink-soft)', fontWeight: 500 }}> · always full</span>}
                </td>
                {areas.map(a => {
                  const v = role.is_super ? 3 : lvl(role.key, a.key)
                  const c = LEVEL_COLOR[v]
                  return (
                    <td key={a.key} style={{ padding: 4, borderBottom: '1px solid var(--line)', textAlign: 'center', background: c.bg }}>
                      {role.is_super ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: c.fg }}>Full</span>
                      ) : (
                        <select value={v} onChange={e => setLvl(role.key, a.key, Number(e.target.value))}
                          style={{ fontSize: 12, fontWeight: 600, color: c.fg, background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {LEVELS.map(L => <option key={L.v} value={L.v}>{L.label}</option>)}
                        </select>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* combined-role preview */}
      <div style={{ marginTop: 28, padding: 16, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--bg-soft, #f7f8fa)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Preview a combined role</div>
        <div style={{ color: 'var(--ink-soft)', fontSize: 13, marginBottom: 10 }}>
          Pick two roles to see what someone with both would get — the higher of each. (Alyssa, for example, is ASC + Marketing.)
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {[0, 1].map(i => (
            <select key={i} value={pick[i]} onChange={e => setPick(p => { const n = [...p]; n[i] = e.target.value; return n })}
              style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }}>
              <option value="">{i === 0 ? 'Role…' : '+ second role (optional)…'}</option>
              {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          ))}
        </div>
        {preview && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {preview.map(({ area, level }) => {
              const c = LEVEL_COLOR[level]
              return (
                <span key={area.key} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 12, background: c.bg, color: c.fg, fontWeight: 600 }}>
                  {area.label}: {LEVELS[level].label}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
