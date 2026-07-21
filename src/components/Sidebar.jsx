import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUnread } from '../lib/unread'
import { supabase } from '../lib/supabase'
import { getTheme, setTheme, nextTheme, themeLabel } from '../lib/theme'
import { canAny } from '../lib/permissions'
import ChangePassword from './ChangePassword'

// Sidebar navigation, organized into labelled GROUPS.
//
// NAV = [ { group: 'Main', items: [ ...items ] }, ... ]
//
// Each item is one of:
//   - { type: 'link',    to, label, ic, end?, perm }
//       → a single top-level link.
//   - { type: 'section', key, label, ic, children: [{ to, label, perm }] }
//       → a clickable header that expands/collapses its children.
//
// `perm` is a page-key; a person only sees an item if their role has any
// capability under that key (perm: null = visible to everyone). A section is
// hidden when none of its children are visible, and a GROUP is hidden
// automatically when none of its items are visible — so you never see an empty
// header. To move something, just cut/paste the item between groups; to add a
// group, add another { group, items } block. Order in this array = order shown.
const NAV = [
  {
    // Daily drivers, pinned at the top. Single-tap for the pages people live in.
    group: 'Main',
    items: [
      { type: 'link', to: '/', label: 'Home Base', ic: '🏠', end: true, perm: null },  // everyone; page scopes itself by tag/role
      { type: 'link', to: '/updates', label: 'Updates', ic: '📣', perm: null },  // everyone; RLS gates audience
      { type: 'link', to: '/notes', label: 'My Notes', ic: '📝', perm: null },  // everyone; private per-user notebook
      {
        type: 'section', key: 'schedule', label: 'Schedule', ic: '◷',
        children: [
          { to: '/schedule', label: 'Schedule', perm: 'schedule.view_my_schedule' },
          { to: '/schedule-builder', label: 'Schedule builder', perm: 'schedule.create_schedules' },
          { to: '/insights', label: 'Schedule insights', perm: 'schedule.view_insights_assigned' },
        ],
      },
      { type: 'link', to: '/scorecard', label: 'Scorecard', ic: '🎯', perm: 'service_performance_scorecard' },
      {
        type: 'section', key: 'reporting', label: 'Reporting', ic: '📈',
        children: [
          { to: '/reporting', label: 'Reporting', perm: 'reporting' },
          { to: '/reporting/hourly', label: 'Hourly', perm: 'reporting' },
        ],
      },
      { type: 'link', to: '/quality', label: 'Quality', ic: '✅', perm: 'quality_audit.call_reviews' },
      { type: 'link', to: '/chat', label: 'Chat', ic: '💬', perm: 'chat' },
    ],
  },
  {
    // Everything secondary, folded into collapsible sections so the list stays short.
    group: 'More',
    items: [
      {
        type: 'section', key: 'operations', label: 'Operations', ic: '🧰',
        children: [
          // End-of-day report — non-agent staff only (same audience as the old Dashboard).
          { to: '/eod', label: 'End of Day Report', perm: 'dashboard' },
          { to: '/weekly-sync', label: 'Weekly Sync', perm: 'weekly_sync' },
          { to: '/projects', label: 'Project Management', perm: 'project_management' },
          { to: '/hiring', label: 'Hiring', perm: 'hiring' },
          // Sales pipeline. Gated by the 'sales' page-key — add it to lib/permissions.js
          // and grant it to the right roles, like 'hiring'.
          { to: '/sales', label: 'Sales', perm: 'sales' },
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
      { type: 'link', to: '/knowledge', label: 'Knowledge Base', ic: '📚', perm: null },  // everyone; RLS gates content
      {
        type: 'section', key: 'resources', label: 'Resources', ic: '🛟', perm: null,
        children: [
          { to: '/help', label: 'Help Center', perm: null },     // everyone; tickets are private per RLS
          { to: '/calendar', label: 'Calendar', perm: null },    // everyone gets calendar
        ],
      },
      {
        type: 'section', key: 'backend', label: 'Backend', ic: '⚙', perm: null,
        children: [
          { to: '/people', label: 'People & tags', perm: 'people_and_tags.view_only' },
          { to: '/clients', label: 'Clients', perm: 'clients.view_only' },
          { to: '/positions', label: 'Positions', perm: 'positions.view_only' },
        ],
      },
    ],
  },
]

export default function Sidebar({ open, onNavigate }) {
  const { isAdmin, level, roles, user, signOut, appRole } = useAuth()
  const { total: unreadTotal } = useUnread()
  const location = useLocation()

  const isOwner = level >= 100 || (roles || []).includes('owner')

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
    if (item.type === 'link') return !item.perm || canAny(appRole, item.perm)
    return item.children.some(c => !c.perm || canAny(appRole, c.perm))
  }

  // Render one nav item (link or collapsible section).
  const renderItem = (item) => {
    // --- single top-level link ---
    if (item.type === 'link') {
      if (item.perm && !canAny(appRole, item.perm)) return null
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
    const children = item.children.filter(c => !c.perm || canAny(appRole, c.perm))
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
              <NavLink key={c.to} to={c.to}
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
              <div className="nav-group-label"
                style={{ padding: '14px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .45 }}>
                {grp.group}
              </div>
              {grp.items.map(renderItem)}
            </div>
          )
        })}
      </div>

      <div className="user-chip">
        <div className="user-av">{initial}</div>
        <div>
          <div className="user-name">{name}</div>
          <div className="user-role">{isOwner ? 'Owner' : isAdmin ? 'Admin' : 'Agent'}</div>
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
