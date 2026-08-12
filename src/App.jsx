import NotificationBell from './components/NotificationBell'
import HeaderTaskBar from './components/HeaderTaskBar'
import { useState, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { initTheme } from './lib/theme'
import { supabase } from './lib/supabase'
import ChangePassword from './components/ChangePassword'
import { useAuth } from './lib/auth'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Certifications from './modules/Certifications'
import MyCertifications from './modules/MyCertifications'
import MyCourses from './modules/MyCourses'
import Dashboard from './modules/Dashboard'
import { Placeholder } from './modules/Placeholders'
import PeopleTags from './modules/PeopleTags'
import CourseBuilder from './modules/CourseBuilder'
import Schedule from './modules/Schedule'
import ScheduleBuilder from './modules/ScheduleBuilder'
import Positions from './modules/Positions'
import ScheduleInsights from './modules/ScheduleInsights'
import Chat from './modules/Chat'
import { canAny } from './lib/permissions'
import Settings from './modules/Settings'
import RolesPermissions from './modules/RolesPermissions'
import Projects from './modules/Projects'
import Clients from './modules/Clients'
import Reporting from './modules/Reporting'
import HourlyReports from './modules/HourlyReports'
import Updates from './modules/Updates'
import OpsisWeekly from './modules/OpsisWeekly'
import Notes from './modules/Notes'
import Calendar from './modules/Calendar'
import WeeklySync from './modules/WeeklySync'
import Notifications from './modules/Notifications'
import KnowledgeBase from './modules/KnowledgeBase'
import Scorecard from './modules/Scorecard'
import QualityAudit from './modules/QualityAudit'
import CallQA from './modules/CallQA'
import HelpCenter from './modules/HelpCenter'
import Coaching from './modules/Coaching'
import Tokens from './modules/Tokens'
import TeamFavorites from './modules/TeamFavorites'
import { UnreadProvider } from './lib/unread'
// --- hiring pipeline ---
import ApplicationForm from './modules/ApplicationForm'
import AssessmentForm from './modules/AssessmentForm'
import HiringDashboard from './modules/HiringDashboard'
// --- sales pipeline ---
import SalesDashboard from './modules/SalesDashboard'
// --- RSN pipeline (tag/role-gated variant of Sales with LinkedIn stages) ---
import RsnPipeline from './modules/RsnPipeline'
import { useRsnAccess } from './lib/rsnAccess'
// A tiny wrapper so the assessment route can read :appId from the URL and
// pass it into the form as a prop.
import { useParams } from 'react-router-dom'
function AssessmentRoute() {
  const { appId } = useParams()
  return <AssessmentForm applicationId={appId} />
}
export default function App() {
  const { session, loading, isAdmin, appRole, clientId, inTraining } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  // apply the saved light/dark/system theme as early as possible
  useEffect(() => { initTheme() }, [])
  if (loading) return <div className="loading-screen">Loading…</div>
  // ---- PUBLIC routes (no login required) ----
  // These must be checked BEFORE the login gate so job applicants who aren't
  // signed in can reach the application and assessment forms.
  const publicPaths = ['/apply', '/assessment']
  const isPublic = publicPaths.some(p => location.pathname === p || location.pathname.startsWith(p + '/'))
  if (isPublic) {
    return (
      <Routes>
        <Route path="/apply" element={<ApplicationForm />} />
        <Route path="/assessment/:appId" element={<AssessmentRoute />} />
        <Route path="/assessment" element={<AssessmentForm />} />
      </Routes>
    )
  }
  if (!session) return <Login />
  // External client-portal login: a branded, single-purpose shell that shows ONLY
  // Call QA (their own data, RLS-enforced — CallRail/LightSpeed only, never Five9).
  // No sidebar, no other modules.
  if (appRole === 'client') return <ClientPortal session={session} clientId={clientId} />
  // New hires in the pipeline are locked to a Certification-only view until an
  // admin marks them Hired (which clears in_training). No sidebar, no other modules.
  if (inTraining) return <TraineePortal session={session} />
  return <AuthedApp session={session} isAdmin={isAdmin} appRole={appRole} navOpen={navOpen} setNavOpen={setNavOpen} location={location} />
}
// External client portal — a branded, single-page shell that renders ONLY the
// Call QA module in portal mode. Clients see their own calls (RLS-enforced),
// can export and add notes, but never manager controls or any other module.
function ClientPortal({ session, clientId }) {
  const { signOut, user } = useAuth()   // user is needed by PushEnrollmentBanner below
  const [brand, setBrand] = useState(null)          // { portal_name, portal_accent, portal_logo_url, name }
  const [mustChange, setMustChange] = useState(null) // null = still checking

  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) })
    return () => { active = false }
  }, [session.user.id])

  useEffect(() => {
    let active = true
    if (!clientId) { setBrand({}); return }
    supabase.from('clients').select('name, portal_name, portal_accent, portal_logo_url').eq('id', clientId).maybeSingle()
      .then(({ data }) => { if (active) setBrand(data || {}) })
      .catch(() => { if (active) setBrand({}) })
    return () => { active = false }
  }, [clientId])

  if (mustChange === null || brand === null) return <div className="loading-screen">Loading…</div>
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} />

  const accent = brand.portal_accent || '#0f766e'
  const name = brand.portal_name || brand.name || 'Call QA'
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{ background: accent, color: '#fff', padding: '0 20px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {brand.portal_logo_url
            ? <img src={brand.portal_logo_url} alt={name} style={{ height: 32, width: 'auto', borderRadius: 4, background: '#fff', padding: 2 }} />
            : <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.3 }}>{name}</div>}
          <span style={{ fontSize: 13, opacity: 0.85 }}>Call Quality &amp; Conversion</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{session.user.email}</span>
          <button onClick={() => signOut()} style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Sign out</button>
        </div>
      </header>
      <CallQA portal />
      <footer style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0 32px' }}>Powered by Opsis CX</footer>
    </div>
  )
}
// New-hire onboarding shell — a Certification-only view. New hires keep their agent
// account (so certification data works exactly as it does for agents) but are locked
// here — no sidebar, no other modules — until an admin marks them Hired, which clears
// in_training (finish_onboarding). Questions route to onboarding@opsiscx.com.
function TraineePortal({ session }) {
  const { signOut } = useAuth()
  const [tab, setTab] = useState('certs')
  const [mustChange, setMustChange] = useState(null)
  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) })
    return () => { active = false }
  }, [session.user.id])
  if (mustChange === null) return <div className="loading-screen">Loading…</div>
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} />

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ background: tab === k ? '#0077B6' : 'transparent', color: tab === k ? '#fff' : '#0f172a', border: '1px solid #0077B6', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>{label}</button>
  )
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <header style={{ background: '#0077B6', color: '#fff', padding: '0 20px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Opsis Command Center</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{session.user.email}</span>
          <button onClick={() => signOut()} style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Sign out</button>
        </div>
      </header>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 16px 40px' }}>
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 14 }}>
          👋 Welcome! Your first step is <strong>certification</strong> — complete it below to move forward in onboarding. The rest of Command Center unlocks once you're all set.
          <div style={{ marginTop: 6 }}>Questions? Email <a href="mailto:onboarding@opsiscx.com" style={{ color: '#1d4ed8', fontWeight: 600 }}>onboarding@opsiscx.com</a>.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {tabBtn('certs', 'My Certifications')}
          {tabBtn('courses', 'My Courses')}
        </div>
        {tab === 'certs' ? <MyCertifications /> : <MyCourses />}
      </div>
      <footer style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: '24px 0 32px' }}>Opsis CX</footer>
    </div>
  )
}
// Everything behind the login gate. Split out so the must-change-password
// check can run with a session guaranteed to exist.
function AuthedApp({ session, isAdmin, appRole, navOpen, setNavOpen, location }) {
  // RSN pipeline visibility — DB-gated (admins, marketing role, or 'access/rsn' tag).
  const rsnOk = useRsnAccess()
  // Agents handed the shared temporary password must set their own before
  // they can use the app. Checked once, on load.
  const [mustChange, setMustChange] = useState(null) // null = still checking
  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) }) // never lock someone out on an error
    return () => { active = false }
  }, [session.user.id])
  if (mustChange === null) return <div className="loading-screen">Loading…</div>
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} />
  return (
    <UnreadProvider>
      <div className="app">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        {/* tap-to-close backdrop, only visible on mobile when the nav is open */}
        {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
        <main className="main">
          <div className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="nav-toggle" onClick={() => setNavOpen(o => !o)} aria-label="Menu">☰</button>
              <div className="crumb"><b>{titleFor(location.pathname)}</b></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <HeaderTaskBar />
              <NotificationBell />
            </div>
          </div>
          <div className="content">
            <Routes>
              <Route path="/" element={canAny(appRole, 'dashboard') ? <Dashboard /> : <OpsisWeekly />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/settings" element={<Settings />} />
              {isAdmin && <Route path="/roles" element={<RolesPermissions />} />}
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              {canAny(appRole, 'service_performance_scorecard') && <Route path="/scorecard" element={<Scorecard />} />}
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/quality" element={(canAny(appRole, 'quality_audit.view_own') || canAny(appRole, 'quality_audit.call_reviews')) ? <QualityAudit /> : <Placeholder title="No access" note="You don't have access to this area." />} />
              {/* Internal Call QA (AI) — full manager view incl. Rubric, all campaigns (GarageCo / Lavin / Open Invoices). */}
              <Route path="/call-qa" element={canAny(appRole, 'quality_audit.call_reviews') ? <CallQA /> : <Placeholder title="No access" note="You don't have access to this area." />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/chat" element={canAny(appRole, 'chat') ? <Chat /> : <Placeholder title="No access" note="You don't have access to this area." />} />
              {canAny(appRole, 'certifications.all') && <Route path="/certifications" element={<Certifications />} />}
              {canAny(appRole, 'certifications.builder') && <Route path="/courses" element={<CourseBuilder />} />}
              {canAny(appRole, 'certifications.assigned_to_complete') && <Route path="/my-certifications" element={<MyCertifications />} />}
              {canAny(appRole, 'certifications.assigned_to_complete') && <Route path="/my-courses" element={<MyCourses />} />}
              {canAny(appRole, 'project_management') && <Route path="/projects" element={<Projects />} />}
              {canAny(appRole, 'clients.view_only') && <Route path="/clients" element={<Clients />} />}
              <Route path="/updates" element={<Updates />} />
              <Route path="/home" element={<OpsisWeekly />} />
              <Route path="/notes" element={<Notes />} />
              {canAny(appRole, 'coaching') && <Route path="/coaching" element={<Coaching />} />}
              {canAny(appRole, 'tokens') && <Route path="/tokens" element={<Tokens />} />}
              <Route path="/get-to-know-you" element={<TeamFavorites />} />{/* everyone; RLS lets you write only your own card */}
              {canAny(appRole, 'reporting') && <Route path="/reporting" element={<Reporting />} />}
              {canAny(appRole, 'reporting') && <Route path="/reporting/hourly" element={<HourlyReports />} />}
              {canAny(appRole, 'people_and_tags.view_only') && <Route path="/people" element={<PeopleTags />} />}
              {canAny(appRole, 'hiring') && <Route path="/hiring" element={<HiringDashboard />} />}
              {/* Sales pipeline. Gated by the 'sales' page-key — add it to lib/permissions.js
                  and grant it to the right roles, exactly like 'hiring'. To open it to
                  everyone temporarily, replace this line with:
                  <Route path="/sales" element={<SalesDashboard />} /> */}
              {canAny(appRole, 'sales') && <Route path="/sales" element={<SalesDashboard />} />}
              {/* RSN pipeline — gated by can_access_rsn_pipeline() (RsnPipeline re-checks on direct hits). */}
              {rsnOk && <Route path="/rsn" element={<RsnPipeline />} />}
              {canAny(appRole, 'weekly_sync') && <Route path="/weekly-sync" element={<WeeklySync />} />}
              {canAny(appRole, 'schedule.create_schedules') && <Route path="/schedule-builder" element={<ScheduleBuilder />} />}
              {canAny(appRole, 'positions.view_only') && <Route path="/positions" element={<Positions />} />}
              {(canAny(appRole, 'schedule.all') || canAny(appRole, 'schedule.view_insights_assigned')) && <Route path="/insights" element={<ScheduleInsights />} />}
              <Route path="*" element={canAny(appRole, 'dashboard') ? <Dashboard /> : <OpsisWeekly />} />
            </Routes>
          </div>
        </main>
      </div>
    </UnreadProvider>
  )
}
function titleFor(path) {
  const map = {
    '/': 'Dashboard', '/certifications': 'Certifications',
    '/courses': 'Course builder', '/projects': 'Project Management', '/clients': 'Clients', '/people': 'People & tags',
    '/my-certifications': 'My certifications', '/my-courses': 'My courses', '/schedule': 'Schedule',
    '/chat': 'Chat', '/updates': 'Updates', '/home': 'Opsis Weekly', '/notes': 'My Notes', '/schedule-builder': 'Schedule builder', '/positions': 'Positions', '/insights': 'Schedule insights', '/reporting': 'Reporting', '/reporting/hourly': 'Hourly Reports', '/weekly-sync': 'Weekly Sync',
    '/hiring': 'Hiring', '/sales': 'Sales', '/help': 'Help Center', '/roles': 'Roles & permissions',
    '/coaching': 'Coaching', '/tokens': 'Tokens', '/get-to-know-you': 'Get to Know You', '/call-qa': 'Call QA (AI)', '/rsn': 'RSN Pipeline',
  }
  return map[path] || 'Command Center'
}
