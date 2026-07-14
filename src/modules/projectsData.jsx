import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ============================================================
// PROJECTS DATA LAYER
// Loads every project-management table once and shares it across
// all the Projects sub-views (Dashboard, Kanban, My Day, etc.),
// mirroring the original app's fetchAll() + global arrays.
// ============================================================

const ProjectsDataContext = createContext(null)

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
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('projects').select('*').order('name', { ascending: true }),
        supabase.from('clients').select('*').order('name'),
        supabase.from('recurring_tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('project_members').select('*'),
        supabase.from('tasks').select('*').is('deleted_at', null).order('created_at'),
        supabase.from('task_assignees').select('*'),
        supabase.from('task_comments').select('*').order('created_at', { ascending: true }),
        supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('task_attachments').select('*').order('created_at', { ascending: false }),
        supabase.from('time_entries').select('*').order('created_at', { ascending: false }),
      ])

      setMe(profRes.data)
      setIsAdmin(profRes.data?.is_admin || false)
      setProfiles(profilesRes.data || [])
      setProjects(projRes.data || [])
      setClients(cliRes.data || [])
      setRecurring(recRes.data || [])
      setProjectMembers(pmRes.data || [])
      setTasks(taskRes.data || [])
      setTaskAssignees(taRes.data || [])
      setComments(comRes.data || [])
      setActivity(actRes.data || [])
      setAttachments(attRes.data || [])
      setTimeEntries(timeRes.data || [])
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load project data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // tasks visible to the current user. Admins see EVERY task across all
  // projects; members see their projects' tasks, tasks assigned to them, or
  // tasks they created.
  const myVisibleTasks = useCallback(() => {
    if (isAdmin) return tasks   // admin: full visibility into all tracked work
    const myProjectIds = projectMembers.filter(m => m.profile_id === userId).map(m => m.project_id)
    const myAssignedTaskIds = taskAssignees.filter(a => a.profile_id === userId).map(a => a.task_id)
    return tasks.filter(t =>
      myProjectIds.includes(t.project_id) ||
      myAssignedTaskIds.includes(t.id) ||
      t.created_by === userId
    )
  }, [tasks, projectMembers, taskAssignees, userId, isAdmin])

  const myVisibleProjects = useCallback(() => {
    if (isAdmin) return projects   // admin: see every project, regardless of creator/membership
    return projects.filter(p =>
      p.created_by === userId ||
      projectMembers.some(m => m.project_id === p.id && m.profile_id === userId)
    )
  }, [projects, projectMembers, userId, isAdmin])

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
