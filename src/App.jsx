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
import Projects from './modules/Projects'
import Clients from './modules/Clients'
import Reporting from './modules/Reporting'
import HourlyReports from './modules/HourlyReports'
import Updates from './modules/Updates'
import OpsisWeekly from './modules/OpsisWeekly'
import EodReportCard from './modules/EodReports'
import Notes from './modules/Notes'
import Calendar from './modules/Calendar'
import WeeklySync from './modules/WeeklySync'
import Notifications from './modules/Notifications'
import KnowledgeBase from './modules/KnowledgeBase'
import Scorecard from './modules/Scorecard'
import QualityAudit from './modules/QualityAudit'
import HelpCenter from './modules/HelpCenter'
import { UnreadProvider } from './lib/unread'
// --- hiring pipeline ---
import ApplicationForm from './modules/ApplicationForm'
import AssessmentForm from './modules/AssessmentForm'
import HiringDashboard from './modules/HiringDashboard'
// --- sales pipeline ---
import SalesDashboard from './modules/SalesDashboard'
// --- RSN pipeline (tag-gated variant of Sales with LinkedIn stages) ---
import RsnPipeline from './modules/RsnPipeline'
import { useRsnAccess } from './lib/rsnAccess'
// --- tokens / rewards ---
import Tokens from './modules/Tokens'
// --- live "who's on" status (restored from the old Dashboard) ---
import LiveStatus from './modules/LiveStatus'
// A tiny wrapper so the assessment route can read :appId from the URL and
// pass it into the form as a prop.
import { useParams } from 'react-router-dom'
function AssessmentRoute() {
  const { appId } = useParams()
  return <AssessmentForm applicationId={appId} />
}
// End of Day Report page (Operations → End of Day Report). Wraps the existing
// role-aware EodReportCard (from EodReports.jsx) with a page title. Admins get
// their own report + the team roll-up; other non-agents get their own report;
// agents can't reach this route (gated by the 'dashboard' page-key).
function EodReportPage() {
  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h1 className="page-title">End of Day Report</h1>
        <p className="page-sub">Your tracked tasks fill in automatically — add anything the tracker can't capture, then submit before you sign off.</p>
      </div>
      <EodReportCard />
    </div>
  )
}
// Who's On — restores the live check-in / current-task view (the old Dashboard's
// "On now" panel). LiveStatus self-scopes: admins/managers see the whole team,
// agents see themselves. Gated to the floor-oversight roles by the 'live_status'
// page-key.
function LiveStatusPage() {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h1 className="page-title">Who's On</h1>
        <p className="page-sub">Live check-ins and what each person is working on right now.</p>
      </div>
      <LiveStatus />
    </div>
  )
}
export default function App() {
  const { session, loading, isAdmin, appRole } = useAuth()
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
  return <AuthedApp session={session} isAdmin={isAdmin} appRole={appRole} navOpen={navOpen} setNavOpen={setNavOpen} location={location} />
}
// Everything behind the login gate. Split out so the must-change-password
// check can run with a session guaranteed to exist.
function AuthedApp({ session, isAdmin, appRole, navOpen, setNavOpen, location }) {
  // RSN pipeline visibility (admins + anyone with the 'access/rsn' tag).
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
              <Route path="/" element={<OpsisWeekly />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              {canAny(appRole, 'service_performance_scorecard') && <Route path="/scorecard" element={<Scorecard />} />}
              <Route path="/help" element={<HelpCenter />} />
              <Route path="/quality" element={(canAny(appRole, 'quality_audit.view_own') || canAny(appRole, 'quality_audit.call_reviews')) ? <QualityAudit /> : <Placeholder title="No access" note="You don't have access to this area." />} />
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
              {canAny(appRole, 'reporting') && <Route path="/reporting" element={<Reporting />} />}
              {canAny(appRole, 'reporting') && <Route path="/reporting/hourly" element={<HourlyReports />} />}
              {canAny(appRole, 'people_and_tags.view_only') && <Route path="/people" element={<PeopleTags />} />}
              {canAny(appRole, 'hiring') && <Route path="/hiring" element={<HiringDashboard />} />}
              {/* Sales pipeline. Gated by the 'sales' page-key — add it to lib/permissions.js
                  and grant it to the right roles, exactly like 'hiring'. To open it to
                  everyone temporarily, replace this line with:
                  <Route path="/sales" element={<SalesDashboard />} /> */}
              {canAny(appRole, 'sales') && <Route path="/sales" element={<SalesDashboard />} />}
              {/* RSN pipeline — tag-gated (admins + 'access/rsn' tag). Same board
                  as Sales with LinkedIn Message 1/2/3; RsnPipeline re-checks access. */}
              {rsnOk && <Route path="/rsn" element={<RsnPipeline />} />}
              {canAny(appRole, 'tokens') && <Route path="/tokens" element={<Tokens />} />}
              {canAny(appRole, 'live_status') && <Route path="/live" element={<LiveStatusPage />} />}
              {canAny(appRole, 'dashboard') && <Route path="/eod" element={<EodReportPage />} />}
              {canAny(appRole, 'weekly_sync') && <Route path="/weekly-sync" element={<WeeklySync />} />}
              {canAny(appRole, 'schedule.create_schedules') && <Route path="/schedule-builder" element={<ScheduleBuilder />} />}
              {canAny(appRole, 'positions.view_only') && <Route path="/positions" element={<Positions />} />}
              {(canAny(appRole, 'schedule.all') || canAny(appRole, 'schedule.view_insights_assigned')) && <Route path="/insights" element={<ScheduleInsights />} />}
              <Route path="*" element={<OpsisWeekly />} />
            </Routes>
          </div>
        </main>
      </div>
    </UnreadProvider>
  )
}
function titleFor(path) {
  const map = {
    '/': 'Home Base', '/certifications': 'Certifications',
    '/courses': 'Course builder', '/projects': 'Project Management', '/clients': 'Clients', '/people': 'People & tags',
    '/my-certifications': 'My certifications', '/my-courses': 'My courses', '/schedule': 'Schedule',
    '/chat': 'Chat', '/updates': 'Updates', '/home': 'Home Base', '/notes': 'My Notes', '/schedule-builder': 'Schedule builder', '/positions': 'Positions', '/insights': 'Schedule insights', '/reporting': 'Reporting', '/reporting/hourly': 'Hourly Reports', '/weekly-sync': 'Weekly Sync',
    '/hiring': 'Hiring', '/quality': 'Quality', '/sales': 'Sales', '/rsn': 'RSN Pipeline', '/help': 'Help Center', '/eod': 'End of Day Report', '/tokens': 'Tokens', '/live': "Who's On",
  }
  return map[path] || 'Command Center'
}
