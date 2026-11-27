// ============================================================
//  ADMIN SETTINGS (Brittney 11/27, staging)
//  One place for every setup page: Integrations, Configuration, Access & Permissions, phone/QA setup,
//  client portal settings and the Opsis-only Backend. Reached from the account menu (top right) →
//  "Admin settings"; the setup pages left the sidebar so it only holds day-to-day work.
//  The pages themselves are unchanged and keep their own addresses and access checks; this adds the
//  left-hand settings menu around them (AdminFrame) and decides who sees which item (useAdminNav).
// ============================================================
import { NavLink, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { canAny, hasPerm, usingNewPermissions } from '../lib/permissions'
import { isPortalStaff } from './PortalMenu'
import { NEW_PAGE_PERMS } from './Sidebar'
import { useWorkspace } from '../lib/workspace'

// ws: true = a client workspace's setting (needs a client picked in Workspace)
// ws: true = saved per workspace (Opsis CX or the client picked in Workspace) — the portal's "Your setup" tools,
// which Opsis uses for itself too (Brittney 11/27).
export const ADMIN_NAV = [
  { group: 'Your setup', items: [
    { to: '/w/qasettings', label: 'QA settings', perm: '__portal', ws: true },
    { to: '/w/kb', label: 'Knowledge base (what the AI knows)', perm: '__portal', ws: true },
    { to: '/w/connect', label: 'Connect your calls', perm: '__portal', ws: true },
    { to: '/w/phonesetup', label: 'Phone setup', perm: '__portal', ws: true },
    { to: '/w/callflow', label: 'Call flow', perm: '__portal', ws: true },
    { to: '/w/team', label: 'Team & access', perm: '__portal', ws: true },
    { to: '/w/brandset', label: 'Portal settings', perm: '__portal', ws: true },
  ] },
  { group: 'Company', items: [
    { to: '/branding', label: 'Branding', perm: '__admin' },
    { to: '/dashboard-settings', label: 'Dashboard', perm: '__admin' },
    { to: '/alerts', label: 'Alerts', perm: '__admin' },
    { to: '/integrations', label: 'Integrations', perm: '__admin' },
    { to: '/chat-support', label: 'Chat support lines', perm: '__admin' },
  ] },
  { group: 'People & access', items: [
    { to: '/roles', label: 'Access & Permissions', perm: '__admin' },
    { to: '/people', label: 'People & tags', perm: 'people_and_tags.view_only' },
    { to: '/positions', label: 'Positions', perm: 'positions.view_only' },
  ] },
  { group: 'Schedule', items: [
    { to: '/schedule-settings', label: 'Schedule settings', perm: '__admin' },
    { to: '/schedule-rules', label: 'Schedule rules', perm: '__admin' },
  ] },
  { group: 'Opsis admin', items: [
    { to: '/clients', label: 'Clients', perm: 'clients.view_only' },
    { to: '/service-account', label: 'Service account', perm: '__admin' },
    { to: '/updates', label: 'Updates', perm: '__updates_post' },
    { to: '/backend/quotes', label: 'Daily quotes', perm: '__admin' },
    { to: '/backend/spotlight', label: 'Spotlight', perm: '__admin' },
    { to: '/sms-consents', label: 'SMS consent', perm: '__admin' },
    { to: '/survey', label: 'New hire survey', perm: '__admin' },
  ] },
]
const ADMIN_PATHS = new Set(ADMIN_NAV.flatMap(g => g.items.map(i => i.to)))
export const isAdminPath = (path) => ADMIN_PATHS.has(path)

// Same rules the sidebar used for these pages.
export function useAdminNav() {
  const { isAdmin, level, roles, appRole } = useAuth()
  const isOwner = level >= 100 || (roles || []).includes('owner')
  const ok = (p, to) => {
    if (usingNewPermissions() && NEW_PAGE_PERMS[to]) return [].concat(NEW_PAGE_PERMS[to]).some(k => hasPerm(k))
    if (p === '__admin') return !!(isAdmin || isOwner)
    if (p === '__portal') return isPortalStaff(isAdmin, appRole)
    if (p === '__updates_post') return !!(isAdmin || isOwner || String(appRole || '').toLowerCase().split(',').map(r => r.trim()).some(r => ['admin', 'asc', 'certification'].includes(r)))
    return !p || canAny(appRole, p)
  }
  return ADMIN_NAV.map(g => ({ ...g, items: g.items.filter(i => ok(i.perm, i.to)) })).filter(g => g.items.length)
}

// /admin → the first settings page this person can open.
export function AdminHome() {
  const nav = useAdminNav()
  const first = nav[0]?.items[0]?.to
  return first ? <Navigate to={first} replace /> : <p className="page-sub">There are no settings you can change.</p>
}

// The settings menu down the left of every setup page.
export function AdminFrame({ path, children }) {
  const nav = useAdminNav()
  const { name } = useWorkspace()
  if (!isAdminPath(path) || !nav.length) return children
  return (
    <div className="adm">
      <nav className="adm-nav" aria-label="Admin settings">
        <div className="adm-title">Admin settings</div>
        {nav.map(g => (
          <div key={g.group} className="adm-group">
            <div className="adm-cap">{g.group}{g.group === 'Your setup' ? <span className="adm-ws"> · {name}</span> : null}</div>
            {g.items.map(i => (
              <NavLink key={i.to} to={i.to} className={({ isActive }) => 'adm-item' + (isActive ? ' on' : '')}>
                {i.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="adm-page">{children}</div>
    </div>
  )
}
