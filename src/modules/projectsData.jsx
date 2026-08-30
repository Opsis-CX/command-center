import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// PROJECTS DATA LAYER
// Loads every project-management table once and shares it across
// all the Projects sub-views (Dashboard, Kanban, My Day, etc.),
// mirroring the original app's fetchAll() + global arrays.
// ============================================================

const ProjectsDataContext = createContext(null)

// PostgREST caps every response at a fixed number of rows (Supabase's default
// "max rows" is 1000). A plain .select() therefore SILENTLY truncates any table
// that has grown past that limit — which is how task_assignees (1100+ rows)
// started dropping people's assignments, making tasks vanish from "my tasks".
// fetchAllRows pages through with .range() until the table is exhausted, so we
// always load the complete set. Each query MUST carry a deterministic order
// (unique tiebreaker) or paging could skip/duplicate rows across pages.
const PAGE_SIZE = 1000
async function fetchAllRows(buildQuery) {
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) { console.error('fetchAllRows failed:', error.message); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

export function ProjectsDataProvider({ children }) {
  const [me, setMe] = useState(null)          // current profile row
  const [isAdmin, setIsAdmin] = useState(false)
  const [userId, setUserId] = useState(null)

  const [profiles, setProfiles] = useState([])
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [recurring, setRecurring] = useState([])
  const [projectMembers, setProjectMembers] = useState([])
  const [tasks, setTasks] = useState([])
  const [taskAssignees, setTaskAssignees] = useState([])
  const [comments, setComments] = useState([])
  const [activity, setActivity] = useState([])
  const [attachments, setAttachments] = useState([])
  const [timeEntries, setTimeEntries] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setUserId(user.id)

      const [profRes, profilesRes, projRes, cliRes, recRes, pmRes, taskRes, taRes, comRes, actRes, attRes, timeRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        // Project Management assigns work inside Command Center, which agents and
        // clients cannot open — so they must never appear in an owner, member or
        // assignee picker. Deactivated people are gone entirely.
        fetchAllRows(() => supabase.from('profiles').select('*').eq('is_active', true).not('role', 'in', '(agent,client)').order('full_name').order('id')),
        fetchAllRows(() => supabase.from('projects').select('*').order('name', { ascending: true }).order('id')),
        fetchAllRows(() => supabase.from('clients').select('*').order('name').order('id')),
        fetchAllRows(() => supabase.from('recurring_tasks').select('*').order('created_at', { ascending: false }).order('id')),
        fetchAllRows(() => supabase.from('project_members').select('*').order('project_id').order('profile_id')),
        fetchAllRows(() => supabase.from('tasks').select('*').is('deleted_at', null).order('created_at').order('id')),
        fetchAllRows(() => supabase.from('task_assignees').select('*').order('task_id').order('profile_id')),
        fetchAllRows(() => supabase.from('task_comments').select('*').order('created_at', { ascending: true }).order('id')),
        supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(100),
        fetchAllRows(() => supabase.from('task_attachments').select('*').order('created_at', { ascending: false }).order('id')),
        fetchAllRows(() => supabase.from('time_entries').select('*').order('created_at', { ascending: false }).order('id')),
      ])

      setMe(profRes.data)
      setIsAdmin(profRes.data?.is_admin || false)
      setProfiles(profilesRes || [])
      setProjects(projRes || [])
      setClients(cliRes || [])
      setRecurring(recRes || [])
      setProjectMembers(pmRes || [])
      setTasks(taskRes || [])
      setTaskAssignees(taRes || [])
      setComments(comRes || [])
      setActivity(actRes.data || [])
      setAttachments(attRes || [])
      setTimeEntries(timeRes || [])
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load project data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Projects the current user "has a task in" — i.e. they created or are
  // assigned to at least one task within that project. Mirrors the DB
  // SECURITY DEFINER fn my_task_project_ids() so the client shows exactly
  // what RLS now returns (migration task_project_access_from_assignment,
  // 2026-07-31). Without this the client re-hid projects people were
  // assigned into but weren't members of — the "missing projects" bug.
  const myTaskProjectIds = useCallback(() => {
    const assignedTaskIds = new Set(
      taskAssignees.filter(a => a.profile_id === userId).map(a => a.task_id)
    )
    const ids = new Set()
    for (const t of tasks) {
      if (t.created_by === userId || assignedTaskIds.has(t.id)) {
        if (t.project_id) ids.add(t.project_id)
      }
    }
    return ids
  }, [tasks, taskAssignees, userId])

  // tasks visible to the current user. Admins see EVERY task across all
  // projects; members see tasks in their projects, tasks assigned to them,
  // tasks they created, or any task in a project they have a task in.
  const myVisibleTasks = useCallback(() => {
    if (isAdmin) return tasks   // admin: full visibility into all tracked work
    const myProjectIds = projectMembers.filter(m => m.profile_id === userId).map(m => m.project_id)
    const myAssignedTaskIds = taskAssignees.filter(a => a.profile_id === userId).map(a => a.task_id)
    const taskProjectIds = myTaskProjectIds()
    return tasks.filter(t =>
      myProjectIds.includes(t.project_id) ||
      myAssignedTaskIds.includes(t.id) ||
      t.created_by === userId ||
      taskProjectIds.has(t.project_id)
    )
  }, [tasks, projectMembers, taskAssignees, userId, isAdmin, myTaskProjectIds])

  const myVisibleProjects = useCallback(() => {
    if (isAdmin) return projects   // admin: see every project, regardless of creator/membership
    const taskProjectIds = myTaskProjectIds()
    return projects.filter(p =>
      p.created_by === userId ||
      projectMembers.some(m => m.project_id === p.id && m.profile_id === userId) ||
      taskProjectIds.has(p.id)
    )
  }, [projects, projectMembers, userId, isAdmin, myTaskProjectIds])

  // activity log helper (fire-and-forget; won't block the calling action)
  const logActivity = useCallback(async (action, taskId, taskName, projectId, projectName, detail) => {
    try {
      await supabase.from('activity_log').insert({
        actor_id: userId, action,
        task_id: taskId || null, task_name: taskName || null,
        project_id: projectId || null, project_name: projectName || null,
        detail: detail || null,
      })
    } catch (e) { /* non-blocking */ }
  }, [userId])

  const value = {
    me, isAdmin, userId,
    profiles, projects, clients, recurring, projectMembers,
    tasks, taskAssignees, comments, activity, attachments, timeEntries,
    loading, error,
    refresh: fetchAll,
    myVisibleTasks, myVisibleProjects,
    logActivity,
    // setters exposed for optimistic in-memory updates where useful
    setTasks, setTaskAssignees, setComments, setAttachments, setTimeEntries,
  }

  return <ProjectsDataContext.Provider value={value}>{children}</ProjectsDataContext.Provider>
}

export function useProjectsData() {
  const ctx = useContext(ProjectsDataContext)
  if (!ctx) throw new Error('useProjectsData must be used within ProjectsDataProvider')
  return ctx
}
