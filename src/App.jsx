import { useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './components/Login'
import Sidebar from './components/Sidebar'
import Certifications from './modules/Certifications'
import { Dashboard, Placeholder } from './modules/Placeholders'
import PeopleTags from './modules/PeopleTags'

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
          <button className="btn btn-ghost" onClick={() => setNavOpen(o => !o)}
            style={{ display: 'none' }} aria-label="Menu">☰</button>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />

            {isAdmin && <Route path="/certifications" element={<Certifications />} />}
            {isAdmin && <Route path="/matrix" element={<Placeholder title="Certification matrix" note="The agents × call-types grid mounts here." />} />}
            {isAdmin && <Route path="/courses" element={<Placeholder title="Course builder" note="The block editor mounts here." />} />}
            {isAdmin && <Route path="/projects" element={<Placeholder title="Projects" note="Your existing project management module." />} />}
            
{isAdmin && <Route path="/people" element={<PeopleTags />} />}
            {!isAdmin && <Route path="/my-certifications" element={<Placeholder title="My certifications" note="These unlock the schedules you can claim." />} />}
            {!isAdmin && <Route path="/my-courses" element={<Placeholder title="My courses" note="Work through lessons, then take the quiz." />} />}

            <Route path="/schedule" element={<Placeholder title="Schedule" note="Your existing schedule module mounts here." />} />

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
