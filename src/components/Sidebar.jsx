import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useUnread } from '../lib/unread'
import { supabase } from '../lib/supabase'
import { getTheme, setTheme, nextTheme, themeLabel } from '../lib/theme'
import { canAny } from '../lib/permissions'
import { useRsnAccess } from '../lib/rsnAccess'
import { useFinanceAccess } from '../lib/financeAccess'
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
// capability under that key (perm: null = visible to everyone). Three perm keys
// are special-cased in permOk() below: '__rsn' (DB-gated RSN access),
// '__admin' (admins/owners only) and '__caller' (anyone allowed to place calls —
// everyone except agents, clients and CSRs; matches canPlaceCalls in App.jsx and
// can_place_calls() in the database). A section is hidden when none of its
// children are visible, and a GROUP is hidden automatically when none of its
// items are visible — so you never see an empty header. Order in this array =
// order shown.
//
// ONE shared ordering for everyone (Becky's Aug 2026 sidebar map). Everybody
// sees the same sequence; the perm gates hide whatever a given role can't access
// (so agents simply see fewer items in the same order). NAV_DEFAULT and
// NAV_ADMIN both point at NAV_MAIN — kept as two names so the two orders can be
// split again later without touching the component.
// Line icons matching the Opsis CX portal (2026-11-02). Keyed by section key
// or route; anything not listed falls back to its emoji `ic`, which global
// search still uses.
const OPSIS_LOGO = 'https://dqvuviyqrcrgapmxkoyx.supabase.co/storage/v1/object/public/portal-assets/9726e6eb-1364-4dba-8ddb-10c07a408ecb/logo-1793310857674.png'
const C9 = '<circle cx="12" cy="12" r="9"/>'
const NAV_SVG = {
  opsis: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  schedule: C9 + '<path d="M12 7v5l3 2"/>',
  '/chat': '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  '/web-chat': C9 + '<path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  calling: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  '/notes': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  '/projects': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v10"/>',
  '/calendar': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  '/scorecard': C9 + '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  '/my-call-reviews': '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  '/knowledge': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  '/coaching': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  '/call-qa': '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  '/tokens': '<path d="M2 9V6a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v3a3 3 0 0 0 0 6v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3a3 3 0 0 0 0-6z"/><path d="M13 5v14" stroke-dasharray="2 2"/>',
  '/help': C9 + '<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  '/get-to-know-you': C9 + '<path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  reporting: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17V9"/>',
  certifications: '<circle cx="12" cy="8" r="6"/><path d="M8.2 13.9 7 22l5-3 5 3-1.2-8.1"/>',
  '/weekly-sync': '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/>',
  '/hiring': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  '/sales': '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  '/rsn': '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  '/quality': C9 + '<path d="M8 12l3 3 5-6"/>',
  '/meetings': '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  '/finance': '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  '/submit-purchase': '<path d="M5 2v20l2.5-1.5L10 22l2-1.5 2 1.5 2.5-1.5L19 22V2l-2.5 1.5L14 2l-2 1.5L10 2 7.5 3.5z"/><path d="M9 8h6M9 12h6"/>',
  backend: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
}
function NavIcon({ id, fallback }) {
  const svg = NAV_SVG[id]
  if (!svg) return <span className="ic">{fallback}</span>
  return (
    <span className="ic">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    </span>
  )
}

const NAV_MAIN = [
  {
    group: '',
    items: [
      {
        type: 'section', key: 'opsis', label: 'Opsis Weekly', ic: '🏠',
        children: [
          { to: '/home', label: 'Opsis Weekly', perm: null },            // the page itself; everyone
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
      // Web Chat sits top-level: it is a live queue with someone waiting on the
      // other end, so it should be one tap.
      { type: 'link', to: '/web-chat', label: 'Web Chat', ic: '🌐', perm: 'web_chat' },
      // Calling (2026-10-15). Phone = click-to-call team directory (not agents).
      // Dialer = agent calling workspace (callers, plus agents assigned to a campaign).
      // Campaigns = build/run outbound campaigns (not agents). Numbers are never shown.
      {
        type: 'section', key: 'calling', label: 'Calling', ic: '📞',
        children: [
          { to: '/dialer', label: 'Dialer', perm: '__dialer' },
          { to: '/phone', label: 'Phone', perm: '__caller' },
          { to: '/campaigns', label: 'Campaigns', perm: '__caller' },
          { to: '/inbound', label: 'Inbound', perm: '__caller' },
        ],
      },
      { type: 'link', to: '/notes', label: 'My Notes', ic: '📝', perm: null },
      { type: 'link', to: '/projects', label: 'Project Management', ic: '🗂️', perm: 'project_management' },
      { type: 'link', to: '/calendar', label: 'Calendar', ic: '📅', perm: null },
      { type: 'link', to: '/scorecard', label: 'Scorecard', ic: '🎯', perm: 'service_performance_scorecard' },
      { type: 'link', to: '/my-call-reviews', label: 'My Call Reviews', ic: '🎧', perm: 'call_reviews.mine' },
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
      { type: 'link', to: '/finance', label: 'Finance', ic: '💰', perm: '__finance' },                    // Admins and Owners only (enforced by the database)
      { type: 'link', to: '/submit-purchase', label: 'Submit a purchase', ic: '🧾', perm: '__finance_submit' }, // roles owners choose, plus Admins and Owners
      {
        type: 'section', key: 'backend', label: 'Backend', ic: '⚙',
        children: [
          { to: '/people', label: 'People & tags', perm: 'people_and_tags.view_only' },
          { to: '/clients', label: 'Clients', perm: 'clients.view_only' },
          { to: '/positions', label: 'Positions', perm: 'positions.view_only' },
          { to: '/sms-consents', label: 'SMS Consent', perm: '__admin' },   // agent text opt-in report (admins only)
          { to: '/roles', label: 'Roles & permissions', perm: '__admin' }, // admins/owners only
          { to: '/service-account', label: 'Service account', perm: '__admin' }, // the account automated posts use (Turri)
          { to: '/survey', label: 'New Hire Survey', perm: '__admin' },   // results view; agents reach the form from their notification
        ],
      },
    ],
  },
]
const NAV_DEFAULT = NAV_MAIN
const NAV_ADMIN = NAV_MAIN
// Roles that can NOT place calls. Keep in step with NO_CALL_ROLES in App.jsx and
// public.can_place_calls() in the database.
const NO_CALL_ROLES = ['agent', 'client', 'csr']
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
// Pages this person can open (filled in by the sidebar on every render).
let _navIndex = []
export const getNavIndex = () => _navIndex

export default function Sidebar({ open, onNavigate }) {
  const { isAdmin, level, roles, user, signOut, appRole } = useAuth()
  const navigate = useNavigate()
  const { total: unreadTotal } = useUnread()
  const location = useLocation()
  // RSN pipeline is gated by a DB check (not the role matrix); null = still loading → hidden.
  const rsnOk = useRsnAccess()
  // Finance links are gated by the database too: '__finance' = Admins/Owners, '__finance_submit' = roles allowed to submit purchases.
  const fin = useFinanceAccess()
  const isOwner = level >= 100 || (roles || []).includes('owner')
  // One place that answers "can this person see an item with this perm key?"
  //   '__rsn'    → DB-gated RSN access
  //   '__admin'  → admins/owners only (e.g. Roles & permissions)
  //   '__caller' → anyone allowed to place calls (not agents/clients/CSRs)
  //   '__dialer' → callers, plus agents assigned to at least one dialer campaign
  // Agents see the Dialer only once a manager puts them on a campaign.
  const [onCampaign, setOnCampaign] = useState(false)
  useEffect(() => {
    if (!user?.id) return
    let active = true
    supabase.from('dial_campaign_agents').select('campaign_id').eq('profile_id', user.id).limit(1)
      .then(({ data }) => { if (active) setOnCampaign(!!(data && data.length)) })
    return () => { active = false }
  }, [user?.id])
  const permOk = (p) =>
    p === '__rsn' ? rsnOk === true
    : p === '__finance' ? fin?.manager === true
    : p === '__finance_submit' ? fin?.submitter === true
    : p === '__admin' ? (isAdmin || isOwner)
    : p === '__caller' ? !NO_CALL_ROLES.includes(appRole)
    : p === '__dialer' ? (!NO_CALL_ROLES.includes(appRole) || onCampaign)
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
  // Share this person's allowed pages with the universal search (so its "Pages" results
  // always match their menu exactly). 2026-10-30
  _navIndex = NAV.flatMap(grp => (grp.items || []).flatMap(item => item.type === 'link'
    ? (permOk(item.perm, item.to) ? [{ label: item.label, to: item.to, ic: item.ic, group: grp.group || '' }] : [])
    : (item.children || []).filter(c => permOk(c.perm, c.to)).map(c => ({ label: c.label, to: c.to, ic: c.ic || item.ic, group: item.label }))))
  // Render one nav item (link or collapsible section).
  const renderItem = (item) => {
    // --- single top-level link ---
    if (item.type === 'link') {
      if (!permOk(item.perm)) return null
      return (
        <NavLink key={item.to} to={item.to} end={item.end}
          onClick={() => onNavigate && onNavigate()}
          className={({ isActive }) => 'nav-item' + (isActive ? ' on' : '')}>
          <NavIcon id={item.to} fallback={item.ic} /> {item.label}
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
          <NavIcon id={item.key} fallback={item.ic} /> {item.label}
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
        <img src={OPSIS_LOGO} alt="Opsis CX" onError={e => { e.currentTarget.src = '/opsis-logo.png' }} />
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
      <div className="user-chip" role="link" tabIndex={0} title="My profile" style={{ cursor: 'pointer' }}
        onClick={() => { navigate('/profile'); onNavigate && onNavigate() }}
        onKeyDown={e => { if (e.key === 'Enter') { navigate('/profile'); onNavigate && onNavigate() } }}>
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
          <NavIcon id="settings" fallback="⚙️" /> Settings
          <span className="nav-caret" style={{ marginLeft: 'auto', transition: 'transform .15s ease', transform: settingsOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 11, opacity: .7 }}>▸</span>
        </button>
        {settingsOpen && (
          <div className="nav-section-body">
            <NavLink to="/profile" onClick={() => onNavigate && onNavigate()}
              className={({ isActive }) => 'nav-item nav-subitem' + (isActive ? ' on' : '')}
              style={{ paddingLeft: 34 }}>
              My profile
            </NavLink>
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
