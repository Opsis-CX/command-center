import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUnread } from '../lib/unread'
import { supabase } from '../lib/supabase'
import { getTheme, setTheme, nextTheme, themeLabel } from '../lib/theme'
import { canAny } from '../lib/permissions'
import { useRsnAccess } from '../lib/rsnAccess'
import ChangePassword from './ChangePassword'
// Sidebar navigation, organized into labelled GROUPS.
//
// NAV = [ { group: 'Main', items: [ ...items ] }, ... ]
//
// Each item is one of:
//   - { type: 'link',    to, label, ic, end?, perm }
//       → a single top-level link.
//   - { type: 'section', key, label, ic, children: [{ to, label, perm, end? }] }
//       → a clickable header that expands/collapses its children.
//
// `perm` is a page-key; a person only sees an item if their role has any
// capability under that key (perm: null = visible to everyone). Two perm keys
// are special-cased in permOk() below: '__rsn' (DB-gated RSN access) and
// '__admin' (admins/owners only). A section is hidden when none of its children
// are visible, and a GROUP is hidden automatically when none of its items are
// visible — so you never see an empty header. Order in this array = order shown.
//
// ONE shared ordering for everyone (Becky's Aug 2026 sidebar map). Everybody
// sees the same sequence; the perm gates hide whatever a given role can't access
// (so agents simply see fewer items in the same order). NAV_DEFAULT and
// NAV_ADMIN both point at NAV_MAIN — kept as two names so the two orders can be
// split again later without touching the component.
const NAV_MAIN = [
  {
    group: '',
    items: [
      {
        type: 'section', key: 'opsis', label: 'Opsis Weekly', ic: '🏠',
        children: [
          { to: '/updates', label: 'Updates', perm: null },              // everyone; RLS gates audience
          { to: '/', label: 'Dashboard', perm: 'dashboard', end: true }, // managers only (perm-gated)
        ],
      },
      {
        type: 'section', key: 'schedule', label: 'Schedule', ic: '◷',
        children: [
          { to: '/schedule', label: 'Schedule', perm: 'schedule.view_my_schedule' },
          { to: '/schedule-builder', label: 'Schedule builder', perm: 'schedule.create_schedules' },
          { to: '/insights', label: 'Schedule insights', perm: 'schedule.view_insights_assigned' },
          { to: '/live', label: "Who's On", perm: 'live_status' },
          { to: '/time', label: 'Time', perm: '__admin' }, // TimeAdmin is admin-only (it renders "This page is for admins" otherwise)
        ],
      },
      { type: 'link', to: '/chat', label: 'Chat', ic: '💬', perm: 'chat' },
      { type: 'link', to: '/notes', label: 'My Notes', ic: '📝', perm: null },
      { type: 'link', to: '/projects', label: 'Project Management', ic: '🗂️', perm: 'project_management' },
      { type: 'link', to: '/calendar', label: 'Calendar', ic: '📅', perm: null },
      { type: 'link', to: '/scorecard', label: 'Scorecard', ic: '🎯', perm: 'service_performance_scorecard' },
      { type: 'link', to: '/knowledge', label: 'Knowledge Base', ic: '📚', perm: null },
      { type: 'link', to: '/coaching', label: 'Coaching', ic: '🎧', perm: 'coaching' },
      { type: 'link', to: '/call-qa', label: 'Call QA (AI)', ic: '🤖', perm: 'quality_audit.call_reviews' },
      { type: 'link', to: '/tokens', label: 'Tokens', ic: '🎟️', perm: 'tokens' },
      { type: 'link', to: '/help', label: 'Help Center', ic: '🛟', perm: null },
      { type: 'link', to: '/get-to-know-you', label: 'Get to Know You', ic: '👋', perm: null },
      {
        type: 'section', key: 'reporting', label: 'Reporting', ic: '📈',
        children: [
          { to: '/reporting', label: 'Reporting hub', perm: 'reporting' },
          { to: '/reporting/hourly', label: 'Hourly', perm: 'reporting' },
        ],
      },
      {
        type: 'section', key: 'certifications', label: 'Certifications', ic: '✦',
        children: [
          { to: '/certifications', label: 'Certifications', perm: 'certifications.all' },
          { to: '/my-certifications', label: 'My certifications', perm: 'certifications.view_personal_score_and_content_assigned' },
          { to: '/courses', label: 'Course builder', perm: 'certifications.builder' },
          { to: '/my-courses', label: 'My courses', perm: 'certifications.assigned_to_complete' },
        ],
      },
      { type: 'link', to: '/weekly-sync', label: 'Weekly Sync', ic: '🔄', perm: 'weekly_sync' },
      { type: 'link', to: '/hiring', label: 'Hiring', ic: '🧲', perm: 'hiring' },
      { type: 'link', to: '/sales', label: 'Sales', ic: '📊', perm: 'sales' },
      { type: 'link', to: '/rsn', label: 'RSN Pipeline', ic: '🔗', perm: '__rsn' },
      { type: 'link', to: '/quality', label: 'Quality', ic: '✅', perm: 'quality_audit.call_reviews' },
      { type: 'link', to: '/meetings', label: 'Meetings', ic: '🎙️', perm: 'meetings' },
      {
        type: 'section', key: 'backend', label: 'Backend', ic: '⚙',
        children: [
          { to: '/people', label: 'People & tags', perm: 'people_and_tags.view_only' },
          { to: '/clients', label: 'Clients', perm: 'clients.view_only' },
          { to: '/positions', label: 'Positions', perm: 'positions.view_only' },
          { to: '/roles', label: 'Roles & permissions', perm: '__admin' }, // admins/owners only
          { to: '/survey', label: 'New Hire Survey', perm: '__admin' },   // results view; agents reach the form from their notification
        ],
      },
    ],
  },
]
const NAV_DEFAULT = NAV_MAIN
const NAV_ADMIN = NAV_MAIN
// Turn a stored role string ("asc,marketing") into a readable label
// ("ASC & Marketing"). A single role passes through unchanged; unknown keys are
// Title-Cased as a safe fallback.
const ROLE_LABELS = {
  owner: 'Owner', admin: 'Admin', agent: 'Agent', client: 'Client',
  support: 'Support', certification: 'Certification', quality: 'Quality',
  sales: 'Sales', asc: 'ASC', marketing: 'Marketing',
  reviewer: 'App Reviewer', qa_reviewer: 'QA Reviewer',
}
function formatRole(raw) {
  const parts = String(raw || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!parts.length) return 'Agent'
  return parts
    .map(p => ROLE_LABELS[p] || p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' & ')
}
export default function Sidebar({ open, onNavigate }) {
  const { isAdmin, level, roles, user, signOut, appRole } = useAuth()
  const { total: unreadTotal } = useUnread()
  const location = useLocation()
  // RSN pipeline is gated by a DB check (not the role matrix); null = still loading → hidden.
  const rsnOk = useRsnAccess()
  const isOwner = level >= 100 || (roles || []).includes('owner')
  // One place that answers "can this person see an item with this perm key?"
  //   '__rsn'   → DB-gated RSN access
  //   '__admin' → admins/owners only (e.g. Roles & permissions)
  const permOk = (p) =>
    p === '__rsn' ? rsnOk === true
    : p === '__admin' ? (isAdmin || isOwner)
    : (!p || canAny(appRole, p))
  // One shared ordering now; both names resolve to the same array.
  const NAV = (isAdmin || level >= 100 || (roles || []).includes('owner')) ? NAV_ADMIN : NAV_DEFAULT
  // Show the person's real name. useAuth only gives us the auth user (email),
  // so pull full_name from their profile. Fall back to the email prefix only
  // if the profile has no name yet.
  const [fullName, setFullName] = useState(null)
  useEffect(() => {
    if (!user?.id) return
    let active = true
    supabase.from('profiles').select('full_name').eq('id', user.id).single()
      .then(({ data }) => { if (active && data?.full_name) setFullName(data.full_name) })
    return () => { active = false }
  }, [user?.id])
  const name = fullName || user?.email?.split('@')[0] || 'User'
  const initial = (name.trim()[0] || 'U').toUpperCase()
  // Theme toggle (System → Light → Dark)
  const [theme, setThemeState] = useState(getTheme())
  const [pwOpen, setPwOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const cycleTheme = () => { const t = nextTheme(theme); setTheme(t); setThemeState(t) }
  // Which collapsible sections are open. Several can be open at once.
  const [openSections, setOpenSections] = useState({})
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  // Auto-open whichever section contains the current page, so you're never
  // sitting on a page whose section is collapsed.
  useEffect(() => {
    const path = location.pathname
    setOpenSections(prev => {
      let next = prev
      for (const grp of NAV) {
        for (const item of grp.items) {
          if (item.type !== 'section') continue
          const hit = item.children.some(c => c.to === path)
          if (hit && !prev[item.key]) next = { ...next, [item.key]: true }
        }
      }
      return next
    })
  }, [location.pathname])
  // Is a single item visible to this person? Used to decide whether a group
  // header should render at all.
  const itemVisible = (item) => {
    if (item.type === 'link') return permOk(item.perm)
    return item.children.some(c => permOk(c.perm))
  }
  // Render one nav item (link or collapsible section).
  const renderItem = (item) => {
    // --- single top-level link ---
    if (item.type === 'link') {
      if (!permOk(item.perm)) return null
      return (
        <NavLink key={item.to} to={item.to} end={item.end}
          onClick={() => onNavigate && onNavigate()}
          className={({ isActive }) => 'nav-item' + (isActive ? ' on' : '')}>
          <span className="ic">{item.ic}</span> {item.label}
          {item.to === '/chat' && unreadTotal > 0 && (
            <span style={{ marginLeft: 'auto', background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
        </NavLink>
      )
    }
    // --- collapsible section ---
    const children = item.children.filter(c => permOk(c.perm))
    if (!children.length) return null
    const isOpen = !!openSections[item.key]
    return (
      <div key={item.key} className="nav-section">
        <button type="button" className="nav-item nav-section-head" onClick={() => toggleSection(item.key)}
          aria-expanded={isOpen}>
          <span className="ic">{item.ic}</span> {item.label}
          <span className="nav-caret" style={{ marginLeft: 'auto', transition: 'transform .15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 11, opacity: .7 }}>▸</span>
        </button>
        {isOpen && (
          <div className="nav-section-body">
            {children.map(c => (
              <NavLink key={c.to} to={c.to} end={c.end}
                onClick={() => onNavigate && onNavigate()}
                className={({ isActive }) => 'nav-item nav-subitem' + (isActive ? ' on' : '')}
                style={{ paddingLeft: 34 }}>
                {c.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <aside className={'sidebar' + (open ? ' open' : '')}>
      <div className="brand">
        <img src="/opsis-logo.png" alt="Opsis" style={{ width: '100%', height: 'auto', maxHeight: 64, objectFit: 'contain' }} />
      </div>
      {/* Only THIS region scrolls when the nav outgrows the window — the page
          itself never gets a scrollbar, and the user chip stays pinned below. */}
      <div className="nav-scroll">
        {NAV.map(grp => {
          // Hide the whole group (label included) if nothing in it is visible.
          const anyVisible = grp.items.some(itemVisible)
          if (!anyVisible) return null
          return (
            <div key={grp.group} className="nav-group">
              {grp.group ? (
                <div className="nav-group-label"
                  style={{ padding: '14px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .45 }}>
                  {grp.group}
                </div>
              ) : null}
              {grp.items.map(renderItem)}
            </div>
          )
        })}
      </div>
      <div className="user-chip">
        <div className="user-av">{initial}</div>
        <div>
          <div className="user-name">{name}</div>
          <div className="user-role">{isOwner ? 'Owner' : isAdmin ? 'Admin' : formatRole(appRole)}</div>
        </div>
      </div>
      {/* Settings dropdown (below the name) */}
      <div className="nav-section">
        <button className="nav-item nav-section-head" onClick={() => setSettingsOpen(o => !o)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <span className="ic">⚙️</span> Settings
          <span className="nav-caret" style={{ marginLeft: 'auto', transition: 'transform .15s ease', transform: settingsOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 11, opacity: .7 }}>▸</span>
        </button>
        {settingsOpen && (
          <div className="nav-section-body">
            <NavLink to="/settings" onClick={() => onNavigate && onNavigate()}
              className={({ isActive }) => 'nav-item nav-subitem' + (isActive ? ' on' : '')}
              style={{ paddingLeft: 34 }}>
              Timezone
            </NavLink>
            <NavLink to="/settings" onClick={() => onNavigate && onNavigate()}
              className={({ isActive }) => 'nav-item nav-subitem' + (isActive ? ' on' : '')}
              style={{ paddingLeft: 34 }}>
              Notifications
            </NavLink>
            <button className="nav-item nav-subitem" onClick={cycleTheme}
              style={{ paddingLeft: 34, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              {themeLabel(theme)}
            </button>
            <button className="nav-item nav-subitem" onClick={() => setPwOpen(true)}
              style={{ paddingLeft: 34, width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              Change password
            </button>
          </div>
        )}
      </div>
      <button className="signout" onClick={signOut}>Sign out</button>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} onDone={() => setPwOpen(false)} />}
    </aside>
  )
}
