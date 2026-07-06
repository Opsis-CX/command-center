import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ProjectsDataProvider, useProjectsData } from './projectsData'
import ProjectDashboard from './ProjectDashboard'
import TaskDetail from './TaskDetail'
import TaskModal from './TaskModal'
import ProjectKanban from './ProjectKanban'
import ProjectGrid from './ProjectGrid'
import ProjectModal from './ProjectModal'
import ProjectMyDay from './ProjectMyDay'
import ProjectActivity from './ProjectActivity'
import ProjectRecurring from './ProjectRecurring'

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
]

export default function Projects() {
  return (
    <ProjectsDataProvider>
      <ProjectsInner />
    </ProjectsDataProvider>
  )
}

function ProjectsInner() {
  const { loading, error, isAdmin, refresh, tasks } = useProjectsData()
  const [view, setView] = useState('myday')
  const [openTaskId, setOpenTaskId] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // deep-link: /projects?task=<id> opens that task's detail panel
  useEffect(() => {
    const tid = searchParams.get('task')
    if (tid && !loading && tasks.some(t => t.id === tid)) {
      setOpenTaskId(tid)
      // clear the param so refreshing/closing doesn't re-trigger
      searchParams.delete('task')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, loading, tasks]) // eslint-disable-line
  // modal: null = closed; object = { taskId, defaultStatus, defaultProject }
  const [modal, setModal] = useState(null)
  const [kanbanProject, setKanbanProject] = useState('all')
  // project modal: undefined = closed, null = new, id = edit
  const [projectModal, setProjectModal] = useState(undefined)

  if (loading) return <p className="page-sub">Loading projects…</p>
  if (error) return <p className="page-sub" style={{ color: 'var(--failed)' }}>Couldn't load projects: {error}</p>

  const tabs = SUBVIEWS.filter(v => !v.adminOnly || isAdmin)
  const openAdd = (defaultStatus, defaultProject) => setModal({ taskId: null, defaultStatus, defaultProject })
  const openEdit = (id) => { setOpenTaskId(null); setModal({ taskId: id }) }
  const jumpToProjectKanban = (projectId) => { setKanbanProject(projectId); setView('kanban') }

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

      {view === 'myday' && <ProjectMyDay onOpenTask={setOpenTaskId} />}
      {view === 'dashboard' && <ProjectDashboard onOpenTask={setOpenTaskId} onEditTask={openEdit} onAddTask={openAdd} />}
      {view === 'kanban' && <ProjectKanban activeProject={kanbanProject} setActiveProject={setKanbanProject} onOpenTask={setOpenTaskId} onAddTask={openAdd} />}
      {view === 'projects' && <ProjectGrid onOpenProject={jumpToProjectKanban} onNewProject={() => setProjectModal(null)} onEditProject={(id) => setProjectModal(id)} />}
      {view === 'recurring' && <ProjectRecurring />}
      {view === 'activity' && <ProjectActivity />}

      {openTaskId && <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} onEdit={openEdit} />}
      {modal && (
        <TaskModal
          taskId={modal.taskId}
          defaultStatus={modal.defaultStatus}
          defaultProject={modal.defaultProject}
          onClose={() => setModal(null)}
        />
      )}
      {projectModal !== undefined && (
        <ProjectModal projectId={projectModal} onClose={() => setProjectModal(undefined)} />
      )}
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
