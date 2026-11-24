// Workspace = which client the merged Command Center is looking at (Becky's "one platform" mockup, 11/24).
// '' = Opsis CX itself (Command Center pages only). A client id = that client's portal pages open inside
// Command Center (/w/<page>). The list comes from my_portals() → can_view_portal(), so people only ever
// see the workspaces they're allowed to open. The choice is remembered per browser.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const KEY = 'cc_workspace'
const EVT = 'cc-workspace'
let _list = null
let _loading = null

export function getWorkspace() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}
export function setWorkspace(id) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY) } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: id || '' }))
}
export function loadWorkspaces() {
  if (_list) return Promise.resolve(_list)
  if (!_loading) {
    _loading = supabase.rpc('my_portals').then(({ data, error }) => {
      _loading = null
      if (error) return []
      _list = data || []
      return _list
    })
  }
  return _loading
}
// { id, list, current, set } — current is the my_portals row for the chosen workspace (or null).
export function useWorkspace() {
  const [id, setId] = useState(getWorkspace())
  const [list, setList] = useState(_list)
  useEffect(() => {
    let on = true
    loadWorkspaces().then(l => { if (on) setList(l) })
    const h = (e) => setId(e.detail || '')
    window.addEventListener(EVT, h)
    return () => { on = false; window.removeEventListener(EVT, h) }
  }, [])
  const current = (list || []).find(p => p.client_id === id) || null
  return { id: current ? id : '', list, current, set: setWorkspace }
}
