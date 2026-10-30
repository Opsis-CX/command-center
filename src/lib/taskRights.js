import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { usingNewPermissions } from './permissions'

// What can I do with this task? (2026-10-30)
// Asks the database (my_task_rights), so the screen always agrees with the rules the
// database enforces. Where the new permissions system isn't switched on (live today),
// everything stays allowed exactly as before.
const ALL = { edit_all: true, edit_progress: true, delete: true, loading: false }

export function useTaskRights(taskId) {
  const [rights, setRights] = useState(() => (!taskId || !usingNewPermissions() ? ALL : { ...ALL, loading: true }))
  useEffect(() => {
    let alive = true
    if (!taskId || !usingNewPermissions()) { setRights(ALL); return }
    setRights(r => ({ ...r, loading: true }))
    supabase.rpc('my_task_rights', { p_task: taskId }).then(({ data, error }) => {
      if (!alive) return
      setRights(error || !data ? ALL : { edit_all: !!data.edit_all, edit_progress: !!data.edit_progress, delete: !!data.delete, loading: false })
    })
    return () => { alive = false }
  }, [taskId])
  return rights
}

// Friendly wording for errors the database sends back.
export function taskError(e) {
  const m = String(e?.message || e || '')
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to make that change."
  return m.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong — please try again.'
}
