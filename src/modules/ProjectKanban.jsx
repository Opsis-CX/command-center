import React, { useState } from 'react'
import { useProjectsData } from './projectsData'
import { PriorityBadge, DueLabel, AvatarStack, SearchBox } from './projectBits'
import { dueCls } from './projectHelpers'

// ============================================================
// KANBAN sub-view — five status columns with a project filter.
// Cards open the task detail panel; "+ Add task" opens the modal
// pre-set to that column's status (and the active project).
// ============================================================

const COLS = [
  { key: 'todo', label: 'To do', color: 'var(--ink-soft)' },
  { key: 'inprogress', label: 'In progress', color: '#2563EB' },
  { key: 'review', label: 'In review', color: '#7C3AED' },
  { key: 'blocked', label: 'Blocked', color: '#DC2626' },
  { key: 'done', label: 'Done', color: '#16A34A' },
]

export default function ProjectKanban({ activeProject, setActiveProject, onOpenTask, onAddTask }) {
  const { myVisibleTasks, myVisibleProjects, projects, profiles, taskAssignees, userId } = useProjectsData()
  const myProjects = myVisibleProjects()
  const [search, setSearch] = useState('')
  // Being a project member means seeing that whole board, which buries the
  // handful of tasks actually on your plate. Default to just those.
  const [mineOnly, setMineOnly] = useState(() => {
    try { return localStorage.getItem('kanbanMineOnly') !== 'false' } catch { return true }
  })
  const toggleMineOnly = () => setMineOnly(v => {
    const next = !v
    try { localStorage.setItem('kanbanMineOnly', String(next)) } catch { /* private mode */ }
    return next
  })

  const q = search.trim().toLowerCase()
  const myTaskIds = new Set(taskAssignees.filter(a => a.profile_id === userId).map(a => a.task_id))
  const allVisible = myVisibleTasks()
  const mineCount = allVisible.filter(t => myTaskIds.has(t.id)).length
  const tasks = allVisible
    .filter(t => !mineOnly || myTaskIds.has(t.id))
    .filter(t => activeProject === 'all' || t.project_id === activeProject)
    .filter(t => {
      if (!q) return true
      const proj = projects.find(p => p.id === t.project_id)
      return (t.name || '').toLowerCase().includes(q)
        || (t.notes || '').toLowerCase().includes(q)
        || (proj?.name || '').toLowerCase().includes(q)
    })
  const now = new Date(); now.setHours(0, 0, 0, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search tasks…" style={{ maxWidth: 340 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={mineOnly} onChange={toggleMineOnly} style={{ cursor: 'pointer' }} />
          Only my tasks
          <span className="page-sub" style={{ fontWeight: 400 }}>({mineCount})</span>
        </label>
        {mineOnly && mineCount === 0 && (
          <span className="page-sub" style={{ fontSize: 12 }}>Nothing assigned to you — untick to see the whole board.</span>
        )}
      </div>
      {/* project filter pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <Pill active={activeProject === 'all'} onClick={() => setActiveProject('all')}>All projects</Pill>
        {myProjects.map(p => (
          <Pill key={p.id} active={activeProject === p.id} onClick={() => setActiveProject(p.id)}>{p.name}</Pill>
        ))}
        {onAddTask && (
          <button onClick={() => onAddTask(undefined, activeProject === 'all' ? '' : activeProject)}
            className="btn btn-primary" style={{ marginLeft: 'auto' }}>+ Add task</button>
        )}
      </div>

      {/* board */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(200px, 1fr))', gap: 14, alignItems: 'start', overflowX: 'auto' }}>
        {COLS.map(col => {
          const ct = tasks.filter(t => t.status === col.key)
          return (
            <div key={col.key} style={{ background: 'var(--bg-soft, #f7f7f5)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: col.color }}>{col.label}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: 'var(--line)', color: 'var(--ink-soft)' }}>{ct.length}</span>
              </div>
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 }}>
                {ct.map(t => {
                  const dt = t.due_date ? new Date(t.due_date + 'T00:00:00') : null
                  const over = dt && dt < now && t.status !== 'done'
                  const soon = dt && !over && dt <= new Date(now.getTime() + 2 * 86400000)
                  const proj = projects.find(p => p.id === t.project_id)
                  const aIds = taskAssignees.filter(a => a.task_id === t.id).map(a => a.profile_id)
                  return (
                    <div key={t.id} onClick={() => onOpenTask && onOpenTask(t.id)}
                      style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: over ? '3px solid var(--failed)' : soon ? '3px solid #D97706' : '1px solid var(--line)', borderRadius: 8, padding: 12, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                      <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8, lineHeight: 1.4 }}>{t.name}</div>
                      {proj && <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 500, color: proj.color }}>● {proj.name}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                          <PriorityBadge priority={t.priority} small />
                          {t.due_date && <DueLabel task={t} small />}
                        </div>
                        <AvatarStack ids={aIds} profiles={profiles} size={22} />
                      </div>
                    </div>
                  )
                })}
                {onAddTask && (
                  <button onClick={() => onAddTask(col.key, activeProject === 'all' ? '' : activeProject)}
                    style={{ width: '100%', padding: 7, border: '1px dashed var(--line)', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--ink-soft)', fontFamily: 'inherit', marginTop: 4 }}>
                    + Add task
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{ padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line)'), background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)' }}>
      {children}
    </button>
  )
}
