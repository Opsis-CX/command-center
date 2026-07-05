import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', ic: '▦', end: true, roles: ['admin', 'agent'] },
  ]},
  { to: '/chat', label: 'Chat', ic: '💬', roles: ['admin', 'agent'] },
  { group: 'Certifications', items: [
    { to: '/certifications', label: 'Certifications', ic: '✦', roles: ['admin'] },
    { to: '/my-certifications', label: 'My certifications', ic: '✦', roles: ['agent'] },
    { to: '/matrix', label: 'Certification matrix', ic: '▤', roles: ['admin'] },
    { to: '/courses', label: 'Course builder', ic: '✎', roles: ['admin'] },
    { to: '/my-courses', label: 'My courses', ic: '✎', roles: ['agent'] },
  ]},
  { group: 'Operations', items: [
    { to: '/schedule', label: 'Schedule', ic: '◷', roles: ['admin', 'agent'] },
{ to: '/schedule-builder', label: 'Schedule builder', ic: '🛠', roles: ['admin'] },
    { to: '/positions', label: 'Positions', ic: '🏷', roles: ['admin'] },
    { to: '/projects', label: 'Projects', ic: '❏', roles: ['admin'] },
    { to: '/people', label: 'People & tags', ic: '☺', roles: ['admin'] },
    { to: '/insights', label: 'Schedule insights', ic: '📊', roles: ['admin'] },
  ]},
]

export default function Sidebar({ open }) {
  const { isAdmin, user, signOut } = useAuth()
  const viewRole = isAdmin ? 'admin' : 'agent'
  const name = user?.email?.split('@')[0] ?? 'User'
  const initial = (name[0] || 'U').toUpperCase()

  return (
    <aside className={'sidebar' + (open ? ' open' : '')}>
      <div className="brand">
        <div className="brand-mark">C</div>
        <div className="brand-name">Command Center</div>
      </div>

      {NAV.map(group => {
        const items = group.items.filter(it => it.roles.includes(viewRole))
        if (!items.length) return null
        return (
          <div key={group.group}>
            <div className="nav-label">{group.group}</div>
            {items.map(it => (
              <NavLink key={it.to} to={it.to} end={it.end}
                className={({ isActive }) => 'nav-item' + (isActive ? ' on' : '')}>
                <span className="ic">{it.ic}</span> {it.label}
              </NavLink>
            ))}
          </div>
        )
      })}

      <div className="nav-spacer" />
      <div className="user-chip">
        <div className="user-av">{initial}</div>
        <div>
          <div className="user-name">{name}</div>
          <div className="user-role">{isAdmin ? 'Admin' : 'Agent'}</div>
        </div>
      </div>
      <button className="signout" onClick={signOut}>Sign out</button>
    </aside>
  )
}
