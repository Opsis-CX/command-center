import React, { useState } from 'react'
import { ProjectsDataProvider, useProjectsData } from './projectsData'
import ProjectDashboard from './ProjectDashboard'
import TaskDetail from './TaskDetail'

// ============================================================
// PROJECTS MODULE — shell + sub-view navigation
// This is the native React port of the standalone Opsis
// project-management app. It mounts at /projects and has its
// own internal tabs (My Day, Dashboard, Kanban, ...).
// Built in stages; sub-views are filled in one at a time.
// ============================================================

const SUBVIEWS = [
  { key: 'myday', label: 'My Day' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'projects', label: 'Projects' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'activity', label: 'Activity' },
  { key: 'people', label: 'People', adminOnly: true },
]

export default function Projects() {
  return (
    <ProjectsDataProvider>
      <ProjectsInner />
    </ProjectsDataProvider>
  )
}

function ProjectsInner() {
  const { loading, error, isAdmin } = useProjectsData()
  const [view, setView] = useState('myday')
  const [openTaskId, setOpenTaskId] = useState(null)

  if (loading) return <p className="page-sub">Loading projects…</p>
  if (error) return <p className="page-sub" style={{ color: 'var(--failed)' }}>Couldn't load projects: {error}</p>

  const tabs = SUBVIEWS.filter(v => !v.adminOnly || isAdmin)

  return (
    <div>
      {/* sub-view tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 0, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              background: view === t.key ? 'var(--accent-bg)' : 'transparent',
              color: view === t.key ? 'var(--accent)' : 'var(--ink-soft)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'myday' && <SubViewStub name="My Day" />}
      {view === 'dashboard' && <ProjectDashboard onOpenTask={setOpenTaskId} />}
      {view === 'kanban' && <SubViewStub name="Kanban" />}
      {view === 'projects' && <SubViewStub name="Projects" />}
      {view === 'recurring' && <SubViewStub name="Recurring" />}
      {view === 'activity' && <SubViewStub name="Activity" />}
      {view === 'people' && <SubViewStub name="People" />}

      {openTaskId && <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  )
}

// temporary stub shown until each sub-view is ported in its stage
function SubViewStub({ name }) {
  const { tasks, projects, profiles } = useProjectsData()
  return (
    <div className="card" style={{ padding: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{name}</h2>
      <p className="page-sub" style={{ marginBottom: 12 }}>
        This section is being ported. The data layer is live and connected.
      </p>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
        Loaded: {tasks.length} tasks · {projects.length} projects · {profiles.length} people
      </div>
    </div>
  )
}
