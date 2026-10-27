import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ============================================================
// PORTALS ▾ (top bar, next to "View as") — 2026-10-27, Brittney
// Lists the client portals this person can open and opens one in a new tab at
// /opsis-qa?client=<id> (the same full-screen portal view as /opsis-qa).
// Who sees it: Opsis staff (owner, admin, ASC, certification, quality, marketing, support).
// Agents, clients and CSRs never do. Which portals show comes from the database
// (my_portals → can_view_portal): every portal is open to all staff unless it's set to
// "chosen people only" (clients.portal_access_restricted + portal_viewers).
// ============================================================

export const PORTAL_STAFF_ROLES = ['owner', 'admin', 'asc', 'certification', 'quality', 'marketing', 'support']
export const isPortalStaff = (isAdmin, appRole) => !!isAdmin || PORTAL_STAFF_ROLES.includes(String(appRole || '').trim().toLowerCase())

export default function PortalMenu() {
  const { isAdmin, appRole, inTraining } = useAuth()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open || list) return
    supabase.rpc('my_portals').then(({ data, error }) => { if (error) setErr(error.message); else setList(data || []) })
  }, [open, list])

  if (!isPortalStaff(isAdmin, appRole) || inTraining) return null

  const go = (p) => { setOpen(false); window.open(`/opsis-qa?client=${p.client_id}`, '_blank', 'noopener') }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost" onClick={() => setOpen(o => !o)} title="Open a client portal" aria-expanded={open}
        style={{ padding: '5px 10px', fontSize: 12.5, whiteSpace: 'nowrap' }}>🖥 Portals ▾</button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 260, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', zIndex: 81, padding: '6px 0' }}>
          <div className="page-sub" style={{ padding: '4px 12px 8px', fontSize: 11.5 }}>
            Opens the client's portal in a new tab, exactly as their account admins see it. Changes you make there are real.
          </div>
          {err && <div className="login-err" style={{ margin: '4px 12px' }}>{err}</div>}
          {!list && !err && <div className="page-sub" style={{ padding: '6px 12px', fontSize: 12.5 }}>Loading…</div>}
          {list && list.length === 0 && <div className="page-sub" style={{ padding: '6px 12px', fontSize: 12.5 }}>No portals you can open yet.</div>}
          {(list || []).map(p => (
            <button key={p.client_id} role="menuitem" onClick={() => go(p)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '8px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--canvas)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              {p.logo_url
                ? <img src={p.logo_url} alt="" style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6, background: '#fff', border: '1px solid var(--line)' }} />
                : <span style={{ width: 28, height: 28, borderRadius: 6, background: p.accent || 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>{(p.name || '?')[0]}</span>}
              <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
              <span aria-hidden="true" style={{ color: 'var(--ink-soft)' }}>↗</span>
            </button>
          ))}
        </div>
      </>)}
    </div>
  )
}

// Full-screen portal for staff at /opsis-qa (?client=<id>, GarageCo when none is given).
// Checks access through my_portals, then renders the same portal with that client's logo.
export function StaffPortal({ OpsisQAPortal, defaultLogo, hasCsrs, onSignOut }) {
  const params = new URLSearchParams(window.location.search)
  const wanted = params.get('client')
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let alive = true
    supabase.rpc('my_portals').then(({ data, error }) => {
      if (!alive) return
      if (error) return setState({ error: error.message })
      const list = data || []
      const pick = wanted ? list.find(p => p.client_id === wanted) : (list.find(p => /garageco/i.test(p.name)) || list[0])
      if (!pick) return setState({ error: wanted ? "You don't have access to this client's portal, or it doesn't exist." : 'No client portals are available to you yet.' })
      document.title = `${pick.name} portal · Opsis QA`
      setState({ portal: pick })
    })
    return () => { alive = false }
  }, [wanted])
  if (state.loading) return <div className="loading-screen">Loading portal…</div>
  if (state.error) return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <p style={{ margin: '0 0 14px' }}>{state.error}</p>
        <a className="btn btn-primary" href="/">Back to Command Center</a>
      </div>
    </div>
  )
  const p = state.portal
  return <OpsisQAPortal key={p.client_id} staff clientId={p.client_id} logo={p.logo_url || defaultLogo} hasCsrs={hasCsrs} csrMode="staff"
    onClassic={() => { window.location.href = '/call-qa' }} onSignOut={onSignOut} />
}
