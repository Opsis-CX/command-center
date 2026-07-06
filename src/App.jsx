import NotificationBell from './components/NotificationBell'
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

export default function App() {
  const { session, loading, isAdmin } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  if (loading) return <div className="loading-screen">Loading…</div>
  if (!session) return <Login />

  return (
    <div className="app">
      <Sidebar open={navOpen} />
      <main className="main">
    <div className="topbar">
  <div className="crumb"><b>{titleFor(location.pathname)}</b></div>
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <NotificationBell />
    <button className="btn btn-ghost" onClick={() => setNavOpen(o => !o)}
      style={{ display: 'none' }} aria-label="Menu">☰</button>
  </div>
</div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />

            {isAdmin && <Route path="/certifications" element={<Certifications />} />}
            {isAdmin && <Route path="/matrix" element={<Placeholder title="Certification matrix" note="The agents × call-types grid mounts here." />} />}
            {isAdmin && <Route path="/courses" element={<CourseBuilder />} />}
            {isAdmin && <Route path="/projects" element={<Projects />} /> />}
            
{isAdmin && <Route path="/people" element={<PeopleTags />} />}
            {!isAdmin && <Route path="/my-certifications" element={<Placeholder title="My certifications" note="These unlock the schedules you can claim." />} />}
            {!isAdmin && <Route path="/my-courses" element={<Placeholder title="My courses" note="Work through lessons, then take the quiz." />} />}

<Route path="/schedule" element={<Schedule />} />
            <Route path="/schedule" element={<Schedule />} />
<Route path="/chat" element={<Chat />} />
  {isAdmin && <Route path="/schedule-builder" element={<ScheduleBuilder />} />}
            {isAdmin && <Route path="/positions" element={<Positions />} />}
            {isAdmin && <Route path="/insights" element={<ScheduleInsights />} />}
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function titleFor(path) {
  const map = {
    '/': 'Dashboard', '/certifications': 'Certifications', '/matrix': 'Certification matrix',
    '/courses': 'Course builder', '/projects': 'Projects', '/people': 'People & tags',
    '/my-certifications': 'My certifications', '/my-courses': 'My courses', '/schedule': 'Schedule',
  }
  return map[path] || 'Command Center'
}
