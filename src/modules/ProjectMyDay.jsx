import React from 'react'
import { useProjectsData } from './projectsData'
import { StatusBadge, PriorityBadge, DueLabel } from './projectBits'
import { dueCls } from './projectHelpers'

// ============================================================
// MY DAY sub-view — the current user's assigned, open tasks,
// bucketed into Overdue / Due today / Due this week / No due date.
// ============================================================

export default function ProjectMyDay({ onOpenTask }) {
  const { me, userId, myVisibleTasks, taskAssignees, projects } = useProjectsData()

  const firstName = (me?.full_name || '').split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const myTasks = myVisibleTasks().filter(t => {
    const aIds = taskAssignees.filter(a => a.task_id === t.id).map(a => a.profile_id)
    return aIds.includes(userId)
  })

  const now = new Date(); now.setHours(0, 0, 0, 0)
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7)
  const open = myTasks.filter(t => t.status !== 'done')
  const overdue = open.filter(t => t.due_date && new Date(t.due_date + 'T00:00:00') < now)
  const today = open.filter(t => t.due_date && new Date(t.due_date + 'T00:00:00').toDateString() === now.toDateString())
  const upcoming = open.filter(t => {
    const d = t.due_date ? new Date(t.due_date + 'T00:00:00') : null
    return d && d > now && d <= weekEnd
  })
  const noDate = open.filter(t => !t.due_date)

  const buckets = [
    { label: 'Overdue', tasks: overdue, danger: true },
    { label: 'Due today', tasks: today },
    { label: 'Due this week', tasks: upcoming },
    { label: 'No due date', tasks: noDate },
  ].filter(b => b.tasks.length)

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{firstName ? `${greeting}, ${firstName}` : 'My Day'}</h2>
        <p className="page-sub" style={{ marginTop: 2 }}>{dateStr}</p>
      </div>

      {myTasks.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>Nothing on your plate right now</h3>
          <p style={{ fontSize: 13 }}>Tasks assigned to you will show up here.</p>
        </div>
      ) : buckets.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>You're all caught up 🎉</h3>
          <p style={{ fontSize: 13 }}>No open tasks need your attention right now.</p>
        </div>
      ) : buckets.map(bucket => (
        <div key={bucket.label} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            {bucket.label}
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: bucket.danger ? 'var(--failed-bg)' : 'var(--bg-soft, #eee)', color: bucket.danger ? 'var(--failed)' : 'var(--ink-soft)' }}>{bucket.tasks.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...bucket.tasks].sort(sortByDue).map(t => {
              const proj = projects.find(p => p.id === t.project_id)
              const over = dueCls(t) === 'overdue'
              return (
                <div key={t.id} onClick={() => onOpenTask && onOpenTask(t.id)} className="card"
                  style={{ padding: '13px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, borderLeft: over ? '3px solid var(--failed)' : undefined }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{t.name}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--ink-soft)' }}>
                      {proj && <span style={{ color: proj.color }}>● {proj.name}</span>}
                      {t.due_date && <DueLabel task={t} />}
                    </div>
                  </div>
                  <PriorityBadge priority={t.priority} small />
                  <StatusBadge status={t.status} />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function sortByDue(a, b) {
  const ad = a.due_date ? new Date(a.due_date) : new Date('2999-01-01')
  const bd = b.due_date ? new Date(b.due_date) : new Date('2999-01-01')
  return ad - bd
}
