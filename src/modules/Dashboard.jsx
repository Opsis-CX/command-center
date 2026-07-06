import React, { useState, useMemo, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useProjectsData } from './projectsData'
import { StatusSelect, PriorityBadge, DueLabel, AvatarStack } from './projectBits'
import { esc, stripHtml, statusLabel, STATUSES } from './projectHelpers'
import { exportTasks } from './projectCsv'

// ============================================================
// DASHBOARD sub-view — stat cards, filters, grouped/table task lists.
// Ported from renderDashboard/renderStats/filteredTasks/build*Table.
// onOpenTask(id) opens the detail panel (wired in a later stage).
// ============================================================

export default function ProjectDashboard({ onOpenTask, onEditTask, onAddTask }) {
  const { myVisibleTasks, projects, clients, profiles, taskAssignees, tasks, setTasks, timeEntries, logActivity, refresh } = useProjectsData()
  const [mode, setMode] = useState('grouped')            // 'grouped' | 'table'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState([])    // empty = all
  const [priority, setPriority] = useState('')
  const [assignee, setAssignee] = useState('')
  const [client, setClient] = useState('')
  const [collapsed, setCollapsed] = useState({})
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const statusRef = useRef(null)

  // close the status dropdown when clicking anywhere outside it
  useEffect(() => {
    if (!statusDropdownOpen) return
    function onDoc(e) {
      if (statusRef.current && !statusRef.current.contains(e.target)) setStatusDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [statusDropdownOpen])

  const visible = myVisibleTasks()

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return visible.filter(t => {
      if (q && !t.name.toLowerCase().includes(q) && !stripHtml(t.notes).toLowerCase().includes(q)) return false
      if (statusFilter.length && !statusFilter.includes(t.status)) return false
      if (priority && t.priority !== priority) return false
      if (client && t.client_id !== client) return false
      if (assignee) {
        const ids = taskAssignees.filter(a => a.task_id === t.id).map(a => a.profile_id)
        if (!ids.includes(assignee)) return false
      }
      return true
    })
  }, [visible, search, statusFilter, priority, assignee, client, taskAssignees])

  // stats
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const total = visible.length
  const done = visible.filter(t => t.status === 'done').length
  const over = visible.filter(t => t.status !== 'done' && t.due_date && new Date(t.due_date + 'T00:00:00') < now).length
  const inp = visible.filter(t => t.status === 'inprogress').length
  const pct = total ? Math.round(done / total * 100) : 0

  async function quickStatusChange(taskId, newStatus) {
    const t = tasks.find(x => x.id === taskId)
    if (!t || t.status === newStatus) return
    const proj = projects.find(p => p.id === t.project_id)
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId)
    if (error) return
    setTasks(prev => prev.map(x => x.id === taskId ? { ...x, status: newStatus } : x))
    if (newStatus === 'done') logActivity('completed', taskId, t.name, t.project_id, proj?.name)
    else logActivity('status_changed', taskId, t.name, t.project_id, proj?.name, `Moved to ${statusLabel(newStatus)}`)
  }

  function toggleStatusFilter(v) {
    setStatusFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  const sortByDue = (a, b) => {
    const ad = a.due_date ? new Date(a.due_date) : new Date('2999-01-01')
    const bd = b.due_date ? new Date(b.due_date) : new Date('2999-01-01')
    return ad - bd
  }

  return (
    <div>
      {/* stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 20 }}>
        <Stat label="Total tasks" value={total} />
        <Stat label="In progress" value={inp} color="var(--accent)" />
        <Stat label="Completed" value={done} color="var(--passed)" />
        <Stat label="Overdue" value={over} color={over ? 'var(--failed)' : undefined} />
        <Stat label="Completion" value={`${pct}%`} color={pct === 100 ? 'var(--passed)' : undefined} />
      </div>

      {/* filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
          <ToggleBtn active={mode === 'grouped'} onClick={() => setMode('grouped')}>Grouped</ToggleBtn>
          <ToggleBtn active={mode === 'table'} onClick={() => setMode('table')}>Table</ToggleBtn>
        </div>
        <input className="input" placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 180, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />

        {/* status multi-filter */}
        <div style={{ position: 'relative' }} ref={statusRef}>
          <button onClick={() => setStatusDropdownOpen(o => !o)}
            style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            {statusFilter.length === 0 ? 'All statuses' : statusFilter.length === 1 ? statusLabel(statusFilter[0]) : `${statusFilter.length} statuses`} ▾
          </button>
          {statusDropdownOpen && (
            <div style={{ position: 'absolute', top: 38, left: 0, minWidth: 180, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 100, padding: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={statusFilter.length === 0} onChange={() => setStatusFilter([])} /> All statuses
              </label>
              <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
              {STATUSES.map(s => (
                <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={statusFilter.includes(s.key)} onChange={() => toggleStatusFilter(s.key)} /> {s.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <select value={priority} onChange={e => setPriority(e.target.value)} style={selStyle}>
          <option value="">All priorities</option>
          <option value="critical">Critical</option><option value="high">High</option>
          <option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={selStyle}>
          <option value="">All assignees</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <select value={client} onChange={e => setClient(e.target.value)} style={selStyle}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {onAddTask && (
          <button onClick={() => onAddTask()} className="btn btn-primary" style={{ marginLeft: 'auto' }}>+ Add task</button>
        )}
        <button onClick={() => exportTasks(filtered, { projects, clients, profiles, taskAssignees, timeEntries })}
          className="btn btn-ghost" style={{ marginLeft: onAddTask ? 0 : 'auto' }}>Export CSV</button>
      </div>

      {/* body */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-soft)' }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>No tasks found</h3>
          <p style={{ fontSize: 13 }}>Adjust filters or add a new task.</p>
        </div>
      ) : mode === 'table' ? (
        <FlatTable tasks={[...filtered].sort(sortByDue)} {...{ projects, clients, profiles, taskAssignees, onOpenTask, onEditTask, quickStatusChange }} />
      ) : (
        <GroupedView tasks={filtered} {...{ projects, clients, profiles, taskAssignees, collapsed, setCollapsed, onOpenTask, onEditTask, quickStatusChange, sortByDue, onAddTask }} />
      )}
    </div>
  )
}

const selStyle = { padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit' }

function Stat({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color: color || 'var(--ink)' }}>{value}</div>
    </div>
  )
}

function ToggleBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: '7px 14px', border: 0, background: active ? 'var(--accent)' : 'var(--surface)', color: active ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' }}>
      {children}
    </button>
  )
}

function TaskRow({ t, projects, clients, profiles, taskAssignees, onOpenTask, onEditTask, quickStatusChange, showProject }) {
  const proj = projects.find(p => p.id === t.project_id)
  const cl = clients.find(c => c.id === t.client_id)
  const aIds = taskAssignees.filter(a => a.task_id === t.id).map(a => a.profile_id)
  return (
    <tr onClick={() => onOpenTask && onOpenTask(t.id)} style={{ cursor: 'pointer' }} className="pm-task-row">
      <td style={tdStyle}>
        <div style={{ fontWeight: 500 }}>{t.name}</div>
        {t.notes && <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{stripHtml(t.notes)}</div>}
      </td>
      {showProject && <td style={tdStyle}>{proj ? <span style={{ fontSize: 12, fontWeight: 500, color: proj.color }}>● {proj.name}</span> : <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>—</span>}</td>}
      <td style={tdStyle}>{cl ? cl.name : <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>—</span>}</td>
      <td style={tdStyle}><StatusSelect status={t.status} onChange={s => quickStatusChange(t.id, s)} /></td>
      <td style={tdStyle}><PriorityBadge priority={t.priority} /></td>
      <td style={tdStyle}><DueLabel task={t} /></td>
      <td style={tdStyle}><AvatarStack ids={aIds} profiles={profiles} size={24} /></td>
      <td style={{ ...tdStyle, width: 64 }}>
        <button onClick={e => { e.stopPropagation(); onEditTask && onEditTask(t.id) }} title="Edit"
          style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-soft)', fontSize: 13 }}>✎</button>
      </td>
    </tr>
  )
}

const tdStyle = { padding: '10px 14px', borderBottom: '1px solid var(--line-soft)', fontSize: 13, verticalAlign: 'middle' }
const thStyle = { textAlign: 'left', padding: '9px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', background: 'var(--bg-soft, #f7f7f5)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }

function FlatTable({ tasks, ...props }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...thStyle, width: '26%' }}>Task</th><th style={thStyle}>Project</th><th style={thStyle}>Client</th>
          <th style={thStyle}>Status</th><th style={thStyle}>Priority</th><th style={thStyle}>Due</th><th style={thStyle}>Assigned to</th><th style={{ ...thStyle, width: 64 }}></th>
        </tr></thead>
        <tbody>{tasks.map(t => <TaskRow key={t.id} t={t} showProject {...props} />)}</tbody>
      </table>
    </div>
  )
}

function GroupedView({ tasks, projects, collapsed, setCollapsed, sortByDue, onAddTask, ...props }) {
  const projIds = [...new Set(tasks.map(t => t.project_id || '__none__'))]
  const ordered = []
  projects.forEach(p => { if (projIds.includes(p.id)) ordered.push(p.id) })
  if (projIds.includes('__none__')) ordered.push('__none__')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {ordered.map(pid => {
        const proj = pid === '__none__' ? null : projects.find(p => p.id === pid)
        const ptasks = tasks.filter(t => (t.project_id || '__none__') === pid).sort(sortByDue)
        const done = ptasks.filter(t => t.status === 'done').length
        const pct = ptasks.length ? Math.round(done / ptasks.length * 100) : 0
        const isCollapsed = collapsed[pid]
        return (
          <div key={pid} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div onClick={() => setCollapsed(c => ({ ...c, [pid]: !c[pid] }))}
              style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderBottom: isCollapsed ? 0 : '1px solid var(--line)', userSelect: 'none' }}>
              <span style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .2s', color: 'var(--ink-soft)' }}>▾</span>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: proj ? proj.color : '#888', flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{proj ? proj.name : 'No project'}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'flex', gap: 12, alignItems: 'center' }}>
                <span>{ptasks.length} task{ptasks.length !== 1 ? 's' : ''}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 60, height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden', display: 'inline-block' }}>
                    <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--passed)' : 'var(--accent)' }} />
                  </span>
                  <span>{pct}%</span>
                </span>
              </span>
            </div>
            {!isCollapsed && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...thStyle, width: '30%' }}>Task</th><th style={thStyle}>Client</th><th style={thStyle}>Status</th>
                  <th style={thStyle}>Priority</th><th style={thStyle}>Due</th><th style={thStyle}>Assigned to</th><th style={{ ...thStyle, width: 64 }}></th>
                </tr></thead>
                <tbody>
                  {ptasks.map(t => <TaskRow key={t.id} t={t} showProject={false} projects={projects} {...props} />)}
                  {onAddTask && (
                    <tr><td colSpan={7} style={{ padding: '8px 14px' }}>
                      <button onClick={() => onAddTask(null, pid === '__none__' ? '' : pid)}
                        style={{ border: 0, background: 'transparent', color: 'var(--ink-soft)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add task</button>
                    </td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
