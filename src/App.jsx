import NotificationBell from './components/NotificationBell'
import NotificationToggle from './components/NotificationToggle'
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
import Projects from './modules/Projects'
import Clients from './modules/Clients'
import Reporting from './modules/Reporting'
import WeeklySync from './modules/WeeklySync'
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
  const { session, loading, isAdmin } = useAuth()
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
  return <AuthedApp session={session} isAdmin={isAdmin} navOpen={navOpen} setNavOpen={setNavOpen} location={location} />
}

// Everything behind the login gate. Split out so the must-change-password
// check can run with a session guaranteed to exist.
function AuthedApp({ session, isAdmin, navOpen, setNavOpen, location }) {
  // Agents handed the shared temporary password must set their own before
  // they can use the app. Checked once, on load.
  const [mustChange, setMustChange] = useState(null)   // null = still checking
  useEffect(() => {
    let active = true
    supabase.from('profiles').select('must_change_password').eq('id', session.user.id).single()
      .then(({ data }) => { if (active) setMustChange(!!data?.must_change_password) })
      .catch(() => { if (active) setMustChange(false) })   // never lock someone out on an error
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
            <NotificationToggle />
            <NotificationBell />
          </div>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {isAdmin && <Route path="/certifications" element={<Certifications />} />}
            {isAdmin && <Route path="/matrix" element={<Placeholder title="Certification matrix" note="The agents × call-types grid mounts here." />} />}
            {isAdmin && <Route path="/courses" element={<CourseBuilder />} />}
            {isAdmin && <Route path="/projects" element={<Projects />} />}
            {isAdmin && <Route path="/clients" element={<Clients />} />}
            {isAdmin && <Route path="/reporting" element={<Reporting />} />}
            {isAdmin && <Route path="/people" element={<PeopleTags />} />}
            {isAdmin && <Route path="/hiring" element={<HiringDashboard />} />}
            {!isAdmin && <Route path="/my-certifications" element={<Placeholder title="My certifications" note="These unlock the schedules you can claim." />} />}
{!isAdmin && <Route path="/my-courses" element={<MyCourses />} />}            <Route path="/schedule" element={<Schedule />} />
            <Route path="/chat" element={<Chat />} />
            {isAdmin && <Route path="/weekly-sync" element={<WeeklySync />} />}
            {isAdmin && <Route path="/schedule-builder" element={<ScheduleBuilder />} />}
            {isAdmin && <Route path="/positions" element={<Positions />} />}
            {isAdmin && <Route path="/insights" element={<ScheduleInsights />} />}
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
    '/hiring': 'Hiring',
  }
  return map[path] || 'Command Center'
}
