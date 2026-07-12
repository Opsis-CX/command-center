import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUnread } from '../lib/unread'
import { supabase } from '../lib/supabase'
import { getTheme, setTheme, nextTheme, themeLabel } from '../lib/theme'
import { canAny } from '../lib/permissions'
import ChangePassword from './ChangePassword'
// Sidebar navigation.
// - `type: 'link'`  → a single top-level link.
// - `type: 'section'` → a clickable header that expands/collapses its children.
// Each item carries a `perm` page-key; a person only sees it if their role has
// any capability under that page. Sections with no visible children are hidden.
const NAV = [
  { type: 'link', to: '/', label: 'Dashboard', ic: '▦', end: true, perm: 'dashboard' },
  { type: 'link', to: '/weekly-sync', label: 'Weekly Sync', ic: '🗓', perm: 'weekly_sync' },
  { type: 'link', to: '/scorecard', label: 'Scorecard', ic: '🎯', perm: 'service_performance_scorecard' },
  { type: 'link', to: '/projects', label: 'Project Management', ic: '🗂', perm: 'project_management' },
  { type: 'link', to: '/calendar', label: 'Calendar', ic: '📅', perm: null },  // everyone gets calendar
  { type: 'link', to: '/notifications', label: 'Notifications', ic: '🔔', perm: null },  // everyone
  { type: 'link', to: '/chat', label: 'Chat', ic: '💬', perm: 'chat' },
  { type: 'link', to: '/hiring', label: 'Hiring', ic: '👥', perm: 'hiring' },
  {
    type: 'section', key: 'certifications', label: 'Certifications', ic: '✦', perm: 'certifications',
    children: [
      { to: '/certifications', label: 'Certifications', perm: 'certifications.all' },
      { to: '/my-certifications', label: 'My certifications', perm: 'certifications.view_personal_score_and_content_assigned' },
      { to: '/matrix', label: 'Certification matrix', perm: 'certifications.all' },
      { to: '/courses', label: 'Course builder', perm: 'certifications.builder' },
      { to: '/my-courses', label: 'My courses', perm: 'certifications.assigned_to_complete' },
    ],
  },
  {
    type: 'section', key: 'schedule', label: 'Schedule', ic: '◷', perm: 'schedule',
    children: [
      { to: '/schedule', label: 'Schedule', perm: 'schedule.view_my_schedule' },
      { to: '/schedule-builder', label: 'Schedule builder', perm: 'schedule.create_schedules' },
      { to: '/insights', label: 'Schedule insights', perm: 'schedule.all' },
    ],
  },
  { type: 'link', to: '/reporting', label: 'Reporting', ic: '📈', perm: 'reporting' },
  {
    type: 'section', key: 'backend', label: 'Backend', ic: '⚙', perm: null,
    children: [
      { to: '/people', label: 'People & tags', perm: 'people_and_tags.view_only' },
      { to: '/clients', label: 'Clients', perm: 'clients.view_only' },
      { to: '/positions', label: 'Positions', perm: 'positions.view_only' },
    ],
  },
]
export default function Sidebar({ open, onNavigate }) {
  const { isAdmin, level, roles, user, signOut, appRole } = useAuth()
  const { total: unreadTotal } = useUnread()
  const location = useLocation()
  const isOwner = level >= 100 || (roles || []).includes('owner')
  const viewRole = isAdmin ? 'admin' : 'agent'
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
      for (const entry of NAV) {
        if (entry.type !== 'section') continue
        const hit = entry.children.some(c => c.to === path)
        if (hit && !prev[entry.key]) next = { ...next, [entry.key]: true }
      }
      return next
    })
  }, [location.pathname])
  return (
    <aside className={'sidebar' + (open ? ' open' : '')}>
      <div className="brand">
        <img src="/opsis-logo.png" alt="Opsis" style={{ width: '100%', height: 'auto', maxHeight: 64, objectFit: 'contain' }} />
      </div>
      {NAV.map(entry => {
        // --- single top-level link ---
        if (entry.type === 'link') {
          // perm null = available to everyone (e.g. Calendar)
          if (entry.perm && !canAny(appRole, entry.perm)) return null
          return (
            <NavLink key={entry.to} to={entry.to} end={entry.end}
              onClick={() => onNavigate && onNavigate()}
              className={({ isActive }) => 'nav-item' + (isActive ? ' on' : '')}>
              <span className="ic">{entry.ic}</span> {entry.label}
              {entry.to === '/chat' && unreadTotal > 0 && (
                <span style={{ marginLeft: 'auto', background: '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </span>
              )}
            </NavLink>
          )
        }
        // --- collapsible section ---
        const children = entry.children.filter(c => !c.perm || canAny(appRole, c.perm))
        if (!children.length) return null
        const isOpen = !!openSections[entry.key]
        return (
          <div key={entry.key} className="nav-section">
            <button type="button" className="nav-item nav-section-head" onClick={() => toggleSection(entry.key)}
              aria-expanded={isOpen}>
              <span className="ic">{entry.ic}</span> {entry.label}
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
      })}
      <div className="nav-spacer" />
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
