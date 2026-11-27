import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { loadPreviewAccounts, enterPreview, isPreviewing } from '../lib/rolePreview'
import useDismiss from '../lib/useDismiss'
import { isPortalStaff, PortalPopup } from './PortalMenu'
import { useWorkspace } from '../lib/workspace'
import { useLocation } from 'react-router-dom'
import { EyeIcon, MonitorIcon, UserIcon, GearIcon, HelpIcon, LogoutIcon, CaretIcon } from './HeaderIcons'

// ============================================================
// PROFILE MENU (top bar, upper right, 2026-11-02)
// Your photo or initials. Opens: View as · Portals · My Profile · Settings · Help & Support · Log out.
// View as and Portals moved here from the top bar with their rules unchanged:
//   • View as: admins only, and not while already previewing a role.
//   • Portals: Opsis staff (owner, admin, ASC, certification, quality, marketing, support), never agents, clients or
//     CSRs, and not while in training. Which portals appear still comes from the database (my_portals).
// ============================================================

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'U'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function ProfileMenu() {
  const { user, isAdmin, appRole, inTraining, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState({ full_name: '', avatar_url: '' })
  const [sub, setSub] = useState(null)                // 'viewas' | 'portals' | null
  const [accounts, setAccounts] = useState(null)
  // Workspace (11/27, Brittney): replaces "Portals". Pick a company to switch Command Center over to it,
  // or ⤢ to open that client's portal in a pop-up. No new tabs.
  const ws = useWorkspace()
  const location = useLocation()
  const portals = ws.list
  const portalErr = ''
  const [busy, setBusy] = useState(null)
  const [viewing, setViewing] = useState(null)        // portal shown in the big pop-up (kept here so it survives the menu closing)
  const wrapRef = useRef(null)
  const btnRef = useRef(null)
  const userId = user?.id || null

  const loadMe = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', userId).maybeSingle()
    if (data) setMe({ full_name: data.full_name || '', avatar_url: data.avatar_url || '' })
  }, [userId])
  useEffect(() => { loadMe() }, [loadMe])
  useEffect(() => {
    const h = () => loadMe()          // a new photo or name shows up after the ↻ button or coming back to the tab
    window.addEventListener('cc:refresh', h); window.addEventListener('focus', h)
    return () => { window.removeEventListener('cc:refresh', h); window.removeEventListener('focus', h) }
  }, [loadMe])

  const close = useCallback(() => { setOpen(false); setSub(null) }, [])
  useDismiss(wrapRef, open, close)

  const canViewAs = !!isAdmin && !isPreviewing(userId)
  const canPortals = isPortalStaff(isAdmin, appRole) && !inTraining

  useEffect(() => {
    if (sub === 'viewas' && !accounts) loadPreviewAccounts().then(setAccounts)
  }, [sub, accounts])

  if (!userId) return null
  const name = me.full_name || user?.email?.split('@')[0] || 'User'
  const email = user?.email || ''
  const ini = initialsOf(name)

  const go = (path) => { close(); navigate(path) }
  const pickRole = async (a) => {
    setBusy(a.role_key)
    try { await enterPreview(a.role_key) } catch (e) { window.alert(e.message); setBusy(null) }
  }
  const switchTo = (cid) => {
    close(); ws.set(cid)
    if (!cid && location.pathname.startsWith('/w/')) navigate('/overview')
  }
  const openPortalPop = (p) => { close(); setViewing(p) }

  const Avatar = ({ size }) => (
    <span className="hd-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {me.avatar_url ? <img src={me.avatar_url} alt="" /> : ini}
    </span>
  )

  return (
    <div ref={wrapRef} className="hd-profile">
      {canPortals && ws.current && (
        <span className="hd-ws-chip" title={`You're working in ${ws.current.name}`}>
          <button type="button" onClick={() => { setOpen(true); setSub('portals') }} aria-label={`Workspace: ${ws.current.name}. Switch workspace`}>{ws.current.name}</button>
          <button type="button" onClick={() => switchTo('')} aria-label="Back to Opsis CX" title="Back to Opsis CX">✕</button>
        </span>
      )}
      <button ref={btnRef} type="button" className="hd-avatar-btn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account menu for ${name}`} title={name}>
        <Avatar size={36} />
        <CaretIcon className="hd-avatar-caret" />
      </button>
      {open && (
        <div className="hd-menu" role="menu" aria-label="Account">
          <div className="hd-menu-head">
            <Avatar size={42} />
            <div className="hd-menu-who">
              <b>{name}</b>
              <span>{email}</span>
            </div>
          </div>
          <div className="hd-sep" />

          {canViewAs && (
            <>
              <button type="button" role="menuitem" className="hd-mi" onClick={() => setSub(s => s === 'viewas' ? null : 'viewas')} aria-expanded={sub === 'viewas'} title="See the app as another role">
                <EyeIcon /> <span className="hd-mi-label">View as</span> <CaretIcon className={'hd-mi-caret' + (sub === 'viewas' ? ' on' : '')} />
              </button>
              {sub === 'viewas' && (
                <div className="hd-sub" role="group" aria-label="View as">
                  <div className="hd-sub-note">Switch into that role's test account. You'll see exactly what they see.</div>
                  {!accounts && <div className="hd-sub-note">Loading…</div>}
                  {(accounts || []).map(a => (
                    <button key={a.role_key} type="button" role="menuitem" className="hd-mi hd-mi-sub" disabled={!!busy} onClick={() => pickRole(a)}>
                      {busy === a.role_key ? 'Switching…' : a.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {canPortals && (
            <>
              <button type="button" role="menuitem" className="hd-mi" onClick={() => setSub(s => s === 'portals' ? null : 'portals')} aria-expanded={sub === 'portals'} title="Switch which company you're working in">
                <MonitorIcon /> <span className="hd-mi-label">Workspace<small className="hd-ws-now">{ws.current ? ws.current.name : 'Opsis CX'}</small></span> <CaretIcon className={'hd-mi-caret' + (sub === 'portals' ? ' on' : '')} />
              </button>
              {sub === 'portals' && (
                <div className="hd-sub" role="group" aria-label="Workspace">
                  <div className="hd-sub-note">Pick a company to switch Command Center over to it, or ⤢ to open a client's portal in a pop-up. Changes you make are real.</div>
                  <div className="hd-portal-row">
                    <button type="button" role="menuitemradio" aria-checked={!ws.id} className={'hd-mi hd-mi-sub hd-portal' + (!ws.id ? ' hd-ws-on' : '')} onClick={() => switchTo('')} title="Switch to Opsis CX">
                      <span className="hd-portal-logo hd-portal-init" style={{ background: '#13D9E8', color: '#021116' }}>O</span>
                      <span className="hd-portal-name">Opsis CX</span>{!ws.id && <span aria-hidden="true" className="hd-portal-go">✓</span>}
                    </button>
                  </div>
                  {portals === null && <div className="hd-sub-note">Loading…</div>}
                  {portals && portals.length === 0 && <div className="hd-sub-note">No client workspaces you can open yet.</div>}
                  {(portals || []).map(p => (
                    <div key={p.client_id} className="hd-portal-row">
                      <button type="button" role="menuitemradio" aria-checked={ws.id === p.client_id} className={'hd-mi hd-mi-sub hd-portal' + (ws.id === p.client_id ? ' hd-ws-on' : '')} onClick={() => switchTo(p.client_id)} title={`Switch to ${p.name}`}>
                        {p.logo_url
                          ? <img src={p.logo_url} alt="" className="hd-portal-logo" />
                          : <span className="hd-portal-logo hd-portal-init" style={{ background: p.accent || 'var(--accent)' }}>{(p.name || '?')[0]}</span>}
                        <span className="hd-portal-name">{p.name}</span>{ws.id === p.client_id && <span aria-hidden="true" className="hd-portal-go">✓</span>}
                      </button>
                      <button type="button" className="hd-popbtn" onClick={() => openPortalPop(p)} title={`Open ${p.name} portal in a pop-up`} aria-label={`Open ${p.name} portal in a pop-up`}>⤢</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {(canViewAs || canPortals) && <div className="hd-sep" />}

          <button type="button" role="menuitem" className="hd-mi" onClick={() => go('/profile')}><UserIcon /> <span className="hd-mi-label">My Profile</span></button>
          <button type="button" role="menuitem" className="hd-mi" onClick={() => go('/settings')}><GearIcon /> <span className="hd-mi-label">Settings</span></button>
          <button type="button" role="menuitem" className="hd-mi" onClick={() => go('/help')}><HelpIcon /> <span className="hd-mi-label">Help &amp; Support</span></button>
          <div className="hd-sep" />
          <button type="button" role="menuitem" className="hd-mi" onClick={() => { close(); signOut() }}><LogoutIcon /> <span className="hd-mi-label">Log out</span></button>
        </div>
      )}
      {viewing && <PortalPopup portal={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
