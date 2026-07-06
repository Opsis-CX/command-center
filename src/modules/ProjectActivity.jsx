import React from 'react'
import { useProjectsData } from './projectsData'
import { formatCommentTime } from './projectHelpers'

// ============================================================
// ACTIVITY sub-view — running feed of task/project actions.
// Members see only activity on tasks/projects they can see.
// ============================================================

const VERBS = {
  created: 'created task',
  created_and_assigned: 'created and assigned task',
  assigned: 'assigned',
  status_changed: 'updated status on',
  commented: 'commented on',
  attached_file: 'attached a file to',
  logged_time: 'logged time on',
  completed: 'completed',
  auto_created: 'auto-created (recurring)',
  deleted: 'deleted',
  restored: 'restored',
}

export default function ProjectActivity() {
  const { activity, profiles, isAdmin, myVisibleTasks, myVisibleProjects } = useProjectsData()

  const visibleTaskIds = new Set(myVisibleTasks().map(t => t.id))
  const visibleProjectIds = new Set(myVisibleProjects().map(p => p.id))

  const items = activity.filter(a => {
    if (isAdmin) return true
    return (a.task_id && visibleTaskIds.has(a.task_id)) || (a.project_id && visibleProjectIds.has(a.project_id))
  })

  if (!items.length) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>No activity yet</h3>
        <p style={{ fontSize: 13 }}>Actions across your projects and tasks will show up here.</p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: '4px 20px' }}>
      {items.map(a => {
        const actor = profiles.find(p => p.id === a.actor_id)
        const verb = VERBS[a.action] || a.action
        return (
          <div key={a.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line-soft)' }}>
            <div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <strong>{actor?.full_name || 'Someone'}</strong> {verb}
                {a.task_name && <> <strong>{a.task_name}</strong></>}
                {a.project_name && <> in {a.project_name}</>}
                {a.detail && <> — {a.detail}</>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>{formatCommentTime(a.created_at)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
