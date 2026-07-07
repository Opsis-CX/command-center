import NotificationBell from './components/NotificationBell'
import NotificationToggle from './components/NotificationToggle'
import { useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Certifications from './modules/Certifications'
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
            {!isAdmin && <Route path="/my-courses" element={<Placeholder title="My courses" note="Work through lessons, then take the quiz." />} />}
            <Route path="/schedule" element={<Schedule />} />
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
