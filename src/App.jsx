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
import Projects from './modules/Projects'
import Clients from './modules/Clients'
import Reporting from './modules/Reporting'
import Calendar from './modules/Calendar'
import WeeklySync from './modules/WeeklySync'
import Notifications from './modules/Notifications'
import KnowledgeBase from './modules/KnowledgeBase'
import Scorecard from './modules/Scorecard'
import QualityAudit from './modules/QualityAudit'
import { UnreadProvider } from './lib/unread'
// --- hiring pipeline ---
import ApplicationForm from './modules/ApplicationForm'
import AssessmentForm from './modules/AssessmentForm'
import HiringDashboard from './modules/HiringDashboard'
// A tiny wrapper so the assessment route can read :appId from the URL and
// pass it into the form as a prop.
import { useParams } from 'react-router-dom'

function AssessmentRoute() {
  const { appId } = useParams()
  return <AssessmentForm applicationId={appId} />
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
              <Route path="/" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              {canAny(appRole, 'service_performance_scorecard') && <Route path="/scorecard" element={<Scorecard />} />}
              <Route path="/quality" element={canAny(appRole, 'quality_audit.view_own') ? <QualityAudit /> : <Placeholder title="No access" note="You don't have access to this area." />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/chat" element={canAny(appRole, 'chat') ? <Chat /> : <Placeholder title="No access" note="You don't have access to this area." />} />
              {canAny(appRole, 'certifications.all') && <Route path="/certifications" element={<Certifications />} />}
              {canAny(appRole, 'certifications.all') && <Route path="/matrix" element={<Placeholder title="Certification matrix" note="The agents × call-types grid mounts here." />} />}
              {canAny(appRole, 'certifications.builder') && <Route path="/courses" element={<CourseBuilder />} />}
              {canAny(appRole, 'certifications.assigned_to_complete') && <Route path="/my-certifications" element={<Placeholder title="My certifications" note="These unlock the schedules you can claim." />} />}
              {canAny(appRole, 'certifications.assigned_to_complete') && <Route path="/my-courses" element={<MyCourses />} />}
              {canAny(appRole, 'project_management') && <Route path="/projects" element={<Projects />} />}
              {canAny(appRole, 'clients.view_only') && <Route path="/clients" element={<Clients />} />}
              {canAny(appRole, 'reporting') && <Route path="/reporting" element={<Reporting />} />}
              {canAny(appRole, 'people_and_tags.view_only') && <Route path="/people" element={<PeopleTags />} />}
              {canAny(appRole, 'hiring') && <Route path="/hiring" element={<HiringDashboard />} />}
              {canAny(appRole, 'weekly_sync') && <Route path="/weekly-sync" element={<WeeklySync />} />}
              {canAny(appRole, 'schedule.create_schedules') && <Route path="/schedule-builder" element={<ScheduleBuilder />} />}
              {canAny(appRole, 'positions.view_only') && <Route path="/positions" element={<Positions />} />}
              {canAny(appRole, 'schedule.all') && <Route path="/insights" element={<ScheduleInsights />} />}
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </div>
        </main>
      </div>
    </UnreadProvider>
  )
}

function titleFor(path) {
  const map = {
    '/': 'Dashboard', '/certifications': 'Certifications', '/matrix': 'Certification matrix',
    '/courses': 'Course builder', '/projects': 'Project Management', '/clients': 'Clients', '/people': 'People & tags',
    '/my-certifications': 'My certifications', '/my-courses': 'My courses', '/schedule': 'Schedule',
    '/chat': 'Chat', '/schedule-builder': 'Schedule builder', '/positions': 'Positions', '/insights': 'Schedule insights', '/reporting': 'Reporting', '/weekly-sync': 'Weekly Sync',
'/hiring': 'Hiring', '/quality': 'Quality',
  }  return map[path] || 'Command Center'
}
