import React, { useState } from 'react'
import { useProjectsData } from './projectsData'
import { AvatarStack, SearchBox } from './projectBits'
import { exportProject } from './projectCsv'

// ============================================================
// PROJECTS GRID sub-view — cards with progress bars + members.
// Clicking a card jumps to that project's Kanban board.
// "New project" / edit come with the projects-management stage.
// ============================================================

export default function ProjectGrid({ onOpenProject, onNewProject, onEditProject }) {
  const { myVisibleProjects, tasks, projectMembers, profiles, clients, taskAssignees, timeEntries } = useProjectsData()
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const allMine = myVisibleProjects()
  const myProjects = allMine.filter(p => {
    if (!q) return true
    const client = clients.find(c => c.id === p.client_id)
    return (p.name || '').toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
      || (client?.name || '').toLowerCase().includes(q)
  })
  const now = new Date(); now.setHours(0, 0, 0, 0)

  if (!allMine.length) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>No projects yet</h3>
        <p style={{ fontSize: 13, marginBottom: 16 }}>Create your first project to start organizing tasks.</p>
        {onNewProject && <button className="btn btn-primary" onClick={() => onNewProject()}>+ New Project</button>}
      </div>
    )
  }

  return (
    <div>
      <SearchBox value={search} onChange={setSearch} placeholder="Search projects…" style={{ maxWidth: 340, marginBottom: 12 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{myProjects.length} project{myProjects.length !== 1 ? 's' : ''}{q ? ` matching "${search.trim()}"` : ''}</div>
        {onNewProject && <button className="btn btn-primary" onClick={() => onNewProject()}>+ New Project</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {myProjects.map(p => {
        const pt = tasks.filter(t => t.project_id === p.id)
        const done = pt.filter(t => t.status === 'done').length
        const over = pt.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date + 'T00:00:00') < now).length
        const pct = pt.length ? Math.round(done / pt.length * 100) : 0
        const memberIds = projectMembers.filter(m => m.project_id === p.id).map(m => m.profile_id)
        return (
          <div key={p.id} onClick={() => onOpenProject && onOpenProject(p.id)} className="card" style={{ padding: 20, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div>
                </div>
                {p.description && <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{p.description}</div>}
              </div>
              {onEditProject && (
                <button onClick={e => { e.stopPropagation(); onEditProject(p.id) }} title="Edit"
                  style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, flexShrink: 0 }}>✎</button>
              )}
              <button onClick={e => { e.stopPropagation(); exportProject(p, tasks, { clients, profiles, taskAssignees, timeEntries }) }} title="Export CSV"
                style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, flexShrink: 0 }}>⬇</button>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
                <span>{done} of {pt.length} complete</span><span>{pct}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--passed)' : 'var(--accent)' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
              <span>{pt.length} task{pt.length !== 1 ? 's' : ''}</span>
              {over > 0 && <span style={{ color: 'var(--failed)' }}>⚠ {over} overdue</span>}
            </div>
            {memberIds.length > 0 && (
              <div style={{ display: 'flex', marginTop: 10, gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-soft)', marginRight: 4 }}>Members:</span>
                <AvatarStack ids={memberIds} profiles={profiles} size={22} />
              </div>
            )}
          </div>
        )
      })}
      {onNewProject && (
        <button onClick={() => onNewProject()}
          style={{ background: 'transparent', border: '1px dashed var(--line)', borderRadius: 12, padding: 20, cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}>
          + New project
        </button>
      )}
      </div>
    </div>
  )
}
